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
import { FlashLoopOptions, ActionType, ActionTypeEnum } from '../types';
import chalk from 'chalk';

// Inquirerの型定義を動的インポートの型から抽出
// inquirer v9 (ESM) の default export の型を取得する
type InquirerModule = typeof import('inquirer');
type InquirerInstance = InquirerModule['default'];

// インタラクティブモードのオーバーライド用回答型
interface OverrideAnswers {
  actionType: ActionType;
  targetId?: string;
  value?: string;
}

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

    // Inquirer の動的インポート（インタラクティブモード用）
    let inquirer: InquirerInstance | undefined;
    if (this.options.interactive) {
      try {
        const imported = await import('inquirer');
        inquirer = imported.default;
      } catch {
        this.logger.fail('Inquirer not found. Interactive mode disabled.');
        this.options.interactive = false;
      }
    }

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

      // インタラクティブモードでない場合のみ、ここで終了判定
      if (plan.isFinished && !this.options.interactive) break;

      this.logger.action(plan.actionType, plan.targetId || 'page');

      // --- Interactive Mode ---
      if (this.options.interactive && inquirer) {
        this.logger.stop(); // スピナー一時停止

        // Keep-Alive: ユーザー入力待ちの間にセッションが切れないようにPing
        // 間隔を60秒に緩和
        const keepAlive = setInterval(() => {
          activePage.evaluate('document.title').catch(() => {});
        }, 60000);

        try {
          console.log(chalk.yellow(`\n🤖 AI Proposal:`));
          if (plan.plan) {
            console.log(`Plan Status: ${chalk.cyan(plan.plan.currentStatus)}`);
            console.log(`Remaining:   ${plan.plan.remainingSteps.join(' -> ')}`);
          }
          console.log(`Thought:     ${chalk.gray(plan.thought)}`);
          console.log(`Action:      ${chalk.bold.green(plan.actionType)}`);
          console.log(`Target:      ${plan.targetId || 'Page/Context'}`);
          if (plan.value) console.log(`Value:       ${chalk.cyan(plan.value)}`);

          // 選択肢のプロンプト
          // ジェネリクスを指定して型安全に回答を取得
          const answer = await inquirer.prompt<{ choice: string }>([
            {
              type: 'list',
              name: 'choice',
              message: 'What would you like to do?',
              choices: [
                { name: '✅ Execute', value: 'execute' },
                { name: '🛠️  Override (Edit Action)', value: 'override' },
                { name: '⏭️  Skip', value: 'skip' },
                { name: '🛑 Quit', value: 'quit' },
              ],
            },
          ]);

          const choice = answer.choice;

          if (choice === 'quit') break;
          if (choice === 'skip') {
            clearInterval(keepAlive);
            continue;
          }

          if (choice === 'override') {
            // オーバーライド用プロンプト
            const override = await inquirer.prompt<OverrideAnswers>([
              {
                type: 'list',
                name: 'actionType',
                message: 'Action Type:',
                // ActionTypeEnum.options を使用して動的に選択肢を生成 (Source of Truth)
                choices: ActionTypeEnum.options,
                default: plan.actionType,
              },
              {
                type: 'input',
                name: 'targetId',
                message: 'Target ID (leave empty for page/context):',
                default: plan.targetId,
              },
              {
                type: 'input',
                name: 'value',
                message: 'Value (text, url, etc.):',
                default: plan.value,
                // whenコールバックの引数を適切に型付け (any回避)
                when: (ans: Partial<OverrideAnswers>) =>
                  ans.actionType !== undefined &&
                  ['fill', 'type', 'navigate', 'scroll', 'switch_tab'].includes(ans.actionType),
              },
            ]);

            plan.actionType = override.actionType;
            plan.targetId = override.targetId || undefined;
            plan.value = override.value;
          }
        } finally {
          clearInterval(keepAlive);
        }

        // ユーザーがfinishを選択、または既にプランが完了している場合
        if (plan.actionType === 'finish' || plan.isFinished) break;

        this.logger.start('Executing...');
      }
      // -------------------------

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
          if (this.options.interactive) {
            console.log(
              chalk.red(
                '\n❌ Non-retryable error occurred. You must override the action to continue.'
              )
            );
          } else {
            break;
          }
        }
      }
    }

    await this.generator.finish();
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    return this.generator.getOutput();
  }

  /**
   * リソースのクリーンアップを行う
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
  }
}
