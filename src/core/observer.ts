import { Page, Frame } from 'playwright';

/**
 * ページの状態を観測し、Virtual IDを注入してLLM用のテキスト表現を生成するクラス
 */
export class Observer {
  /**
   * 現在のページ状態をキャプチャし、整形された文字列を返します。
   * 全フレームを走査し、操作可能な要素にIDを付与します。
   * @param page Playwright Page object
   */
  async captureState(page: Page): Promise<string> {
    // 1. Smart Wait: DOMとネットワークの安定化を待機
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 2000 });
      // ネットワークアイドルは厳しすぎる場合があるので、必要に応じて有効化
      // await page.waitForLoadState('networkidle', { timeout: 2000 });
    } catch {
      // タイムアウトしても処理を続行する（SPAなどでロードが終わらない場合があるため）
    }

    // 2. 全フレームに対してID注入と要素抽出を実行
    const frames = page.frames();
    const allElementsInfo: string[] = [];

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

        // テキスト情報の取得と整形
        let text = (el as HTMLElement).innerText || (el as HTMLInputElement).value || '';

        // セキュリティ対策: 機密情報のマスク処理
        if (tagName === 'input') {
          const type = el.getAttribute('type')?.toLowerCase();
          if (type && ['password', 'email', 'tel', 'credit-card'].includes(type)) {
            text = '[REDACTED]';
          }
        }

        text = text.replace(/\s+/g, ' ').trim().substring(0, 50);

        // input要素の場合はplaceholderも情報として含める
        const placeholder = el.getAttribute('placeholder');
        if (placeholder) {
          text += ` (placeholder: ${placeholder})`;
        }

        const role = el.getAttribute('role') || 'none';

        // LLMが見やすいフォーマットで出力
        results.push(`[ID: ${id}] <${tagName}> Role:${role} Text:"${text}"`);
      });

      return results;
    });
  }
}
