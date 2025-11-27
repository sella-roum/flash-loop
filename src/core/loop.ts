/**
 * src/core/loop.ts
 * エージェントのメインループ
 */
import { chromium, Browser } from 'playwright';
import { Brain } from './brain';
import { Observer } from './observer';
import { Executor } from './executor';
import { HistoryManager } from './history';
import { ContextManager } from './context-manager';
import { IGenerator, FileGenerator, MemoryGenerator } from '../tools/generator';
import { ILogger, SpinnerLogger, ConsoleLogger } from '../tools/logger';
import { FlashLoopOptions } from '../types';

export class FlashLoop {
  private browser: Browser | null = null;
  private contextManager!: ContextManager;
  private brain: Brain;
  private observer: Observer;
  private executor: Executor;
  private history: HistoryManager;
  private generator: IGenerator;
  private logger: ILogger;
  private options: FlashLoopOptions;

  constructor(options: FlashLoopOptions) {
    this.options = options;
    this.brain = new Brain();
    this.observer = new Observer();
    this.executor = new Executor();
    this.history = new HistoryManager();

    if (options.page) {
      // Library mode
      this.generator = new MemoryGenerator();
      this.logger = options.logger || new ConsoleLogger();
      this.contextManager = new ContextManager(options.page.context());
    } else {
      // CLI mode
      this.generator = new FileGenerator();
      this.logger = options.logger || new SpinnerLogger();
    }
  }

  async start(goal: string): Promise<string> {
    this.logger.start(`🚀 FlashLoop: "${goal}"`);

    // Setup Browser (CLI mode only)
    if (!this.options.page) {
      this.browser = await chromium.launch({ headless: this.options.headless });
      const context = await this.browser.newContext();
      const page = await context.newPage();
      if (this.options.startUrl) await page.goto(this.options.startUrl);

      this.contextManager = new ContextManager(context);
    }

    await this.generator.init(goal);

    let step = 0;
    const MAX_STEPS = this.options.maxSteps || 20;
    let lastError: string | undefined = undefined;

    while (step < MAX_STEPS) {
      step++;
      const activePage = this.contextManager.getActivePage();
      this.logger.start(`Step ${step} [${await activePage.title()}] Observing...`);

      // 1. Observe (Context aware)
      const { stateText, elementMap } = await this.observer.captureState(activePage);

      const dialogInfo = this.contextManager.getPendingDialogInfo();
      const stateWithDialog = dialogInfo ? `⚠️ ${dialogInfo}\n\n${stateText}` : stateText;

      // 2. Think
      this.logger.thought('Thinking...');
      const plan = await this.brain.think(
        goal,
        stateWithDialog,
        this.history.getHistory(),
        lastError
      );

      if (plan.isFinished) break;

      this.logger.action(plan.actionType, plan.targetId || 'page');

      // 3. Execute (Locator-First)
      const result = await this.executor.execute(plan, this.contextManager, elementMap);

      if (result.success) {
        this.logger.success(`Success: ${plan.thought}`);
        this.history.add(`SUCCESS: ${plan.actionType}`);
        lastError = undefined;

        if (result.generatedCode) {
          await this.generator.appendCode(result.generatedCode, plan.thought);
        }
      } else {
        this.logger.fail(`Failed: ${result.error}`);
        this.history.add(`ERROR: ${plan.actionType} failed. ${result.error}`);
        lastError = result.userGuidance || result.error;

        if (!result.retryable) {
          break;
        }
      }
    }

    await this.generator.finish();
    // ブラウザのクローズは cleanup() に委譲するか、ここで行う
    // CLIモードの自動終了のためここでも呼ぶ
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    return this.generator.getOutput();
  }

  /**
   * リソースのクリーンアップを行う
   * Libraryモードなどで外部から明示的に呼ばれる場合がある
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // すでに閉じられている場合は無視
      }
      this.browser = null;
    }
    // 将来的にイベントリスナーの解除などが必要になればここに追記
  }
}
