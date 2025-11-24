/**
 * src/tools/logger.ts
 * 実行環境に応じてログ出力方法を切り替えるためのロガーツール
 */
import ora, { Ora } from 'ora';
import chalk from 'chalk';

/**
 * ロガーの共通インターフェース
 */
export interface ILogger {
  start(msg: string): void;
  stop(msg?: string): void;
  info(msg: string): void;
  success(msg: string): void;
  fail(msg: string): void;
  action(type: string, target: string): void;
  thought(text: string): void;
}

/**
 * CLI実行用のロガー
 * 'ora' を使用してリッチなスピナー表示を行います。
 */
export class SpinnerLogger implements ILogger {
  private spinner: Ora;

  constructor() {
    this.spinner = ora();
  }

  start(msg: string): void {
    this.spinner.start(msg);
  }

  stop(msg?: string): void {
    if (msg) this.spinner.succeed(msg);
    else this.spinner.stop();
  }

  info(msg: string): void {
    // スピナーが回っているときは邪魔しないように制御することも可能だが、
    // ここでは単純に出力する
    console.log(chalk.blue(`ℹ ${msg}`));
  }

  success(msg: string): void {
    console.log(chalk.green(`✔ ${msg}`));
  }

  fail(msg: string): void {
    this.spinner.fail(msg);
  }

  error(msg: string): void {
    console.error(chalk.red(`✖ ${msg}`));
  }

  action(type: string, target: string): void {
    const icon = chalk.yellow('➤');
    // スピナーのテキスト更新ではなく、履歴として残すログ
    this.spinner.stopAndPersist({
      symbol: icon,
      text: `Action: ${chalk.bold(type)} on [${target}]`,
    });
    // 再開
    this.spinner.start();
  }

  thought(text: string): void {
    const icon = chalk.gray('💭');
    this.spinner.stopAndPersist({
      symbol: icon,
      text: chalk.gray(`Thought: ${text}`),
    });
    this.spinner.start();
  }
}

/**
 * テスト/CI実行用のロガー
 * スピナーを使用せず、シンプルな標準出力を行います。
 * 並列実行時にログが崩れるのを防ぎます。
 */
export class ConsoleLogger implements ILogger {
  start(msg: string): void {
    console.log(`[Start] ${msg}`);
  }

  stop(msg?: string): void {
    if (msg) console.log(`[Done] ${msg}`);
  }

  info(msg: string): void {
    console.log(`ℹ️ ${msg}`);
  }

  success(msg: string): void {
    console.log(`✅ ${msg}`);
  }

  fail(msg: string): void {
    console.error(`❌ ${msg}`);
  }

  action(type: string, target: string): void {
    console.log(`➤ Action: ${type} on [${target}]`);
  }

  thought(text: string): void {
    console.log(`  💭 Thought: ${text}`);
  }
}

// デフォルトのロガーインスタンス（後方互換性や簡易アクセスのため）
export const logger = new SpinnerLogger();
