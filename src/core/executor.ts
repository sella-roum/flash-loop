/**
 * src/core/executor.ts
 * アクションを実行し、再現可能なPlaywrightコードを生成するクラス
 */
import { Page, Frame, ElementHandle } from 'playwright';
import { ActionPlan, ExecutionResult } from '../types';
import { ATTR_FLASH_ID } from '../constants';

export class Executor {
  /**
   * ActionPlanに基づいて操作を実行します。
   */
  async execute(plan: ActionPlan, page: Page): Promise<ExecutionResult> {
    try {
      // 終了判定
      if (plan.isFinished) {
        return {
          success: true,
          generatedCode: '// Task Completed based on AI decision',
          retryable: false,
        };
      }

      let generatedCode = '';

      // --- Navigation Action ---
      if (plan.actionType === 'navigate') {
        if (!plan.value) throw new Error('Value (URL) is required for navigate action');
        await page.goto(plan.value);
        generatedCode = `await page.goto('${plan.value}');`;
        return { success: true, generatedCode, retryable: true };
      }

      // --- Interaction Actions ---
      if (!plan.targetId) throw new Error('Target ID is required for interaction');

      const { elementHandle, frame } = await this.findTargetInFrames(page, plan.targetId);

      if (!elementHandle || !frame) {
        throw new Error(
          `Target element with Virtual ID "${plan.targetId}" not found in any frame.`
        );
      }

      // 2. セレクタの逆算と一意性検証
      const bestSelector = await this.calculateUniqueSelector(frame, elementHandle, plan.targetId);

      // フレーム情報を考慮したコード構築
      let baseLocatorCode = `page.${bestSelector}`;
      const isMainFrame = frame === page.mainFrame();

      if (!isMainFrame) {
        // フレームを特定するためのセレクタを生成
        const frameElement = await frame.frameElement();
        const name = await frameElement.getAttribute('name');
        const id = await frameElement.getAttribute('id');
        const src = await frameElement.getAttribute('src');

        let frameSelector = '';
        if (name) {
          frameSelector = `iframe[name=${JSON.stringify(name)}]`;
        } else if (id) {
          frameSelector = `iframe[id=${JSON.stringify(id)}]`;
        } else if (src) {
          // src属性が存在する場合のみ使用。frame.url()は解決済みURLのため、
          // iframeタグのsrc属性と一致しない可能性があるため使用しない。
          frameSelector = `iframe[src=${JSON.stringify(src)}]`;
        } else {
          // フォールバック: フレームを特定できない場合、エラーにするか、あるいはnthで指定するか。
          // ここでは安全のためエラーを含んだコメントを出力する
          frameSelector = 'iframe /* FIXME: Could not identify frame uniquely */';
        }

        // frameLocatorを使用する場合
        if (frameSelector.includes('iframe[')) {
          baseLocatorCode = `page.frameLocator(${JSON.stringify(frameSelector)}).${bestSelector}`;
        } else {
          // セレクタが特定できなかった場合のフォールバック（壊れやすいコード）
          baseLocatorCode = `page.frameLocator('${frameSelector}').${bestSelector}`;
        }
      }

      // 3. アクション実行 & コード生成
      if (plan.actionType === 'click') {
        await elementHandle.click();
        generatedCode = `await ${baseLocatorCode}.click();`;
      } else if (plan.actionType === 'fill') {
        const val = plan.value || '';
        await elementHandle.fill(val);
        generatedCode = `await ${baseLocatorCode}.fill(${JSON.stringify(val)});`;
      } else if (plan.actionType === 'assertion') {
        const isVisible = await elementHandle.isVisible();
        if (!isVisible) {
          throw new Error('Assertion Failed: Element is not visible.');
        }
        generatedCode = `await expect(${baseLocatorCode}).toBeVisible();`;
      } else {
        throw new Error(`Unsupported actionType: ${plan.actionType}`);
      }

      return { success: true, generatedCode, retryable: false };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage, retryable: true };
    }
  }

  /**
   * ページ内の全フレームを探索して、指定されたVirtual IDを持つ要素を探す
   */
  private async findTargetInFrames(
    page: Page,
    id: string
  ): Promise<{ elementHandle: ElementHandle | null; frame: Frame | null }> {
    const frames = page.frames();

    for (const frame of frames) {
      try {
        // 定数を使用
        const handle = await frame.$(`[${ATTR_FLASH_ID}="${id}"]`);
        if (handle) {
          return { elementHandle: handle, frame };
        }
      } catch {
        // アクセスできないフレームは無視
      }
    }
    return { elementHandle: null, frame: null };
  }

  /**
   * 要素のハンドルから、永続的に使用可能なベストなセレクタを逆算する
   */
  private async calculateUniqueSelector(
    frame: Frame,
    handle: ElementHandle,
    virtualId: string
  ): Promise<string> {
    const attributes = await frame.evaluate((el) => {
      const htmlEl = el as HTMLElement;
      return {
        testid: htmlEl.getAttribute('data-testid'),
        role: htmlEl.getAttribute('role'),
        tagName: htmlEl.tagName.toLowerCase(),
        placeholder: htmlEl.getAttribute('placeholder'),
        text: htmlEl.innerText?.trim().slice(0, 30),
        ariaLabel: htmlEl.getAttribute('aria-label'),
      };
    }, handle);

    const candidates: string[] = [];
    const s = (val: string) => JSON.stringify(val);

    if (attributes.testid) {
      candidates.push(`getByTestId(${s(attributes.testid)})`);
    }

    const name = attributes.ariaLabel || attributes.text;
    const role =
      attributes.role ||
      (['button', 'link', 'checkbox', 'radio'].includes(attributes.tagName)
        ? attributes.tagName
        : null);

    if (role && name) {
      candidates.push(`getByRole(${s(role)}, { name: ${s(name)} })`);
    }

    if (attributes.placeholder) {
      candidates.push(`getByPlaceholder(${s(attributes.placeholder)})`);
    }

    if (attributes.text) {
      candidates.push(`getByText(${s(attributes.text)})`);
    }

    // Frameオブジェクトに直接 getBy... メソッドが存在しない場合があるため、
    // locator('body') を経由して Locator オブジェクトを作成し、そこからメソッドを呼ぶ。
    // bodyが存在しないケース（SVGなど）も考慮し、本来は :root などが良いが、Playwrightのlocatorは
    // CSSセレクタを引数に取るため、ここでは 'body' を起点とする。
    const frameLocator = frame.locator('body');

    for (const selector of candidates) {
      try {
        let count = 0;

        if (selector.startsWith('getByTestId')) {
          count = await frameLocator.getByTestId(attributes.testid!).count();
        } else if (selector.startsWith('getByRole')) {
          if (role && name) {
            count = await frameLocator
              .getByRole(role as Parameters<Page['getByRole']>[0], { name })
              .count();
          }
        } else if (selector.startsWith('getByPlaceholder')) {
          count = await frameLocator.getByPlaceholder(attributes.placeholder!).count();
        } else if (selector.startsWith('getByText')) {
          count = await frameLocator.getByText(attributes.text!).count();
        }

        if (count === 1) {
          return selector;
        }
      } catch {
        // ignore
      }
    }

    // 定数を使用
    return `locator('[${ATTR_FLASH_ID}="${virtualId}"]').first() /* CHECK: Unique selector not found */`;
  }
}
