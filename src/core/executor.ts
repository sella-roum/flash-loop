import { Page, Frame, ElementHandle } from 'playwright';
import { ActionPlan, ExecutionResult } from '../types';

/**
 * アクションを実行し、再現可能なPlaywrightコードを生成するクラス
 */
export class Executor {
  /**
<<<<<<< Updated upstream
   * ActionPlanに基づいて操作を実行します。
   * Virtual IDで操作し、事後的にベストなセレクタを逆算・検証します。
   */
  async execute(
    plan: ActionPlan,
    page: Page,
    elementMap: Map<string, ElementContainer>
  ): Promise<ExecutionResult> {
    try {
      // --- Meta Actions ---
      if (plan.isFinished) {
        return {
          success: true,
          generatedCode: '// Task Completed based on AI decision',
          retryable: false,
        };
      }

      // --- Navigation / Page Actions ---
      if (plan.actionType === 'navigate') {
        if (!plan.value) throw new Error('Value is required for navigation');
        await page.goto(plan.value);
        return {
          success: true,
          generatedCode: `await page.goto('${plan.value}');`,
          retryable: true,
        };
      }

      // --- Interaction Actions (click, fill, assertion) ---
      // 1. ターゲット要素を全フレームから特定
      if (!plan.targetId) throw new Error('Target ID is required for interaction');

      const { elementHandle, frame } = await this.findTargetInFrames(page, plan.targetId);

      if (!elementHandle || !frame) {
        throw new Error(
          `Target element with Virtual ID "${plan.targetId}" not found in any frame.`
        );
      }

      // 2. セレクタの逆算と一意性検証 (Reverse Engineering)
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
        if (name) frameSelector = `iframe[name=${JSON.stringify(name)}]`;
        else if (id) frameSelector = `iframe[id=${JSON.stringify(id)}]`;
        else if (src) frameSelector = `iframe[src=${JSON.stringify(src)}]`;
        else frameSelector = `iframe[src=${JSON.stringify(frame.url())}]`; // 最終手段

        // JSON.stringifyでエスケープ済みのセレクタ文字列を埋め込む
        baseLocatorCode = `page.frameLocator(${JSON.stringify(frameSelector)}).${bestSelector}`;
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
        // アサーション: 要素が表示されていることを確認
        // ランタイムではPlaywright Testのexpectを使わず、条件分岐で判定する
        const isVisible = await elementHandle.isVisible();
        if (!isVisible) {
          throw new Error('Assertion Failed: Element is not visible.');
        }

        // 生成コードはLocatorベースにする
        generatedCode = `await expect(${baseLocatorCode}).toBeVisible();`;
      } else {
        // 未知のアクションタイプへの防御
        throw new Error(`Unsupported actionType: ${plan.actionType}`);
=======
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
>>>>>>> Stashed changes
      }

      // --- Assert URL ---
      if (plan.actionType === 'assert_url') {
        const url = plan.value || '';
        await expect(page).toHaveURL(new RegExp(url));
        return {
          success: true,
          generatedCode: `await expect(page).toHaveURL(/${url}/);`,
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
      await this.performAction(target, plan, page, elementMap);

      // コード生成 (Metadata based)
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
<<<<<<< Updated upstream
    id: string
  ): Promise<{ elementHandle: ElementHandle | null; frame: Frame | null }> {
    const frames = page.frames();

    for (const frame of frames) {
      try {
        const handle = await frame.$(`[data-flash-id="${id}"]`);
        if (handle) {
          return { elementHandle: handle, frame };
        }
      } catch {
        // アクセスできないフレームは無視
=======
    elementMap: Map<string, ElementContainer>
  ) {
    try {
      // 1. Handleでの高速実行
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
>>>>>>> Stashed changes
      }
    }
  }

  /**
   * 要素のハンドルから、永続的に使用可能なベストなセレクタを逆算し、
   * そのセレクタがページ内で一意(Unique)であることを検証する
   */
  private async calculateUniqueSelector(
    frame: Frame,
    handle: ElementHandle,
    virtualId: string
  ): Promise<string> {
    // 1. 候補となるセレクタのパーツをブラウザ内で取得
    const attributes = await frame.evaluate((el) => {
      const htmlEl = el as HTMLElement;
      return {
        testid: htmlEl.getAttribute('data-testid'),
        role: htmlEl.getAttribute('role'),
        tagName: htmlEl.tagName.toLowerCase(),
        placeholder: htmlEl.getAttribute('placeholder'),
        text: htmlEl.innerText?.trim().slice(0, 30), // 長すぎるテキストは避ける
        ariaLabel: htmlEl.getAttribute('aria-label'),
        type: htmlEl.getAttribute('type'),
      };
    }, handle);

    // 2. 候補リストの作成 (優先度順)
    const candidates: string[] = [];
    // 生成コードが壊れないよう値をエスケープする
    const s = (val: string) => JSON.stringify(val);

    // A. data-testid (最強)
    if (attributes.testid) {
      candidates.push(`getByTestId(${s(attributes.testid)})`);
    }

    // B. Role + Name (Playwright推奨)
    const name = attributes.ariaLabel || attributes.text;
    const role =
      attributes.role ||
      (['button', 'link', 'checkbox', 'radio'].includes(attributes.tagName)
        ? attributes.tagName
        : null);

    if (role && name) {
      candidates.push(`getByRole(${s(role)}, { name: ${s(name)} })`);
    }

    // C. Placeholder (Input系)
    if (attributes.placeholder) {
      candidates.push(`getByPlaceholder(${s(attributes.placeholder)})`);
    }

    // D. Text content
    if (attributes.text) {
      candidates.push(`getByText(${s(attributes.text)})`);
    }

    // 3. 一意性の検証 (Uniqueness Check)
    for (const selector of candidates) {
      try {
        let count = 0;
        if (selector.startsWith('getByTestId')) {
          count = await frame.getByTestId(attributes.testid!).count();
        } else if (selector.startsWith('getByRole')) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (role && name) count = await frame.getByRole(role as any, { name }).count();
        } else if (selector.startsWith('getByPlaceholder')) {
          count = await frame.getByPlaceholder(attributes.placeholder!).count();
        } else if (selector.startsWith('getByText')) {
          count = await frame.getByText(attributes.text!).count();
        }

        if (count === 1) {
          return selector; // 一意なセレクタが見つかった！
        }
      } catch {
        // セレクタが無効等の場合は次へ
      }
    }

    // 4. フォールバック
    return `locator('[data-flash-id="${virtualId}"]').first() /* CHECK: Unique selector not found */`;
  }
}
