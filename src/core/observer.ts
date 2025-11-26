/**
 * src/core/observer.ts
 * DOMの状態を観測し、永続的なIDを割り振る
 */
import { Page, Frame, ElementHandle } from 'playwright';
import { ObservationResult, ElementContainer, SelectorCandidates } from '../types';
import { DOM_WAIT_TIMEOUT_MS } from '../constants';

// ブラウザ内で生成・返却されるメタデータの型定義
interface ElementMetadataInfo {
  xpath: string;
  tagName: string;
  inputType: string | null;
  description: string;
  isScrollable: boolean;
  isInViewport: boolean;
  selectors: SelectorCandidates;
  // Semantic ID 生成用
  attributes: Record<string, string>;
  textContent: string;
}

// 検出対象とするARIAロール
const VALID_ARIA_ROLES = [
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'option',
  'radio',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
  'gridcell',
  'heading',
];

export class Observer {
  // 永続化された要素マップ (Semantic Hash -> Container)
  private persistentElementMap: Map<string, ElementContainer> = new Map();

  /**
   * 現在のページ状態をキャプチャし、永続マップを更新して返す
   */
  async captureState(page: Page): Promise<ObservationResult> {
    await this.waitForStability(page);

    const currentScanIds = new Set<string>();
    const yamlLines: string[] = [];
    let hiddenItemCount = 0;

    const frames = page.frames();
    const frameResults = await Promise.all(
      frames.map(async (frame) => {
        try {
          return await this.scanFrame(frame);
        } catch {
          // クロスオリジンフレームなどでアクセス拒否された場合はスキップ
          return null;
        }
      })
    );

    // 同じハッシュ値が出現した場合のカウンタ (ページ内で一意にするため)
    const hashCounter = new Map<string, number>();

    for (const result of frameResults) {
      if (!result) continue;
      const { frame, frameSelectorChain, items } = result;

      for (const item of items) {
        // Semantic Hash の生成
        const rawHash = this.generateSemanticHash(item.metadata);

        // 衝突回避 (nth-occurrence)
        const count = (hashCounter.get(rawHash) || 0) + 1;
        hashCounter.set(rawHash, count);

        // ID形式: "tag-hash-index" (例: button-a1b2-1)
        const id = `${item.metadata.tagName}-${rawHash}-${count}`;
        currentScanIds.add(id);

        const container: ElementContainer = {
          id,
          handle: item.handle,
          frame,
          frameSelectorChain,
          xpath: item.metadata.xpath,
          selectors: item.metadata.selectors,
          description: item.metadata.description,
          tagName: item.metadata.tagName,
          isScrollable: item.metadata.isScrollable,
          isInViewport: item.metadata.isInViewport,
        };

        // マップ更新（常に最新のハンドルで上書き）
        this.persistentElementMap.set(id, container);

        // YAML生成 (Viewport内のみ)
        if (item.metadata.isInViewport) {
          let line = `- ${item.metadata.tagName}`;
          if (item.metadata.inputType) line += `[type="${item.metadata.inputType}"]`;

          // 可読性のため description は短く
          const desc = item.metadata.description.replace(/\n/g, ' ').slice(0, 60);
          line += ` "${desc}" [ID: ${id}]`;

          const extra: string[] = [];
          if (item.metadata.isScrollable) extra.push('Scrollable');
          if (frameSelectorChain.length > 0) extra.push('in Iframe');

          if (extra.length > 0) line += ` (${extra.join(', ')})`;
          yamlLines.push(line);
        } else {
          hiddenItemCount++;
        }
      }
    }

    // Stale Elements Cleanup (今回のスキャンで見つからなかったIDを削除)
    for (const id of this.persistentElementMap.keys()) {
      if (!currentScanIds.has(id)) {
        this.persistentElementMap.delete(id);
      }
    }

    if (hiddenItemCount > 0) {
      yamlLines.push(
        `\n... (${hiddenItemCount} more items are currently not visible/outside viewport. Use 'scroll' to explore.)`
      );
    }

    const title = await page.title().catch(() => 'No Title');
    const stateText = `
Page Title: ${title}
URL: ${page.url()}

Interactive Elements (Viewport):
${yamlLines.length > 0 ? yamlLines.join('\n') : '(No interactive elements found in viewport)'}
`;

    return { stateText, elementMap: this.persistentElementMap };
  }

  private async waitForStability(page: Page) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: DOM_WAIT_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: 500 }).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  private async scanFrame(frame: Frame) {
    // フレームセレクタチェーンの構築
    const frameSelectorChain: string[] = [];
    let currentFrame = frame;
    while (currentFrame.parentFrame()) {
      const parent = currentFrame.parentFrame();
      if (!parent) break;
      try {
        const frameElement = await currentFrame.frameElement();
        const selector = await this.calculateFrameSelector(frameElement);
        frameSelectorChain.unshift(selector);
      } catch {
        frameSelectorChain.unshift('iframe');
      }
      currentFrame = parent;
    }

    // --- ブラウザ内でのDOM解析 ---
    const resultHandle = await frame.evaluateHandle((validRoles) => {
      interface FoundItem {
        element: Element;
        metadata: ElementMetadataInfo;
      }
      const foundItems: FoundItem[] = [];
      const validRoleSet = new Set(validRoles);
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

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

      function isInViewport(el: Element): boolean {
        const rect = el.getBoundingClientRect();
        return (
          rect.top < viewportHeight &&
          rect.bottom > 0 &&
          rect.left < viewportWidth &&
          rect.right > 0
        );
      }

      function getXPath(element: Element): string {
        if (element.id !== '') return `//*[@id="${element.id.replace(/"/g, '\\"')}"]`;
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

      function traverse(root: Document | ShadowRoot | Element) {
        const children = root.querySelectorAll('*');
        children.forEach((el) => {
          checkElement(el);
          if (el.shadowRoot) {
            traverse(el.shadowRoot);
          }
        });
      }

      function checkElement(el: Element) {
        if (!isVisibleStyle(el)) return;

        const tagName = el.tagName.toLowerCase();
        const style = window.getComputedStyle(el);
        const roleAttr = el.getAttribute('role');

        const isScrollable =
          el.scrollHeight > el.clientHeight &&
          (style.overflowY === 'scroll' || style.overflowY === 'auto');

        const isInteractive =
          ['button', 'a', 'input', 'select', 'textarea', 'details', 'summary'].includes(tagName) ||
          validRoleSet.has(roleAttr || '') ||
          el.getAttribute('contenteditable') === 'true' ||
          style.cursor === 'pointer' ||
          isScrollable;

        if (!isInteractive) return;

        // テキストと機密情報マスク
        let text = (el as HTMLElement).innerText || (el as HTMLInputElement).value || '';
        const inputType = el.getAttribute('type');
        const autocomplete = el.getAttribute('autocomplete');

        if (
          tagName === 'input' &&
          ((inputType && ['password', 'email', 'tel'].includes(inputType)) ||
            (autocomplete &&
              (autocomplete.includes('password') ||
                autocomplete === 'email' ||
                autocomplete.startsWith('cc-'))))
        ) {
          text = '[REDACTED]';
        }
        const cleanText = text.replace(/\s+/g, ' ').trim();

        const ariaLabel = el.getAttribute('aria-label');
        const placeholder = el.getAttribute('placeholder');
        const testId = el.getAttribute('data-testid');
        const title = el.getAttribute('title');
        const alt = el.getAttribute('alt');

        const description =
          ariaLabel || placeholder || title || alt || cleanText || 'Unlabeled Element';

        const selectors: SelectorCandidates = {};
        if (testId) selectors.testId = testId;
        if (placeholder) selectors.placeholder = placeholder;
        if (cleanText && cleanText.length < 50) selectors.text = cleanText;
        if (ariaLabel) selectors.label = ariaLabel;
        if (title) selectors.title = title;
        if (alt) selectors.altText = alt;

        let finalRole = roleAttr;
        if (!finalRole) {
          if (tagName === 'button') finalRole = 'button';
          else if (tagName === 'a' && el.hasAttribute('href')) finalRole = 'link';
          else if (tagName === 'input' && inputType === 'checkbox') finalRole = 'checkbox';
          else if (tagName === 'input' && inputType === 'radio') finalRole = 'radio';
          else if (tagName === 'input') finalRole = 'textbox';
          else if (tagName === 'select') finalRole = 'combobox';
        }

        if (finalRole && (ariaLabel || cleanText)) {
          selectors.role = { role: finalRole, name: ariaLabel || cleanText };
        }

        const attributes: Record<string, string> = {};
        if (el.id) attributes['id'] = el.id;
        if (el.className) attributes['class'] = el.className;
        if (inputType) attributes['type'] = inputType;
        if (finalRole) attributes['role'] = finalRole;

        foundItems.push({
          element: el,
          metadata: {
            xpath: getXPath(el),
            tagName,
            inputType: inputType || null,
            description,
            isScrollable,
            isInViewport: isInViewport(el),
            selectors,
            attributes,
            textContent: cleanText.slice(0, 50),
          },
        });
      }

      traverse(document);
      return foundItems;
    }, VALID_ARIA_ROLES);

    const properties = await resultHandle.getProperties();
    const items: Array<{ handle: ElementHandle; metadata: ElementMetadataInfo }> = [];

    for (const prop of properties.values()) {
      const itemHandle = prop;
      const rawHandle = await itemHandle.getProperty('element');
      const elementHandle = rawHandle.asElement();

      const metadataHandle = await itemHandle.getProperty('metadata');
      const metadata = await metadataHandle.jsonValue();

      if (elementHandle) {
        items.push({ handle: elementHandle, metadata: metadata as ElementMetadataInfo });
      } else {
        await rawHandle.dispose();
      }
      await metadataHandle.dispose();
      await itemHandle.dispose();
    }
    await resultHandle.dispose();

    return { frame, frameSelectorChain, items };
  }

  private async calculateFrameSelector(handle: ElementHandle): Promise<string> {
    return await handle.evaluate((node) => {
      const el = node as Element;
      const name = el.getAttribute('name');
      if (name) return `iframe[name="${name.replace(/"/g, '\\"')}"]`;
      if (el.id) return `iframe[id="${el.id.replace(/"/g, '\\"')}"]`;

      const src = el.getAttribute('src');
      if (src) {
        const cleanSrc = src.split('?')[0].replace(/["\\]/g, '\\$&');
        return `iframe[src*="${cleanSrc}"]`;
      }
      return 'iframe';
    });
  }

  private generateSemanticHash(meta: ElementMetadataInfo): string {
    const parts = [
      meta.tagName,
      meta.selectors.testId || '',
      meta.attributes['role'] || '',
      meta.attributes['type'] || '',
      meta.selectors.placeholder || '',
      meta.attributes['name'] || '',
      // TextContentから数値を除去して安定性を向上させる
      (meta.textContent || '').replace(/\d+/g, '').slice(0, 20),
    ];

    let hash = 0x811c9dc5;
    const str = parts.join('|');
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).substring(0, 8);
  }
}
