import { cerebras } from '@ai-sdk/cerebras';
import { generateObject } from 'ai';
import { ActionSchema, ActionPlan } from '../types';

/**
 * LLMを使用して次のアクションを決定する頭脳クラス
 */
export class Brain {
  // Cerebras Llama 3.1 70B モデルを使用 (高速推論)
  private model = cerebras(process.env.LLM_MODEL_NAME || 'llama3.1-70b');

  /**
   * 現在の状態と履歴から、次のアクションを推論します。
   */
  async think(goal: string, state: string, history: string[]): Promise<ActionPlan> {
    const systemPrompt = `
You are FlashLoop, an expert automated browser agent focused on speed and reliability.
Your goal is to achieve the user's objective on the web page.

# INSTRUCTIONS
1. Analyze the 'Current State' and 'Interactive Elements'.
2. Determine the next single step to take.
3. ALWAYS use the 'targetId' from the list (e.g., "[ID: 12]") to specify elements. DO NOT guess CSS selectors.
4. If you need to click something, select the correct ID.
5. If the goal is achieved, set 'isFinished' to true.
6. If an error occurred in history, try a different element or approach.

# OUTPUT FORMAT
Return a JSON object matching the ActionSchema.
`;

    try {
      const { object } = await generateObject({
        model: this.model,
        schema: ActionSchema,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `
Goal: ${goal}

Current State:
${state}

History of Actions & Errors:
${history.length > 0 ? history.join('\n') : '(No history yet)'}

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
