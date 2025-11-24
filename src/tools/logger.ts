import ora from 'ora';
import chalk from 'chalk';

export const logger = {
  spinner: ora(),

  info(msg: string) {
    console.log(chalk.blue(`ℹ ${msg}`));
  },

  success(msg: string) {
    console.log(chalk.green(`✔ ${msg}`));
  },

  error(msg: string) {
    console.log(chalk.red(`✖ ${msg}`));
  },

  action(type: string, target: string) {
    console.log(`${chalk.yellow('➤')} Action: ${chalk.bold(type)} on [${target}]`);
  },

  thought(text: string) {
    console.log(chalk.gray(`  Thought: ${text}`));
  },

  start(msg: string) {
    this.spinner.start(msg);
  },

  stop(msg?: string) {
    if (msg) this.spinner.succeed(msg);
    else this.spinner.stop();
  },

  fail(msg: string) {
    this.spinner.fail(msg);
  },
};
