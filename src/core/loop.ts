/**
 * src/core/loop.ts
 * AIエージェントのメインループ (Observe-Think-Act)
 */
import { chromium, Browser, Page } from 'playwright';
import { Brain } from './brain';
import { Observer } from './observer';
import { Executor } from './executor';
import { HistoryManager } from './history';
import { IGenerator, FileGenerator, MemoryGenerator } from '../tools/generator';
import { ILogger, SpinnerLogger, ConsoleLogger } from '../tools/logger';

export interface FlashLoopOptions {
  startUrl?: string;
  headless?: boolean;
  maxSteps?: number;
  // 以下、ライブラリ利用時のオプション
  page?: Page; // 既存のPageインスタンス
  logger?: ILogger; // 外部から注入するロガー
}

export class FlashLoop {
  private browser: Browser | null = null;
  // 初期化をコンストラクタで保証するため、! を外すことも可能だが
  // start()まではundefinedの可能性があるため、設計上このままにするか、
  // あるいは型定義を Page | undefined にする。
  // ここでは外部注入された場合は必ず存在するため、 ! を使用。
  private page!: Page;

  private brain: Brain;
  private observer: Observer;
  private executor: Executor;
  private history: HistoryManager;
  private generator: IGenerator;
  private logger: ILogger;

  private options: FlashLoopOptions;
  private isExternalPage: boolean;

  constructor(options: FlashLoopOptions) {
    this.brain = new Brain();
    this.observer = new Observer();
    this.executor = new Executor();
    this.history = new HistoryManager();
    this.options = options;

    if (options.page) {
      // ライブラリモード: 外部ページとメモリジェネレータを使用
      this.page = options.page;
      this.isExternalPage = true;
      this.generator = new MemoryGenerator();
      this.logger = options.logger || new ConsoleLogger();
    } else {
      // CLIモード: ブラウザ起動とファイルジェネレータを使用
      this.isExternalPage = false;
      this.generator = new FileGenerator();
      this.logger = options.logger || new SpinnerLogger();
    }
  }

  /**
   * エージェントの実行を開始します。
   * @param goal 達成すべきゴール
   * @returns 生成されたコード、またはファイルパス
   */
  async start(goal: string): Promise<string> {
    this.logger.start(`🚀 Starting FlashLoop: "${goal}"`);

    // 外部ページでない場合のみ、ここでブラウザを起動する
    if (!this.isExternalPage) {
      this.browser = await chromium.launch({ headless: this.options.headless ?? false });
      this.page = await this.browser.newPage();
      await this.page.setViewportSize({ width: 1280, height: 800 });
    }

    if (this.options.startUrl) {
      // this.logger が SpinnerLogger の場合のみ text プロパティ更新が可能だが、
      // ILogger インターフェースには text プロパティがないため、メソッド経由か型キャストが必要。
      // ここでは汎用的に start() を再呼び出しする形で通知する。
      this.logger.start(`Navigating to ${this.options.startUrl}...`);
      await this.page.goto(this.options.startUrl);
    }

    // コード生成の初期化
    await this.generator.init(goal);
    this.logger.stop('Ready to start loop.');

    let stepCount = 0;
    const rawMax = this.options.maxSteps;
    const MAX_STEPS = typeof rawMax === 'number' && rawMax > 0 ? rawMax : 20;

    // --- Main Loop ---
    while (stepCount < MAX_STEPS) {
      stepCount++;
      this.logger.start(`Step ${stepCount}: Observing...`);

      try {
        // 1. Observe (Virtual ID Injection)
        const stateText = await this.observer.captureState(this.page);

        // 2. Think
        this.logger.start('Thinking...'); // Spinnerの状態更新
        const plan = await this.brain.think(goal, stateText, this.history.getHistory());

        if (plan.isFinished) {
          this.logger.stop('Task Completed based on AI decision.');
          break;
        }

        this.logger.action(plan.actionType, plan.targetId || 'page');

        // 3. Execute & Reverse Engineer
        const result = await this.executor.execute(plan, this.page);

        if (result.success) {
          this.logger.stop(); // 一旦止める
          this.logger.success(`Action Success: ${plan.thought}`);

          if (result.generatedCode) {
            this.logger.thought(`Generated Code: ${result.generatedCode}`);
            await this.generator.appendCode(result.generatedCode);
          }

          this.history.add(`SUCCESS: ${plan.actionType} on ${plan.targetId || 'page'}`);
        } else {
          this.logger.fail(`Action Failed: ${result.error}`);
          this.history.add(`ERROR: ${result.error}. Try a different approach.`);

          // エラー時は少し待機
          await this.page.waitForTimeout(2000);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.fail(`System Error: ${errorMessage}`);
        // システムエラーの場合はループを抜けるべきか、リトライすべきか判断が必要だが、
        // ここでは安全のためループを抜ける
        break;
      }
    }

    await this.generator.finish();

    // CLIモードの場合のみブラウザを閉じる
    if (!this.isExternalPage && this.browser) {
      await this.browser.close();
    }

    const output = this.generator.getOutput();
    this.logger.info(
      this.isExternalPage ? 'AI Agent finished.' : `📝 Test file generated: ${output}`
    );

    return output;
  }

  /**
   * DOMから注入した属性をクリーンアップします（ライブラリモード用）
   */
  async cleanup(): Promise<void> {
    if (this.page) {
      await this.observer.cleanup(this.page);
    }
  }
}
