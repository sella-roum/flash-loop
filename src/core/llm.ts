import { cerebras } from '@ai-sdk/cerebras';
import { generateObject } from 'ai';
import { z } from 'zod';
import { systemPrompt } from '../tools/prompts';

// アクションの型定義（Zodスキーマ）
// LLMが生成すべきJSONの構造を厳密に定義します
export const ActionSchema = z.object({
  thought: z.string().describe('現在の状況分析と、なぜ次のアクションを選択したかの思考プロセス'),
  code: z.string().describe('実行すべきPlaywrightのコード (例: await page.click(...))'),
  actionType: z
    .enum(['click', 'fill', 'navigate', 'assertion', 'other', 'finish'])
    .describe('アクションの種類'),
  isFinished: z.boolean().describe('タスクが完了したかどうか'),
});

export type Action = z.infer<typeof ActionSchema>;

export class Brain {
  private model = cerebras('llama3.1-70b');

  async generateAction(goal: string, domSnapshot: string, history: string[]): Promise<Action> {
    try {
      const { object } = await generateObject({
        model: this.model,
        schema: ActionSchema,
        system: systemPrompt, // prompts.ts からインポート
        messages: [
          {
            role: 'user',
            content: `
Goal: ${goal}

Current Page Accessibility Tree:
\`\`\`
${domSnapshot}
\`\`\`

History of actions & errors:
${history.join('\n')}

Next Action:
`,
          },
        ],
        temperature: 0, // 決定論的な動作を優先
      });

      return object;
    } catch (error) {
      console.error('LLM Generation Error:', error);
      throw error;
    }
  }
}
