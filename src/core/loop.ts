import { chromium, Browser, Page } from 'playwright';
import { Brain } from './brain';
import { Observer } from './observer';
import { Executor } from './executor';
import { HistoryManager } from './history';
import { IGenerator, FileGenerator, MemoryGenerator } from '../tools/generator';
import { ILogger, SpinnerLogger, ConsoleLogger } from '../tools/logger';
import { DOM_WAIT_TIMEOUT_MS } from '../constants';
import { ElementContainer } from '../types';

export interface FlashLoopOptions {
  startUrl?: string;
  headless?: boolean;
  maxSteps?: number;
  viewport?: { width: number; height: number }; // ビューポート設定を追加
  // 以下、ライブラリ利用時のオプション
  page?: Page; // 既存のPageインスタンス
  logger?: ILogger; // 外部から注入するロガー
}

export class FlashLoop {
  private browser: Browser | null = null;
  private page!: Page;

  private brain: Brain;
  private observer: Observer;
  private executor: Executor;
  private history: HistoryManager;
  private generator: IGenerator;
  private logger: ILogger;

  // メモリリーク対策: アクティブな要素マップを保持し、適宜クリーンアップする
  private activeElementMap: Map<string, ElementContainer> = new Map();

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
      this.browser = await chromium.launch({
        headless: this.options.headless ?? false,
      });
      this.page = await this.browser.newPage();
      const viewport = this.options.viewport ?? { width: 1280, height: 800 };
      await this.page.setViewportSize(viewport);
    }

    if (this.options.startUrl) {
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
        // 前回のステップで使用したElementHandleを破棄してメモリ解放
        await this.clearActiveElements();

        // 1. Observe (DOM汚染なし、全フレーム走査)
        const { stateText, elementMap } = await this.observer.captureState(this.page);
        this.activeElementMap = elementMap; // 新しいマップを保持

        // 2. Think
        this.logger.start('Thinking...');
        const plan = await this.brain.think(goal, stateText, this.history.getHistory());

        if (plan.isFinished) {
          this.logger.stop('Task Completed based on AI decision.');
          break;
        }

        this.logger.action(plan.actionType, plan.targetId || 'page');

        // 3. Execute (Handle操作 -> Code生成)
        // マップを渡すことで、DOM再探索をスキップ
        const result = await this.executor.execute(plan, this.page, this.activeElementMap);

        if (result.success) {
          this.logger.stop(); // スピナー停止
          this.logger.success(`Action Success: ${plan.thought}`);

          if (result.generatedCode) {
            this.logger.thought(`Generated Code: ${result.generatedCode}`);
            await this.generator.appendCode(result.generatedCode);
          }

          this.history.add(`SUCCESS: ${plan.actionType} on ${plan.targetId || 'page'}`);
        } else {
          this.logger.fail(`Action Failed: ${result.error}`);
          this.history.add(`ERROR: ${result.error}. Try a different approach.`);

          // エラー時は少し待機して画面安定化を待つ
          await this.page.waitForTimeout(DOM_WAIT_TIMEOUT_MS);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.fail(`System Error: ${errorMessage}`);
        // システムエラーの場合は安全のためループを抜ける
        break;
      }
    }

    await this.cleanup();
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
   * クリーンアップ処理
   * 保持しているElementHandleを破棄する
   */
  async cleanup(): Promise<void> {
    await this.clearActiveElements();
  }

  /**
   * activeElementMap内のElementHandleを全て破棄し、マップをクリアする
   */
  private async clearActiveElements(): Promise<void> {
    for (const container of this.activeElementMap.values()) {
      try {
        // ElementHandleを明示的に破棄してブラウザ側のメモリを解放
        await container.handle.dispose();
      } catch {
        // すでに破棄されている場合などは無視
      }
    }
    this.activeElementMap.clear();
  }
}
