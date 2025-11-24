import ora from 'ora';
import chalk from 'chalk';

// モジュールスコープでインスタンス化して this 依存を排除
const spinner = ora();

export const logger = {
  spinner,

  info(msg: string) {
    console.log(chalk.blue(`ℹ ${msg}`));
  },

  success(msg: string) {
    console.log(chalk.green(`✔ ${msg}`));
  },

  error(msg: string) {
    console.error(chalk.red(`✖ ${msg}`));
  },

  action(type: string, target: string) {
    console.log(`${chalk.yellow('➤')} Action: ${chalk.bold(type)} on [${target}]`);
  },

  thought(text: string) {
    console.log(chalk.gray(`  Thought: ${text}`));
  },

  start(msg: string) {
    spinner.start(msg);
  },

  stop(msg?: string) {
    if (msg) spinner.succeed(msg);
    else spinner.stop();
  },

  fail(msg: string) {
    spinner.fail(msg);
  },
};
