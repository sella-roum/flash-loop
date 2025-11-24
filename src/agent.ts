/**
 * src/agent.ts
 * Playwrightテスト内から呼び出すためのヘルパー関数
 */
import { Page, test } from '@playwright/test';
import { FlashLoop } from './core/loop';
import { ConsoleLogger } from './tools/logger';

export interface AgentOptions {
  maxSteps?: number;
}

/**
 * Flash-Loop AI Agent
 * Playwrightテスト内で自律操作を実行し、コードを提案します。
 *
 * @param page PlaywrightのPageオブジェクト
 * @param goal 達成したいゴール（自然言語）
 * @param options オプション（最大ステップ数など）
 * @returns 生成されたPlaywrightコード
 */
export async function agent(page: Page, goal: string, options: AgentOptions = {}) {
  // 1. CIガード: 環境変数で許可されていない限り、CIでの実行をスキップ
  // CI環境変数は多くのCIサービスで true に設定されています
  if (process.env.CI && !process.env.ALLOW_AI_IN_CI) {
    const msg = `⚠️ [Flash-Loop] Skipped in CI environment: "${goal}"`;
    console.log(msg);

    // Playwrightレポートにスキップ情報を記録
    test.info().annotations.push({
      type: 'skip',
      description: 'AI Agent skipped in CI environment to prevent API costs.',
    });

    return '// AI Agent skipped in CI';
  }

  // 2. Playwright Step として実行
  return await test.step(`🤖 AI Agent: ${goal}`, async () => {
    // 3. タイムアウト延長 (AIは時間がかかるため +90秒)
    test.setTimeout(test.info().timeout + 90000);

    // テスト実行用の設定でFlashLoopを初期化
    const loop = new FlashLoop({
      page,
      maxSteps: options.maxSteps || 15,
      logger: new ConsoleLogger(), // テスト出力に適したロガーを使用
    });

    try {
      // 4. 実行
      const generatedCode = await loop.start(goal);

      // 5. 結果をレポートに添付
      await test.info().attach('ai-generated-code.ts', {
        body: generatedCode,
        contentType: 'text/typescript',
      });

      // コンソールにも出力 (開発者がコピペしやすいように)
      console.log(`\n--- 🤖 AI Generated Code for "${goal}" ---`);
      console.log(generatedCode);
      console.log('------------------------------------------\n');

      return generatedCode;
    } catch (error) {
      console.error('AI Agent Error:', error);
      // エラーを再スローしてテストを失敗させる
      throw error;
    } finally {
      // 6. DOMクリーンアップ (必須)
      // 途中でエラーになっても、注入したIDが残らないようにする
      await loop.observer.cleanup(page);
    }
  });
}
