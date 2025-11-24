import { chromium, Browser, Page } from 'playwright';
import { Brain } from './brain';
import { Observer } from './observer';
import { Executor } from './executor';
import { HistoryManager } from './history';
import { Generator } from '../tools/generator';
import ora from 'ora';
import chalk from 'chalk';

export interface FlashLoopOptions {
  startUrl?: string;
  headless?: boolean;
}

export class FlashLoop {
  private browser: Browser | null = null;
  private page: Page | null = null;
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
    const spinner = ora(`🚀 Starting FlashLoop: "${goal}"`).start();

    // ブラウザ起動
    this.browser = await chromium.launch({ headless: this.options.headless ?? false });
    this.page = await this.browser.newPage();

    // ウィンドウサイズを少し大きくしておく
    await this.page.setViewportSize({ width: 1280, height: 800 });

    if (this.options.startUrl) {
      spinner.text = `Navigating to ${this.options.startUrl}...`;
      await this.page.goto(this.options.startUrl);
    }

    // テストファイル初期化
    await this.generator.init(goal);
    spinner.succeed('Ready to start loop.');

    let stepCount = 0;
    const MAX_STEPS = 20;

    while (stepCount < MAX_STEPS) {
      stepCount++;
      const stepSpinner = ora(`Step ${stepCount}: Observing...`).start();

      try {
        // 1. Observe (Virtual ID Injection)
        const stateText = await this.observer.captureState(this.page);

        // 2. Think
        stepSpinner.text = 'Thinking...';
        const plan = await this.brain.think(goal, stateText, this.history.getHistory());

        if (plan.isFinished) {
          stepSpinner.succeed('Task Completed!');
          break;
        }

        stepSpinner.text = `Executing: ${plan.actionType} ${plan.targetId ? `on [${plan.targetId}]` : ''}`;

        // 3. Execute & Reverse Engineer
        const result = await this.executor.execute(plan, this.page);

        if (result.success) {
          stepSpinner.succeed(chalk.green(`Action Success: ${plan.thought}`));

          if (result.generatedCode) {
            console.log(chalk.gray(`  Code: ${result.generatedCode}`));
            await this.generator.appendCode(result.generatedCode);
          }

          this.history.add(`SUCCESS: ${plan.actionType} on ${plan.targetId || 'page'}`);
        } else {
          stepSpinner.fail(chalk.red(`Action Failed: ${result.error}`));
          this.history.add(`ERROR: ${result.error}. Try a different approach.`);

          // エラー時は少し待機
          // eslint-disable-next-line playwright/no-wait-for-timeout
          await this.page.waitForTimeout(2000);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        stepSpinner.fail(`System Error: ${errorMessage}`);
        break;
      }
    }

    await this.generator.finish();
    if (this.browser) await this.browser.close();

    console.log(chalk.blue(`\n📝 Test file generated: ${this.generator.getFilePath()}`));
  }
}
