import { chromium, Browser, Page } from 'playwright';
import { Brain } from './brain';
import { Observer } from './observer';
import { Executor } from './executor';
import { HistoryManager } from './history';
import { Generator } from '../tools/generator';
import { logger } from '../tools/logger';

export interface FlashLoopOptions {
  startUrl?: string;
  headless?: boolean;
}

export class FlashLoop {
  private browser: Browser | null = null;
  // 初期化を保証するため、! を使用 (start()で必ず初期化)
  private page!: Page;
  private brain: Brain;
  private observer: Observer;
  private executor: Executor;
  private history: HistoryManager;
  private generator: Generator;
  private options: FlashLoopOptions;

  constructor(options: FlashLoopOptions) {
    this.brain = new Brain();
    this.observer = new Observer();
    this.executor = new Executor();
    this.history = new HistoryManager();
    this.generator = new Generator();
    this.options = options;
  }

  async start(goal: string) {
    logger.start(`🚀 Starting FlashLoop: "${goal}"`);

    // ブラウザ起動
    this.browser = await chromium.launch({ headless: this.options.headless ?? false });
    this.page = await this.browser.newPage();

    // ウィンドウサイズを少し大きくしておく
    await this.page.setViewportSize({ width: 1280, height: 800 });

    if (this.options.startUrl) {
      logger.spinner.text = `Navigating to ${this.options.startUrl}...`;
      await this.page.goto(this.options.startUrl);
    }

    // テストファイル初期化
    await this.generator.init(goal);
    logger.stop('Ready to start loop.');

    let stepCount = 0;
    const MAX_STEPS = 20;

    while (stepCount < MAX_STEPS) {
      stepCount++;
      logger.start(`Step ${stepCount}: Observing...`);

      try {
        // 1. Observe (Virtual ID Injection)
        const stateText = await this.observer.captureState(this.page);

        // 2. Think
        logger.spinner.text = 'Thinking...';
        const plan = await this.brain.think(goal, stateText, this.history.getHistory());

        if (plan.isFinished) {
          logger.stop('Task Completed!');
          break;
        }

        logger.spinner.text = `Executing: ${plan.actionType} ${plan.targetId ? `on [${plan.targetId}]` : ''}`;

        // 3. Execute & Reverse Engineer
        const result = await this.executor.execute(plan, this.page);

        if (result.success) {
          logger.stop(); // Spinnerを止めてからログ出力
          logger.success(`Action Success: ${plan.thought}`);

          if (result.generatedCode) {
            logger.thought(`Code: ${result.generatedCode}`);
            await this.generator.appendCode(result.generatedCode);
          }

          this.history.add(`SUCCESS: ${plan.actionType} on ${plan.targetId || 'page'}`);
        } else {
          logger.fail(`Action Failed: ${result.error}`);
          this.history.add(`ERROR: ${result.error}. Try a different approach.`);

          // エラー時は少し待機
          await this.page.waitForTimeout(2000);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.fail(`System Error: ${errorMessage}`);
        break;
      }
    }

    await this.generator.finish();
    if (this.browser) await this.browser.close();

    logger.info(`📝 Test file generated: ${this.generator.getFilePath()}`);
  }
}
