/**
 * src/core/executor.ts
 * AIの意思決定を実行に移す。
 * 堅牢性を最優先し、Locatorの一意性を検証してから実行する (Double-Check Strategy)
 */
import { Page, Locator, FrameLocator } from 'playwright';
import { expect } from '@playwright/test';
import { ActionPlan, ExecutionResult, ElementContainer } from '../types';
import { ContextManager } from './context-manager';
import { ErrorTranslator } from './error-translator';

export class Executor {
  /**
   * アクションを実行し、検証済みコードを生成する
   */
  async execute(
    plan: ActionPlan,
    contextManager: ContextManager,
    elementMap: Map<string, ElementContainer>
  ): Promise<ExecutionResult> {
    try {
      const page = contextManager.getActivePage();

      // --- Context / Meta Actions ---
      if (plan.actionType === 'switch_tab') {
        const target = plan.value || plan.targetId || '';
        if (!target) throw new Error('Switch tab requires a target (index or title).');
        // 数値か文字列か判定
        const index = parseInt(target, 10);
        await contextManager.switchToTab(isNaN(index) ? target : index);
        return {
          success: true,
          generatedCode: `// Action: Switch tab to "${target}" (Context switching not recorded in test code yet)`,
          retryable: false,
        };
      }

      if (plan.actionType === 'wait_for_element') {
        if (!plan.targetId) throw new Error('wait_for_element requires targetId');
        const target = elementMap.get(plan.targetId);
        if (!target) throw new Error(`Target ${plan.targetId} not found`);

        const { locator, code } = await this.getRobustLocator(target, page);
        await locator.waitFor({ state: 'visible', timeout: 10000 });
        return {
          success: true,
          generatedCode: `await ${code}.waitFor({ state: 'visible' });`,
          retryable: true,
        };
      }

      if (plan.actionType === 'handle_dialog') {
        // ダイアログ処理 (ContextManager経由)
        const action = plan.value === 'accept' ? 'accept' : 'dismiss';
        await contextManager.handleDialog(action);
        return {
          success: true,
          generatedCode: `page.once('dialog', dialog => dialog.${action}());`,
          retryable: false,
        };
      }

      if (plan.actionType === 'navigate') {
        await page.goto(plan.value!);
        return {
          success: true,
          generatedCode: `await page.goto('${plan.value}');`,
          retryable: true,
        };
      }

      if (plan.isFinished || plan.actionType === 'finish') {
        return { success: true, generatedCode: '// Task Finished', retryable: false };
      }

      // --- Element Interaction ---
      if (!plan.targetId) throw new Error('Target ID is missing for this action.');
      const target = elementMap.get(plan.targetId);
      if (!target) throw new Error(`Element with ID "${plan.targetId}" not found in memory.`);

      // 1. Double-Check: 最適なLocatorを計算し、一意性を検証する
      const { locator, code: selectorCode } = await this.getRobustLocator(target, page);

      // 2. Execute Action using the VERIFIED locator
      // これにより「動くコード」でのみ実行されることが保証される
      await this.performLocatorAction(locator, plan, elementMap, page);

      // 3. Stabilization (Smart Wait)
      // アクション後、スピナー等が消えるのを待つなどの汎用待機を入れる
      await this.waitForStabilization(page);

      return {
        success: true,
        generatedCode: this.generateCode(selectorCode, plan),
        retryable: false,
      };
    } catch (error) {
      // エラー翻訳
      const translatedError = ErrorTranslator.translate(error);
      return {
        success: false,
        error: translatedError, // AIには翻訳されたエラーを返す
        userGuidance: translatedError,
        retryable: true,
      };
    }
  }

  /**
   * ElementContainerから「現在動作する」最適なLocatorを生成・検証する
   * Double-Check Strategy の核となるメソッド
   */
  private async getRobustLocator(
    target: ElementContainer,
    page: Page
  ): Promise<{ locator: Locator; code: string }> {
    const context = this.buildContext(page, target.frameSelectorChain);
    const contextCode = this.buildContextCode(target.frameSelectorChain);

    const s = target.selectors;
    const candidates: Array<{ get: () => Locator; code: string }> = [];

    // 候補リスト作成 (優先度順)
    if (s.testId) {
      candidates.push({
        get: () => context.getByTestId(s.testId!),
        code: `.getByTestId('${s.testId}')`,
      });
    }
    if (s.role) {
      // TypeScriptキャスト修正: Playwrightの型定義を使用
      const role = s.role!.role as Parameters<Page['getByRole']>[0];
      candidates.push({
        get: () => context.getByRole(role, { name: s.role!.name, exact: true }),
        code: `.getByRole('${s.role!.role}', { name: '${s.role!.name.replace(/'/g, "\\'")}', exact: true })`,
      });
    }
    if (s.placeholder) {
      candidates.push({
        get: () => context.getByPlaceholder(s.placeholder!),
        code: `.getByPlaceholder('${s.placeholder}')`,
      });
    }
    if (s.text) {
      candidates.push({
        get: () => context.getByText(s.text!, { exact: true }),
        code: `.getByText('${s.text!.replace(/'/g, "\\'")}', { exact: true })`,
      });
    }
    // XPath (Fallback)
    candidates.push({
      get: () => context.locator(target.xpath),
      code: `.locator('${target.xpath.replace(/'/g, "\\'")}')`,
    });

    // 検証ループ (Dry Run Verification)
    for (const cand of candidates) {
      try {
        const loc = cand.get();
        // 要素がDOMに存在し、かつ一意であることを確認
        // isVisible() もチェックすることで「見えない要素」を誤操作するリスクを減らす
        if ((await loc.count()) === 1 && (await loc.isVisible())) {
          return { locator: loc, code: `${contextCode}${cand.code}` };
        }
      } catch {
        // 無視して次の候補へ
      }
    }

    // 全滅した場合の最終手段
    throw new Error(
      'Failed to generate a robust selector for this element. It might be hidden or dynamic.'
    );
  }

  private async performLocatorAction(
    locator: Locator,
    plan: ActionPlan,
    _elementMap: Map<string, ElementContainer>, // 未使用変数を_付きに変更
    _page: Page // 未使用変数を_付きに変更
  ) {
    const val = plan.value || '';
    switch (plan.actionType) {
      case 'click':
        await locator.click();
        break;
      case 'dblclick':
        await locator.dblclick();
        break;
      case 'hover':
        await locator.hover();
        break;
      case 'fill':
        await locator.fill(val);
        break;
      case 'type':
        await locator.pressSequentially(val);
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
      case 'keypress':
        await locator.press(val);
        break;
      case 'assert_visible':
        await expect(locator).toBeVisible();
        break;
      case 'assert_text':
        await expect(locator).toContainText(val);
        break;
      case 'scroll':
        await locator.scrollIntoViewIfNeeded();
        break;
      // 必要に応じてドラッグアンドドロップなどを実装する場合ここで _elementMap を使う
      default:
        throw new Error(`Unsupported action: ${plan.actionType}`);
    }
  }

  private buildContext(page: Page, chain: string[]): Page | FrameLocator {
    let context: Page | FrameLocator = page;
    for (const sel of chain) context = context.frameLocator(sel);
    return context;
  }

  private buildContextCode(chain: string[]): string {
    let code = 'page';
    for (const sel of chain) code += `.frameLocator('${sel}')`;
    return code;
  }

  private generateCode(selectorCode: string, plan: ActionPlan): string {
    const val = plan.value ? `'${plan.value.replace(/'/g, "\\'")}'` : '';
    switch (plan.actionType) {
      case 'click':
        return `await ${selectorCode}.click();`;
      case 'fill':
        return `await ${selectorCode}.fill(${val});`;
      case 'assert_visible':
        return `await expect(${selectorCode}).toBeVisible();`;
      case 'assert_text':
        return `await expect(${selectorCode}).toContainText(${val});`;
      default:
        return `await ${selectorCode}.${plan.actionType}(${val});`;
    }
  }

  private async waitForStabilization(page: Page) {
    try {
      await page.waitForLoadState('domcontentloaded');
    } catch {
      // ignore error (timeout etc)
    }
  }
}
