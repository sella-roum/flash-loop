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
        const index = parseInt(target, 10);

        // 実行
        await contextManager.switchToTab(isNaN(index) ? target : index);

        let generatedCode = '';
        if (!isNaN(index)) {
          // インデックス指定の場合
          generatedCode = `await page.context().pages()[${index}].bringToFront();`;
        } else {
          // 文字列（タイトル/URL）指定の場合のスニペット生成
          const escapedTarget = target.replace(/'/g, "\\'");
          generatedCode = `
// Switch to tab matching "${escapedTarget}"
for (const p of page.context().pages()) {
  if (p.url().includes('${escapedTarget}') || (await p.title()).includes('${escapedTarget}')) {
    await p.bringToFront();
    break;
  }
}`.trim();
        }

        return {
          success: true,
          generatedCode,
          retryable: false,
        };
      }

      if (plan.actionType === 'close_tab') {
        await contextManager.closeActiveTab();
        return {
          success: true,
          generatedCode: `await page.close();`,
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
        const action = plan.value === 'accept' ? 'accept' : 'dismiss';
        await contextManager.handleDialog(action);
        return {
          success: true,
          generatedCode: `// Note: Simple dialog handling. (Runtime uses ContextManager for auto-dismiss)
page.once('dialog', dialog => dialog.${action}());`,
          retryable: false,
        };
      }

      if (plan.actionType === 'navigate') {
        if (!plan.value) throw new Error('navigate action requires a URL in value.');
        await page.goto(plan.value);
        return {
          success: true,
          generatedCode: `await page.goto('${plan.value.replace(/'/g, "\\'")}');`,
          retryable: true,
        };
      }

      if (plan.actionType === 'reload') {
        await page.reload();
        return { success: true, generatedCode: 'await page.reload();', retryable: true };
      }

      if (plan.actionType === 'go_back') {
        await page.goBack();
        return { success: true, generatedCode: 'await page.goBack();', retryable: true };
      }

      if (plan.isFinished || plan.actionType === 'finish') {
        return { success: true, generatedCode: '// Task Finished', retryable: false };
      }

      // --- Element Interaction ---
      if (!plan.targetId) throw new Error('Target ID is missing for this action.');
      const target = elementMap.get(plan.targetId);
      if (!target) throw new Error(`Element with ID "${plan.targetId}" not found in memory.`);

      // 1. Double-Check
      const { locator, code: selectorCode } = await this.getRobustLocator(target, page);

      // Drag and Drop 用の補助ロケータ解決
      let auxLocator: Locator | undefined;
      let auxCode: string | undefined;

      if (plan.actionType === 'drag_and_drop') {
        if (!plan.targetId2) throw new Error('Drag and drop requires targetId2');
        const target2 = elementMap.get(plan.targetId2);
        if (!target2) throw new Error(`Target 2 (ID: ${plan.targetId2}) not found`);
        const res2 = await this.getRobustLocator(target2, page);
        auxLocator = res2.locator;
        auxCode = res2.code;
      }

      // 2. Execute Action
      await this.performLocatorAction(locator, plan, page, auxLocator);

      // 3. Stabilization
      await this.waitForStabilization(page);

      return {
        success: true,
        generatedCode: this.generateCode(selectorCode, plan, auxCode),
        retryable: false,
      };
    } catch (error) {
      const translatedError = ErrorTranslator.translate(error);
      const msg = String(error);

      const isFatal =
        msg.includes('requires a target') ||
        msg.includes('requires targetId') ||
        msg.includes('requires a URL') ||
        msg.includes('Unsupported action') ||
        msg.includes('not found in memory') ||
        msg.includes('not found') || // "Target ... not found" も含む
        msg.includes('Target ID is missing');

      return {
        success: false,
        error: translatedError,
        userGuidance: translatedError,
        retryable: !isFatal,
      };
    }
  }

  /**
   * ElementContainerから「現在動作する」最適なLocatorを生成・検証する
   */
  private async getRobustLocator(
    target: ElementContainer,
    page: Page
  ): Promise<{ locator: Locator; code: string }> {
    const context = this.buildContext(page, target.frameSelectorChain);
    const contextCode = this.buildContextCode(target.frameSelectorChain);

    const s = target.selectors;
    const candidates: Array<{ get: () => Locator; code: string }> = [];

    if (s.testId) {
      candidates.push({
        get: () => context.getByTestId(s.testId!),
        code: `.getByTestId('${s.testId.replace(/'/g, "\\'")}')`,
      });
    }
    if (s.role && s.role.name) {
      const role = s.role.role as Parameters<Page['getByRole']>[0];
      const name = s.role.name;
      candidates.push({
        get: () => context.getByRole(role, { name: name, exact: true }),
        code: `.getByRole('${role}', { name: '${name.replace(/'/g, "\\'")}', exact: true })`,
      });
    }
    if (s.placeholder) {
      candidates.push({
        get: () => context.getByPlaceholder(s.placeholder!),
        code: `.getByPlaceholder('${s.placeholder.replace(/'/g, "\\'")}')`,
      });
    }
    if (s.text) {
      candidates.push({
        get: () => context.getByText(s.text!, { exact: true }),
        code: `.getByText('${s.text!.replace(/'/g, "\\'")}', { exact: true })`,
      });
    }
    // XPath
    candidates.push({
      get: () => context.locator(target.xpath),
      code: `.locator('${target.xpath.replace(/'/g, "\\'")}')`,
    });

    for (const cand of candidates) {
      try {
        const loc = cand.get();
        if ((await loc.count()) === 1 && (await loc.isVisible())) {
          return { locator: loc, code: `${contextCode}${cand.code}` };
        }
      } catch {
        // next candidate
      }
    }

    throw new Error(
      'Failed to generate a robust selector for this element. It might be hidden or dynamic.'
    );
  }

  private async performLocatorAction(
    locator: Locator,
    plan: ActionPlan,
    page: Page,
    auxLocator?: Locator
  ) {
    const val = plan.value || '';
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
      case 'clear':
        await locator.clear();
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
      case 'upload':
        // 修正: カンマ区切りで複数ファイル対応
        {
          const files = val.includes(',') ? val.split(',').map((f) => f.trim()) : val;
          await locator.setInputFiles(files);
        }
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
      case 'assert_url':
        // シンプルなURLチェックに変更（過剰なRegExpエスケープを回避）
        await expect(page).toHaveURL(val);
        break;

      case 'scroll':
        await locator.scrollIntoViewIfNeeded();
        break;

      case 'drag_and_drop': {
        if (!auxLocator) throw new Error('Drag and drop requires auxiliary locator (target2)');
        await locator.dragTo(auxLocator);
        break;
      }

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
    for (const sel of chain) code += `.frameLocator('${sel.replace(/'/g, "\\'")}')`;
    return code;
  }

  private generateCode(selectorCode: string, plan: ActionPlan, auxCode?: string): string {
    const val = plan.value ? `'${plan.value.replace(/'/g, "\\'")}'` : '';

    switch (plan.actionType) {
      case 'click':
        return `await ${selectorCode}.click();`;
      case 'dblclick':
        return `await ${selectorCode}.dblclick();`;
      case 'right_click':
        return `await ${selectorCode}.click({ button: 'right' });`;
      case 'hover':
        return `await ${selectorCode}.hover();`;
      case 'fill':
        return `await ${selectorCode}.fill(${val});`;
      case 'type':
        return `await ${selectorCode}.pressSequentially(${val});`;
      case 'clear':
        return `await ${selectorCode}.clear();`;
      case 'check':
        return `await ${selectorCode}.check();`;
      case 'uncheck':
        return `await ${selectorCode}.uncheck();`;

      case 'upload': {
        const rawVal = plan.value || '';
        if (rawVal.includes(',')) {
          // 'file1.png', 'file2.png' -> "'file1.png', 'file2.png'"
          // 配列リテラルとしてコード生成
          const files = rawVal.split(',').map((f) => `'${f.trim().replace(/'/g, "\\'")}'`);
          return `await ${selectorCode}.setInputFiles([${files.join(', ')}]);`;
        }
        // 単一ファイル
        return `await ${selectorCode}.setInputFiles(${val});`;
      }

      case 'keypress':
        return `await ${selectorCode}.press(${val});`;

      case 'focus':
        return `await ${selectorCode}.focus();`;

      case 'select_option':
        return `await ${selectorCode}.selectOption({ label: ${val} }).catch(() => ${selectorCode}.selectOption({ value: ${val} }));`;

      case 'assert_visible':
        return `await expect(${selectorCode}).toBeVisible();`;
      case 'assert_text':
        return `await expect(${selectorCode}).toContainText(${val});`;
      case 'assert_value':
        return `await expect(${selectorCode}).toHaveValue(${val});`;
      case 'assert_url':
        return `await expect(page).toHaveURL(${val});`;

      case 'drag_and_drop':
        return `await ${selectorCode}.dragTo(${auxCode || '/* Unknown Target */'});`;

      case 'scroll':
        return `await ${selectorCode}.scrollIntoViewIfNeeded();`;

      default:
        // 引数があるかわからないため、安全策としてvalを入れているが、
        // 上記で主要なアクションはカバーされているはず
        return `await ${selectorCode}.${plan.actionType}(${val});`;
    }
  }

  private async waitForStabilization(page: Page) {
    try {
      await page.waitForLoadState('domcontentloaded');
      // SPA対応: 短い networkidle も待機
      await page.waitForLoadState('networkidle', { timeout: 1000 }).catch(() => {});
    } catch {
      // ignore error (timeout etc)
    }
  }
}
