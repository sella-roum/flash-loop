import { Page, Locator, FrameLocator } from 'playwright';
import { expect } from '@playwright/test';
import { ActionPlan, ExecutionResult, ElementContainer } from '../types';

/**
 * アクションを実行し、再現可能なPlaywrightコードを生成するクラス
 */
export class Executor {
  /**
   * アクションを実行し、コードを生成する
   * DOM再探索を行わず、メモリ内の情報を使用する
   */
  async execute(
    plan: ActionPlan,
    page: Page,
    elementMap: Map<string, ElementContainer>
  ): Promise<ExecutionResult> {
    try {
      // --- Meta Actions ---
      // finish アクションも終了として扱う
      if (plan.isFinished || plan.actionType === 'finish') {
        return {
          success: true,
          generatedCode: '// Task Completed based on AI decision',
          retryable: false,
        };
      }

      // --- Navigation / Page Actions ---
      if (plan.actionType === 'navigate') {
        if (!plan.value) throw new Error('Value is required for navigation');

        // URLスキームの検証
        const url = new URL(plan.value, page.url());
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new Error(`Unsupported URL scheme: ${url.protocol}`);
        }

        await page.goto(plan.value);
        return {
          success: true,
          generatedCode: `await page.goto(${JSON.stringify(plan.value)});`,
          retryable: true,
        };
      }

      if (plan.actionType === 'reload') {
        await page.reload();
        return {
          success: true,
          generatedCode: 'await page.reload();',
          retryable: true,
        };
      }

      if (plan.actionType === 'go_back') {
        await page.goBack();
        return {
          success: true,
          generatedCode: 'await page.goBack();',
          retryable: true,
        };
      }

      // --- Global Scroll (ターゲット指定なし) ---
      if (plan.actionType === 'scroll' && !plan.targetId) {
        await page.mouse.wheel(0, 500);
        // グローバルスクロールはコード生成しない（またはevaluateで記述）
        return { success: true, generatedCode: '', retryable: true };
      }

      // --- Assert URL ---
      if (plan.actionType === 'assert_url') {
        const url = plan.value || '';
        // 正規表現ではなく、文字列マッチングを使用 (ReDoS対策)
        await expect(page).toHaveURL(url, { timeout: 5000 });
        return {
          success: true,
          generatedCode: `await expect(page).toHaveURL('${url.replace(/'/g, "\\'")}');`,
          retryable: false,
        };
      }

      // --- Element Interaction ---
      // ここから先は targetId が必須
      const target = elementMap.get(plan.targetId || '');

      // 要素が見つからない場合
      if (!target) {
        throw new Error(`Virtual ID "${plan.targetId}" not found in memory.`);
      }

      // アクション実行 (Handle -> Recovery)
      // ここでDOM操作が行われる
      await this.performAction(target, plan, page, elementMap);

      // コード生成 (Metadata based)
      // DOM操作が成功していれば、メタデータからコードを生成する
      const code = this.generatePlaywrightCode(target, plan, elementMap);

      return { success: true, generatedCode: code, retryable: false };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage, retryable: true };
    }
  }

  /**
   * 実際の操作を行う。
   * まずElementHandleで試み、StaleエラーならLocator再構築でリカバリする。
   */
  private async performAction(
    target: ElementContainer,
    plan: ActionPlan,
    page: Page,
    elementMap: Map<string, ElementContainer>
  ) {
    try {
      // 1. Handleでの高速実行
      // ElementHandleがあれば、XPath等を解釈せずに直接ブラウザ内の要素を叩ける
      await this.performHandleAction(target, plan);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      // Stale Element / Detached エラーの場合のみリカバリを試みる
      if (
        msg.includes('detached') ||
        msg.includes('target closed') ||
        msg.includes('stale') ||
        msg.includes('Execution context was destroyed') ||
        msg.includes('ForceRecovery') // 意図的なリカバリ要求
      ) {
        console.warn(
          `[Executor] Action failed with handle (ID: ${target.id}). Recovering with selectors...`
        );
        await this.recoverAndExecute(target, plan, page, elementMap);
      } else {
        throw error; // その他のエラー（not visibleなど）はそのまま投げる
      }
    }
  }

  /**
   * ElementHandleに対する操作を実行
   */
  private async performHandleAction(target: ElementContainer, plan: ActionPlan) {
    const h = target.handle;
    const val = plan.value || '';

    switch (plan.actionType) {
      case 'click':
        await h.click();
        break;
      case 'dblclick':
        await h.dblclick();
        break;
      case 'right_click':
        await h.click({ button: 'right' });
        break;
      case 'hover':
        await h.hover();
        break;
      case 'focus':
        await h.focus();
        break;
      case 'fill':
        await h.fill(val);
        break;
      case 'type':
        await h.type(val);
        break;
      case 'clear':
        await h.fill('');
        break;
      case 'check':
        await h.check();
        break;
      case 'uncheck':
        await h.uncheck();
        break;
      case 'select_option':
        // valueまたはlabelで選択を試みる
        try {
          await h.selectOption({ label: val });
        } catch {
          // labelでの選択に失敗、valueで再試行
          await h.selectOption({ value: val });
        }
        break;
      case 'upload':
        await h.setInputFiles(val);
        break;
      case 'keypress':
        await h.press(val);
        break;
      case 'scroll':
        // 要素自体をスクロールさせる (コンテナの場合)
        await h.scrollIntoViewIfNeeded();
        await h.evaluate((el) => {
          // ElementHandle.evaluate の引数は Node と推論されるためキャスト
          (el as HTMLElement).scrollBy({ top: 300, behavior: 'smooth' });
        });
        break;
      case 'drag_and_drop':
        // ElementHandleにはdragToがないため、意図的にエラーを投げてLocatorリカバリへ回す
        throw new Error('ForceRecovery: Drag and drop requires Locator execution');

      // Assertions (Handleでは限定的)
      case 'assert_visible':
        if (!(await h.isVisible())) throw new Error('Element not visible');
        break;
      case 'assert_text': {
        const text = await h.innerText();
        if (!text.includes(val)) throw new Error(`Text mismatch. Found: "${text}"`);
        break;
      }
      case 'assert_value': {
        const v = await h.inputValue();
        if (v !== val) throw new Error(`Value mismatch. Found: "${v}"`);
        break;
      }
      default:
        throw new Error(`Unsupported action for handle: ${plan.actionType}`);
    }
  }

  /**
   * リカバリ実行: メタデータからLocatorを再構築して実行
   * Stale Element Error発生時や、Locator APIが必要なアクションで使用
   */
  private async recoverAndExecute(
    target: ElementContainer,
    plan: ActionPlan,
    page: Page,
    elementMap: Map<string, ElementContainer>
  ) {
    // 1. コンテキストの構築 (Nested Iframe対応)
    const context = this.buildContext(page, target.frameSelectorChain);

    // 2. Locatorの再構築
    const locator = this.reconstructLocator(context, target);
    const val = plan.value || '';

    // 3. Locatorでの実行
    switch (plan.actionType) {
      case 'click':
        await locator.click();
        break;
      case 'dblclick':
        await locator.dblclick();
        break;
      case 'right_click':
        await locator.click({ button: 'right' });
        break;
      case 'hover':
        await locator.hover();
        break;
      case 'focus':
        await locator.focus();
        break;
      case 'fill':
        await locator.fill(val);
        break;
      case 'type':
        await locator.pressSequentially(val);
        break;
      case 'clear':
        await locator.clear();
        break;
      case 'check':
        await locator.check();
        break;
      case 'uncheck':
        await locator.uncheck();
        break;
      case 'select_option':
        try {
          await locator.selectOption({ label: val });
        } catch {
          await locator.selectOption({ value: val });
        }
        break;
      case 'upload':
        await locator.setInputFiles(val);
        break;
      case 'keypress':
        await locator.press(val);
        break;
      case 'drag_and_drop': {
        const target2 = elementMap.get(plan.targetId2 || '');
        if (target2) {
          const context2 = this.buildContext(page, target2.frameSelectorChain);
          const locator2 = this.reconstructLocator(context2, target2);
          await locator.dragTo(locator2);
        } else {
          throw new Error('Target 2 not found for drag and drop');
        }
        break;
      }
      case 'scroll':
        await locator.evaluate((el) =>
          (el as HTMLElement).scrollBy({ top: 300, behavior: 'smooth' })
        );
        break;
      // Assertions
      case 'assert_visible':
        await expect(locator).toBeVisible();
        break;
      case 'assert_text':
        await expect(locator).toContainText(val);
        break;
      case 'assert_value':
        await expect(locator).toHaveValue(val);
        break;
      default:
        throw new Error(`Unsupported action for locator recovery: ${plan.actionType}`);
    }
  }

  /**
   * フレームチェーンからコンテキスト(FrameLocator)を再帰的に構築
   */
  private buildContext(page: Page, chain: string[]): Page | FrameLocator {
    let context: Page | FrameLocator = page;
    for (const selector of chain) {
      context = context.frameLocator(selector);
    }
    return context;
  }

  /**
   * コード生成用のベース文字列を作成 (例: page.frameLocator('A').frameLocator('B'))
   */
  private buildContextCode(chain: string[]): string {
    let code = 'page';
    for (const selector of chain) {
      code += `.frameLocator('${selector}')`;
    }
    return code;
  }

  /**
   * メタデータから最適なLocatorオブジェクトを生成するヘルパー
   */
  private reconstructLocator(context: Page | FrameLocator, target: ElementContainer): Locator {
    const s = target.selectors;

    // 優先順位: TestID > Role > Placeholder > Text > XPath
    if (s.testId) {
      return context.getByTestId(s.testId);
    }
    if (s.role) {
      // Playwrightの型定義にキャスト
      return context.getByRole(s.role.role as Parameters<Page['getByRole']>[0], {
        name: s.role.name,
        exact: true,
      });
    }
    if (s.placeholder) {
      return context.getByPlaceholder(s.placeholder);
    }
    if (s.text) {
      return context.getByText(s.text);
    }
    // 最終手段: XPath (Shadow DOM内だと失敗する可能性が高いが、一応フォールバック)
    return context.locator(target.xpath);
  }

  /**
   * 再現性のあるPlaywrightコード文字列を生成する
   */
  private generatePlaywrightCode(
    target: ElementContainer,
    plan: ActionPlan,
    elementMap: Map<string, ElementContainer>
  ): string {
    // 1. ベース部分 (Nested Iframe対応)
    const base = this.buildContextCode(target.frameSelectorChain);

    // 2. セレクタ部分 (文字列)
    // インジェクション対策として JSON.stringify を使用
    let selectorCode = '';
    const s = target.selectors;

    if (s.testId) {
      selectorCode = `.getByTestId(${JSON.stringify(s.testId)})`;
    } else if (s.role) {
      selectorCode = `.getByRole(${JSON.stringify(s.role.role)}, { name: ${JSON.stringify(s.role.name)}, exact: true })`;
    } else if (s.placeholder) {
      selectorCode = `.getByPlaceholder(${JSON.stringify(s.placeholder)})`;
    } else if (s.text) {
      selectorCode = `.getByText(${JSON.stringify(s.text)})`;
    } else {
      // XPathフォールバック時は警告コメントを入れる
      selectorCode = `.locator(${JSON.stringify(target.xpath)}) /* Warning: Robust selector not found */`;
    }

    // 3. アクション部分
    const val = plan.value ? JSON.stringify(plan.value) : '';
    let actionCode = '';

    switch (plan.actionType) {
      case 'click':
        actionCode = '.click()';
        break;
      case 'dblclick':
        actionCode = '.dblclick()';
        break;
      case 'right_click':
        actionCode = ".click({ button: 'right' })";
        break;
      case 'hover':
        actionCode = '.hover()';
        break;
      case 'focus':
        actionCode = '.focus()';
        break;
      case 'fill':
        actionCode = `.fill(${val})`;
        break;
      case 'type':
        actionCode = `.pressSequentially(${val})`;
        break;
      case 'clear':
        actionCode = '.clear()';
        break;
      case 'check':
        actionCode = '.check()';
        break;
      case 'uncheck':
        actionCode = '.uncheck()';
        break;
      case 'select_option':
        actionCode = `.selectOption(${val})`;
        break; // label or value
      case 'upload':
        actionCode = `.setInputFiles(${val})`;
        break;
      case 'keypress':
        actionCode = `.press(${val})`;
        break;

      case 'drag_and_drop': {
        // D&Dの場合、ターゲット2のセレクタも必要
        const target2 = elementMap.get(plan.targetId2 || '');
        if (target2) {
          const base2 = this.buildContextCode(target2.frameSelectorChain);
          let sel2 = '';
          const s2 = target2.selectors;
          if (s2.testId) sel2 = `.getByTestId(${JSON.stringify(s2.testId)})`;
          else if (s2.role)
            sel2 = `.getByRole(${JSON.stringify(s2.role.role)}, { name: ${JSON.stringify(s2.role.name)}, exact: true })`;
          else sel2 = `.locator(${JSON.stringify(target2.xpath)})`;

          actionCode = `.dragTo(${base2}${sel2})`;
        } else {
          actionCode = '.dragTo(/* Unknown Target */)';
        }
        break;
      }

      // Assertions
      case 'assert_visible':
        return `await expect(${base}${selectorCode}).toBeVisible();`;
      case 'assert_text':
        return `await expect(${base}${selectorCode}).toContainText(${val});`;
      case 'assert_value':
        return `await expect(${base}${selectorCode}).toHaveValue(${val});`;

      // Scroll (通常はコード化しないが、明示的に書くなら)
      case 'scroll':
        return `// Action: Scroll ${base}${selectorCode}`;

      default:
        actionCode = '/* Unknown Action */';
    }

    return `await ${base}${selectorCode}${actionCode};`;
  }
}
