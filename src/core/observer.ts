import { Page, Frame } from 'playwright';

/**
 * ページの状態を観測し、Virtual IDを注入してLLM用のテキスト表現を生成するクラス
 */
export class Observer {
  /**
<<<<<<< Updated upstream
   * 現在のページ状態をキャプチャし、整形された文字列を返します。
   * 全フレームを走査し、操作可能な要素にIDを付与します。
   * @param page Playwright Page object
   */
  async captureState(page: Page): Promise<ObservationResult> {
    // 1. Smart Wait: DOMとネットワークの安定化を待機
<<<<<<< Updated upstream
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 2000 });
      // ネットワークアイドルは厳しすぎる場合があるので、必要に応じて有効化
      // await page.waitForLoadState('networkidle', { timeout: 2000 });
    } catch {
      // タイムアウトしても処理を続行する（SPAなどでロードが終わらない場合があるため）
    }

    // 2. 全フレームに対してID注入と要素抽出を実行
    const frames = page.frames();

<<<<<<< Updated upstream
    for (const frame of frames) {
      try {
        // フレームごとに注入・スキャンを実行
        const frameElements = await this.injectAndScan(frame);
        allElementsInfo.push(...frameElements);
      } catch {
        // Cross-origin iframeなどでアクセス不可の場合はスキップし、ログだけ残す
        // console.warn(`Skipped frame: ${frame.url()}`);
      }
    }

    const url = page.url();
    const title = await page.title();

    // LLMに渡すテキスト形式
    return `
URL: ${url}
Title: ${title}

Interactive Elements (Virtual IDs Injected):
${allElementsInfo.length > 0 ? allElementsInfo.join('\n') : 'No interactive elements found.'}
`;
  }

  /**
   * 特定のフレーム内でJSを実行し、要素にIDを振り、情報を収集します。
   */
  private async injectAndScan(frame: Frame): Promise<string[]> {
    return await frame.evaluate(() => {
      // 操作可能な要素のセレクタリスト
      const selector = 'button, a, input, select, textarea, [role="button"], [onclick]';
      const elements = document.querySelectorAll(selector);
      const results: string[] = [];

      elements.forEach((el) => {
        // まだIDがない場合のみ新規付与 (既存IDは維持して安定性を保つ)
        if (!el.getAttribute('data-flash-id')) {
          // 簡易的なユニークID生成 (ランダム文字列)
          const newId = Math.random().toString(36).substring(2, 6);
          el.setAttribute('data-flash-id', newId);
        }

        const id = el.getAttribute('data-flash-id');
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

<<<<<<< Updated upstream
      return results;
    });
  }
}
