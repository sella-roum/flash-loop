import { chromium, Page, Browser } from 'playwright';
import { Brain } from './llm';
import { Generator } from '../tools/generator';

export class FlashLoop {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private brain: Brain;
  private generator: Generator;
  private history: string[] = [];

  constructor() {
    this.brain = new Brain();
    this.generator = new Generator();
  }

  async start(goal: string) {
    console.log(`🚀 FlashLoop starting: "${goal}"`);

    this.browser = await chromium.launch({ headless: false }); // デバッグ用にヘッドあり
    this.page = await this.browser.newPage();

    // 初期化コード（Generator用）
    await this.generator.init();

    let isFinished = false;

    while (!isFinished) {
      // 1. 観察 (Observation)
      // Playwrightのアクセシビリティスナップショットを使用
      // 必要に応じて snapshot.ts で整形処理を挟むと精度が向上します
      const snapshot = await this.page.accessibility.snapshot();
      const snapshotText = JSON.stringify(snapshot, null, 2); // 簡易的にJSON化

      // 2. 思考 (Reasoning)
      console.log('Thinking...');
      const action = await this.brain.generateAction(goal, snapshotText, this.history);

      console.log(`🤖 Thought: ${action.thought}`);
      console.log(`pw> ${action.code}`);

      if (action.isFinished) {
        console.log('✅ Task completed!');
        isFinished = true;
        break;
      }

      // 3. 実行 (Execution) & 4. 修復 (Healing)
      try {
        // 安全に実行するためにFunctionコンストラクタを使用
        // 実際には sandbox 環境での実行が望ましい
        const runStep = new Function('page', `return (async () => { ${action.code} })()`);
        await runStep(this.page);

        // 成功: 履歴に追加し、テストファイルに記録
        this.history.push(`SUCCESS: ${action.code}`);
        await this.generator.appendCode(action.code);
      } catch (error: any) {
        console.error(`❌ Execution Failed: ${error.message}`);
        console.log('🩹 Healing...');

        // 失敗: 履歴にエラーを追加して、ループの先頭に戻ることで再推論（Healing）させる
        this.history.push(`ERROR executing "${action.code}": ${error.message}`);
        // ここで wait を入れないと無限ループで API 制限にかかる可能性がある
        await this.page.waitForTimeout(1000);
      }
    }

    // 最後にファイルを閉じる処理を追加
    await this.generator.finish();

    await this.browser.close();
    console.log(`📝 Test file generated: ${this.generator.getFilePath()}`);
  }
}
