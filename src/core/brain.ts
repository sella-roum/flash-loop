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
   *
   * @param goal ユーザーのゴール
   * @param state 現在のページ状態（YAML形式）
   * @param history 過去のアクション履歴
   */
  async think(goal: string, state: string, history: string[]): Promise<ActionPlan> {
    const systemPrompt = `
You are FlashLoop, an expert automated browser agent.
Your goal is to achieve the user's objective on the web page.

# INSTRUCTIONS
1. Analyze the 'Current State' (YAML format) and 'Goal'.
2. Determine the next single step to take.
3. **Format**: The state uses the format '- <tag> "Description" [ID: x]'.
4. **Target**: Use the [ID: x] to specify the 'targetId'.
5. **Scrolling**: If the target is not visible but you see a hint like "Scrollable" or "more items", use actionType: "scroll". If scrolling a specific container, use its ID. If general scrolling, leave targetId empty.
6. **Input**: For 'fill' or 'type', specify the text in 'value'.
7. **Completion**: If the goal is fully achieved, set 'isFinished' to true.

# ACTION TYPES
- Basic: click, dblclick, hover
- Input: fill, type, select_option, check, uncheck, upload
- Page: navigate, scroll, go_back, reload
- Verify: assert_visible, assert_text, assert_url

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

Current State (Interactive Elements):
${state}

History of Actions:
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
