import { Command } from 'commander';
import { FlashLoop } from './core/loop';
import * as dotenv from 'dotenv';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('flash-loop')
  .description('AI-powered autonomous browser agent (Flash-Loop)')
  .version('2.0.0')
  .argument('<goal>', 'The goal for the agent to achieve')
  .option('-u, --url <url>', 'Starting URL')
  .option('--headless', 'Run in headless mode', false)
  .action(async (goal, options) => {
    if (!process.env.CEREBRAS_API_KEY) {
      console.error(chalk.red('Error: CEREBRAS_API_KEY is not set in .env file.'));
      process.exit(1);
    }

    console.log(chalk.cyan('⚡ Starting Flash-Loop...'));

    try {
      const agent = new FlashLoop({
        startUrl: options.url,
        headless: options.headless,
      });

      await agent.start(goal);
    } catch (error) {
      console.error(chalk.red('Unexpected Error:'), error);
      process.exit(1);
    }
  });

program.parse();
