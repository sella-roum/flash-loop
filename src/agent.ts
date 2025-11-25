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
export async function agent(
  page: Page,
  goal: string,
  options: AgentOptions = {}
) {
  // 1. CIガード
  if (process.env.CI && !process.env.ALLOW_AI_IN_CI) {
    console.log(`⚠️ [Flash-Loop] Skipped in CI environment: "${goal}"`);

    // Playwrightレポートにスキップ情報を記録
    test.info().annotations.push({
      type: 'skip',
      description: 'AI Agent skipped in CI environment to prevent API costs.',
    });

    return '// AI Agent skipped in CI';
  }

  // 2. Playwright Step として実行
  return await test.step(`🤖 AI Agent: ${goal}`, async () => {
    // 3. タイムアウト延長 (AIは時間がかかるため)
    const currentTimeout = test.info().timeout;
    const MIN_AI_TIMEOUT = 120000;

    if (currentTimeout < MIN_AI_TIMEOUT) {
      test.setTimeout(MIN_AI_TIMEOUT);
    }

    // FlashLoopの初期化 (ページインスタンスを渡す)
    const loop = new FlashLoop({
      page,
      maxSteps: options.maxSteps || 15,
      logger: new ConsoleLogger(), // テスト出力に適したロガー
    });

    try {
      // 4. 実行
      const generatedCode = await loop.start(goal);

      // 5. 結果をレポートに添付
      await test.info().attach('ai-generated-code.ts', {
        body: generatedCode,
        contentType: 'text/typescript',
      });

      console.log(`\n--- 🤖 AI Generated Code for "${goal}" ---`);
      console.log(generatedCode);
      console.log('------------------------------------------\n');

      return generatedCode;
    } catch (error) {
      console.error('AI Agent Error:', error);
      throw error;
    } finally {
      // クリーンアップはIn-Memory方式になったため基本不要だが、
      // 将来的な拡張のために呼び出しておく
      await loop.cleanup();
    }
  });
}
