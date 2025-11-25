import { Page, Frame, ElementHandle } from 'playwright';
import { ObservationResult, ElementContainer } from '../types';
import { DOM_WAIT_TIMEOUT_MS } from '../constants';

/**
 * セレクタ候補の型定義
 */
interface SelectorCandidates {
  testId?: string;
  placeholder?: string;
  text?: string;
  role?: { role: string; name: string };
  label?: string;
}

/**
 * ブラウザ内JSから返却されるメタデータの型定義
 */
interface ElementMetadataInfo {
  xpath: string;
  tagName: string;
  inputType: string | null;
  description: string;
  isScrollable: boolean;
  isInViewport: boolean;
  selectors: SelectorCandidates;
}

export class Observer {
  /**
   * 全フレームを走査し、インタラクティブな要素を抽出してYAMLとMapを生成する
   * DOMへの属性注入(data-flash-id)は行わず、メモリ上で管理する
   *
   * @param page Playwright Page object
   */
  async captureState(page: Page): Promise<ObservationResult> {
    // 1. Smart Wait: DOMとネットワークの安定化を待機
    await this.waitForStability(page);

    const elementMap = new Map<string, ElementContainer>();
    const yamlLines: string[] = [];
    let globalIdCounter = 1;
    let hiddenItemCount = 0; // 画面外の要素数カウント用

    // 2. 全フレームを並列走査
    // メインフレームとすべてのiframeを取得
    const frames = page.frames();

    // 各フレームの走査結果を集約
    const frameResults = await Promise.all(
      frames.map(async (frame) => {
        try {
          return await this.scanFrame(frame);
        } catch {
          // クロスオリジン制限などでアクセスできないフレームはスキップ
          return null;
        }
      })
    );

    // 3. 結果の統合とフォーマット
    for (const result of frameResults) {
      if (!result) continue;
      const { frame, frameSelectorChain, items } = result;

      for (const item of items) {
        const id = String(globalIdCounter++);

        // コンテナ作成 (メモリ保持は全要素行う)
        elementMap.set(id, {
          id,
          handle: item.handle,
          frame,
          frameSelectorChain, // チェーンとして保存
          xpath: item.metadata.xpath,
          selectors: item.metadata.selectors,
          description: item.metadata.description,
          tagName: item.metadata.tagName,
          isScrollable: item.metadata.isScrollable,
        });

        // YAML生成 (LLM用)
        // ビューポート内の要素のみ詳細を出力する
        if (item.metadata.isInViewport) {
          let line = `- ${item.metadata.tagName}`;

          // input typeなどの重要属性は付記してAIの判断を助ける
          if (item.metadata.inputType) {
            line += `[type="${item.metadata.inputType}"]`;
          }

          // 簡潔な説明とID
          line += ` "${item.metadata.description}" [ID: ${id}]`;

          const extraInfo: string[] = [];
          if (item.metadata.isScrollable) extraInfo.push('Scrollable');
          // チェーンがある場合は iframe 内と明示
          if (frameSelectorChain.length > 0) extraInfo.push('in Iframe');

          if (extraInfo.length > 0) {
            line += ` (${extraInfo.join(', ')})`;
          }

          yamlLines.push(line);
        } else {
          // 画面外の要素はカウントのみ
          hiddenItemCount++;
        }
      }
    }

    // スクロールヒントの追加
    if (hiddenItemCount > 0) {
      yamlLines.push(
        `\n... (${hiddenItemCount} more items are currently not visible. Use 'scroll' action to see them.)`
      );
    }

    const stateText = `
URL: ${page.url()}
Title: ${await page.title()}

Interactive Elements (Visible Area Only):
${yamlLines.length > 0 ? yamlLines.join('\n') : '(No visible interactive elements found. Try scrolling.)'}
`;

    return { stateText, elementMap };
  }

  /**
   * DOMの安定化を待つ (Smart Wait Strategy)
   * 1. domcontentloaded
   * 2. networkidle (short timeout)
   * 3. MutationObserver (DOM変更が落ち着くまで)
   */
  private async waitForStability(page: Page) {
    try {
      // 最低限のロード待ち
      await page.waitForLoadState('domcontentloaded', { timeout: DOM_WAIT_TIMEOUT_MS });

      // ネットワークの静定 (オプション: 500msだけ待つ)
      try {
        await page.waitForLoadState('networkidle', { timeout: 500 });
      } catch {
        /* ignore */
      }

      // DOM変更の静定 (MutationObserver)
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          let timeout: ReturnType<typeof setTimeout>;
          const observer = new MutationObserver(() => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
              observer.disconnect();
              resolve();
            }, 200); // 200ms間変更がなければ安定とみなす
          });

          observer.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
          });

          // そもそも変更が起きない場合のためのフォールバック (1秒)
          setTimeout(() => {
            observer.disconnect();
            resolve();
          }, 1000);
        });
      });
    } catch (e) {
      // 待機に失敗しても致命的ではないので続行
      console.warn('Smart wait failed or timed out:', e);
    }
  }

  /**
   * 個別フレーム内の要素をスキャンする
   * Shadow DOM や iframe を考慮して探索を行う
   */
  private async scanFrame(frame: Frame) {
    // フレーム階層チェーンの構築
    // 自分自身からルートに向かって親を辿り、各階層のセレクタを取得する
    const frameSelectorChain: string[] = [];
    let currentFrame = frame;

    // ルートフレームに到達するまで親を辿る
    while (currentFrame.parentFrame()) {
      const parent = currentFrame.parentFrame();
      if (!parent) break;

      try {
        const frameElement = await currentFrame.frameElement();
        // 親フレームのコンテキストで、自分自身(iframeタグ)を特定するセレクタを計算
        const selector = await this.calculateFrameSelector(frameElement);
        frameSelectorChain.unshift(selector); // 配列の先頭に追加 (親 -> 子 の順にするため)
      } catch {
        // 取得できない場合はチェーンが切れるが、最善を尽くす
        frameSelectorChain.unshift('iframe');
      }
      currentFrame = parent;
    }

    // ブラウザ内でJSを実行し、Handleとメタデータのペアを取得
    // evaluateHandleを使うことで、DOM要素への参照(JSHandle)をNode.js側で維持する
    const resultHandle = await frame.evaluateHandle(() => {
      interface FoundItem {
        element: Element;
        metadata: ElementMetadataInfo;
      }
      const foundItems: FoundItem[] = [];

      // ビューポートのサイズ取得
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      // --- Browser Context Helpers (ブラウザ内で実行される関数群) ---

      /**
       * 要素が物理的に存在し、可視スタイルか判定
       */
      function isVisibleStyle(el: Element): boolean {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 0 &&
          rect.height > 0
        );
      }

      /**
       * 要素が現在のビューポートに入っているか判定
       */
      function isInViewport(el: Element): boolean {
        const rect = el.getBoundingClientRect();
        // 完全に画面外でなければ「見える」とみなす（少しはみ出していてもOK）
        return (
          rect.top < viewportHeight &&
          rect.bottom > 0 &&
          rect.left < viewportWidth &&
          rect.right > 0
        );
      }

      /**
       * 要素の一意なXPathを生成する
       */
      function getXPath(element: Element): string {
        if (element.id !== '') {
          // エスケープ処理: ダブルクォートを含むIDに対応
          const escapedId = element.id.replace(/"/g, '\\"');
          return `//*[@id="${escapedId}"]`;
        }
        if (element === document.body) return '/html/body';
        let ix = 0;
        const siblings = element.parentNode?.childNodes;
        if (!siblings) return '';
        for (let i = 0; i < siblings.length; i++) {
          const sibling = siblings[i];
          if (sibling === element) {
            const parentPath = element.parentNode ? getXPath(element.parentNode as Element) : '';
            return `${parentPath}/${element.tagName.toLowerCase()}[${ix + 1}]`;
          }
          if (sibling.nodeType === 1 && (sibling as Element).tagName === element.tagName) {
            ix++;
          }
        }
        return '';
      }

      /**
       * Deep Traversal (Shadow DOM対応の再帰探索)
       */
      function traverse(root: Document | ShadowRoot | Element) {
        const children = root.querySelectorAll('*');
        children.forEach((el) => {
          checkElement(el);
          if (el.shadowRoot) {
            traverse(el.shadowRoot);
          }
        });
      }

      /**
       * 個別の要素がインタラクティブか判定し、メタデータを収集する
       */
      function checkElement(el: Element) {
        if (!isVisibleStyle(el)) return;

        const style = window.getComputedStyle(el);
        const tagName = el.tagName.toLowerCase();

        // インタラクティブ判定
        const isScrollable =
          el.scrollHeight > el.clientHeight &&
          (style.overflowY === 'scroll' || style.overflowY === 'auto');

        const isInteractive =
          ['button', 'a', 'input', 'select', 'textarea', 'details', 'summary'].includes(tagName) ||
          el.getAttribute('role') === 'button' ||
          el.getAttribute('role') === 'link' ||
          el.getAttribute('contenteditable') === 'true' ||
          style.cursor === 'pointer' || // Clickable Div対応
          isScrollable;

        if (!isInteractive) return;

        // テキスト取得とクリーニング
        let text = (el as HTMLElement).innerText || (el as HTMLInputElement).value || '';
        // 機密情報のマスク
        const inputType = el.getAttribute('type');
        if (
          tagName === 'input' &&
          inputType &&
          ['password', 'email', 'tel', 'credit-card'].includes(inputType)
        ) {
          text = '[REDACTED]';
        }
        const cleanText = text.replace(/\s+/g, ' ').trim().slice(0, 50);
        const ariaLabel = el.getAttribute('aria-label');
        const placeholder = el.getAttribute('placeholder');
        const testId = el.getAttribute('data-testid');

        // Description (LLMに見せる名前)
        const description = ariaLabel || placeholder || cleanText || 'Unlabeled Element';

        // --- Pre-computation of Selectors (一意性チェック) ---
        const selectors: SelectorCandidates = {};

        // 1. Test ID
        if (testId && document.querySelectorAll(`[data-testid="${testId}"]`).length === 1) {
          selectors.testId = testId;
        }

        // 2. Placeholder
        if (
          placeholder &&
          document.querySelectorAll(`[placeholder="${placeholder}"]`).length === 1
        ) {
          selectors.placeholder = placeholder;
        }

        // 3. Text (簡易判定)
        if (cleanText) {
          const exactMatches = Array.from(document.querySelectorAll(tagName)).filter((e) => {
            const t = (e as HTMLElement).innerText || (e as HTMLInputElement).value;
            return t && t.replace(/\s+/g, ' ').trim() === cleanText;
          });
          if (exactMatches.length === 1) {
            selectors.text = cleanText;
          }
        }

        // 4. Role
        const role =
          el.getAttribute('role') ||
          (['button', 'link', 'heading', 'checkbox', 'radio'].includes(tagName) ? tagName : null);
        if (role && (ariaLabel || cleanText)) {
          selectors.role = { role, name: ariaLabel || cleanText };
        }

        foundItems.push({
          element: el,
          metadata: {
            xpath: getXPath(el),
            tagName,
            inputType,
            description,
            isScrollable,
            isInViewport: isInViewport(el), // Viewport判定
            selectors,
          },
        });
      }

      traverse(document);
      return foundItems;
    });

    const properties = await resultHandle.getProperties();
    const items: Array<{
      handle: ElementHandle;
      metadata: ElementMetadataInfo;
    }> = [];

    for (const prop of properties.values()) {
      const itemHandle = prop;
      const rawHandle = await itemHandle.getProperty('element');
      // 重要: JSHandle から ElementHandle への変換
      const elementHandle = rawHandle.asElement();

      const metadataHandle = await itemHandle.getProperty('metadata');
      const metadata = await metadataHandle.jsonValue();

      if (elementHandle) {
        items.push({
          handle: elementHandle,
          metadata: metadata as ElementMetadataInfo,
        });
      }
    }

    // ルートハンドルの破棄（メモリリーク対策）
    await resultHandle.dispose();

    return { frame, frameSelectorChain, items };
  }

  /**
   * iframeタグを特定するセレクタを計算する
   * 親フレームのコンテキストで評価される
   */
  private async calculateFrameSelector(handle: ElementHandle): Promise<string> {
    return await handle.evaluate((node) => {
      // Element型にキャストしてプロパティにアクセスする
      const el = node as Element;
      // name属性があればベスト
      const name = el.getAttribute('name');
      if (name) {
        return `iframe[name="${name.replace(/"/g, '\\"')}"]`;
      }
      // id属性があれば次点
      if (el.id) {
        return `iframe[id="${el.id.replace(/"/g, '\\"')}"]`;
      }
      // classがあれば使う
      if (el.classList.length > 0) return `iframe.${el.classList[0]}`;
      // src属性は変わる可能性が高いが、他になければ使う
      const src = el.getAttribute('src');
      if (src) return `iframe[src*="${src.split('?')[0]}"]`; // クエリパラメータ除去
      // 最終手段
      let ix = 1; // CSS selector is 1-based
      let sibling = el.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === el.tagName) ix++;
        sibling = sibling.previousElementSibling;
      }
      return `iframe:nth-of-type(${ix})`;
    });
  }
}
