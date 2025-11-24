import { z } from 'zod';

/**
 * LLMが生成するアクションのスキーマ定義
 * 思考(thought)とアクション(actionType, targetId)を構造化します。
 */
export const ActionSchema = z.object({
  thought: z.string().describe('現在の状況分析と、なぜこのアクションを選択したかの思考プロセス'),
  actionType: z
    .enum(['click', 'fill', 'navigate', 'assertion', 'finish'])
    .describe('実行するアクションの種類'),
  targetId: z
    .string()
    .optional()
    .describe('操作対象要素のVirtual ID (例: "12")。navigate/finish時は不要'),
  value: z.string().optional().describe('入力フォームへの値、URL、またはアサーションの期待値'),
  isFinished: z.boolean().describe('タスクが完了したかどうか'),
});

export type ActionPlan = z.infer<typeof ActionSchema>;

/**
 * Executorの実行結果
 */
export interface ExecutionResult {
  success: boolean;
  generatedCode?: string; // テストファイルに書き込むための検証済みコード
  error?: string;
  retryable: boolean; // リトライによって解決する可能性があるエラーか
}
