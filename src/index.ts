import { FlashLoop } from './core/loop';
import * as dotenv from 'dotenv';

dotenv.config(); // .env から CEREBRAS_API_KEY を読み込む

const goal = process.argv[2];
if (!goal) {
  console.error('Please provide a goal.');
  process.exit(1);
}

new FlashLoop().start(goal);
