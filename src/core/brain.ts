/**
 * src/core/brain.ts
 */
import { cerebras } from '@ai-sdk/cerebras';
import { generateObject } from 'ai';
import { ActionSchema, ActionPlan } from '../types';

export class Brain {
  private model = cerebras(process.env.LLM_MODEL_NAME || 'llama3.1-70b');

  async think(
    goal: string,
    state: string,
    history: string[],
    lastError?: string
  ): Promise<ActionPlan> {
    const systemPrompt = `
You are FlashLoop, a resilient browser automation agent.
Your goal is to achieve the user's objective by operating the browser.

# STRATEGY
1. **Context**: Check the "Active Tab". If the goal requires a new tab or popup, look for it.
2. **Visibility**: If you cannot see the target, it might be off-screen. Use 'scroll'.
3. **Wait**: If the page is loading or you expect a change, use 'wait_for_element' or check 'assert_visible'.
4. **Error Recovery**: If "Previous Error" exists, analyze the advice and try a DIFFERENT approach (e.g., scroll first, close modal, use different element).

# ADAPTIVE PLANNING
1. Always maintain a high-level plan in the \`plan\` object.
2. **Reality over Plan:** If the current page does not match your plan (e.g., unexpected login screen, popup), ABANDON the old plan and adapt immediately.
3. Keep \`remainingSteps\` concise (next 2-3 major steps only).

# MULTI-TAB HANDLING
- If context info says "New tab focused", verify if it is the correct page for your goal.
- If it is an ad or irrelevant, use 'close_tab'.
- If you finished a task in a child tab, use 'close_tab' to return to the parent.

# SCHEMA
Return a JSON object matching ActionSchema.
`;

    const userContent = `
Goal: ${goal}
${lastError ? `\n⚠️ PREVIOUS ERROR:\n${lastError}\n(Please fix your strategy based on this error.)\n` : ''}
Current State:
${state}

History:
${history.slice(-5).join('\n')}

Next Action:
`;

    const { object } = await generateObject({
      model: this.model,
      schema: ActionSchema,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      temperature: 0,
    });

    return object;
  }
}
