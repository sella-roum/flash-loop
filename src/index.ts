/**
 * src/index.ts
 * CLIアプリケーションのエントリーポイント
 */
import { Command, InvalidArgumentError } from 'commander';
import { FlashLoop } from './core/loop';
import { SpinnerLogger } from './tools/logger';
import * as dotenv from 'dotenv';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('flash-loop')
  .description('AI-powered autonomous browser agent (Flash-Loop)')
  .version('2.1.0')
  .argument('<goal>', 'The goal for the agent to achieve')
  .option('-u, --url <url>', 'Starting URL')
  .option('--headless', 'Run in headless mode', false)
  .option('--max-steps <number>', 'Maximum number of steps', (val) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed <= 0) {
      throw new InvalidArgumentError('Max steps must be a positive integer.');
    }
    return parsed;
  })
  .action(async (goal, options) => {
    if (!process.env.CEREBRAS_API_KEY) {
      console.error(
        chalk.red(
          'Error: CEREBRAS_API_KEY is not set. Please create a .env file based on .env.example'
        )
      );
      process.exit(1);
    }

    // CLI実行用のロガーを作成
    const logger = new SpinnerLogger();
    console.log(chalk.cyan('⚡ Starting Flash-Loop v2.1...'));

    try {
      const agent = new FlashLoop({
        startUrl: options.url,
        headless: options.headless,
        maxSteps: options.maxSteps,
        logger: logger,
      });

      const output = await agent.start(goal);

      // 完了メッセージは FlashLoop 内でログ出力されるが、
      // CLI終了として明示的に完了ステータスを表示
      if (output) {
        console.log(chalk.green('\n✨ Task Finished Successfully!'));
      }
    } catch (error) {
      console.error(chalk.red('Unexpected Error:'), error);
      process.exit(1);
    }
  });

program.parse();