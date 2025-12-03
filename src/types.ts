/**
 * src/types.ts
 * アプリケーション全体で使用する型定義
 */
import { z } from 'zod';
import { ElementHandle, Frame, Page } from 'playwright';
import { ILogger } from './tools/logger';

// --- FlashLoop Options ---

export interface FlashLoopOptions {
  startUrl?: string;
  headless?: boolean;
  maxSteps?: number;
  viewport?: { width: number; height: number };
  // ライブラリ利用時のオプション
  page?: Page; // 既存のPageインスタンス
  logger?: ILogger; // 外部から注入するロガー
  // インタラクティブモード（人間が介入するモード）
  interactive?: boolean;
}

// --- Action Definitions ---

/**
 * Playwrightで実行可能なすべてのアクションタイプ
 */
export const ActionTypeEnum = z.enum([
  // --- Basic Interaction ---
  'click',
  'dblclick',
  'right_click',
  'hover',
  'focus',

  // --- Input / Form ---
  'fill',
  'type',
  'clear',
  'check',
  'uncheck',
  'select_option',
  'upload',

  // --- Advanced Interaction ---
  'drag_and_drop',
  'keypress',

  // --- Navigation / Page / Tab ---
  'navigate',
  'reload',
  'go_back',
  'scroll',
  'switch_tab',
  'close_tab',

  // --- Wait & Dialog ---
  'wait_for_element',
  'handle_dialog',

  // --- Assertion (Verification) ---
  'assert_visible',
  'assert_text',
  'assert_value',
  'assert_url',

  // --- Meta ---
  'finish',
]);

export type ActionType = z.infer<typeof ActionTypeEnum>;

/**
 * LLMが生成するアクションプラン
 */
export const ActionSchema = z.object({
  thought: z
    .string()
    .describe('現在の状況分析、なぜこのアクションを選択したかの思考プロセス。簡潔に記述すること。'),

  // 適応型プランニング
  plan: z
    .object({
      currentStatus: z.string().describe('現在の進捗状況を一言で (例: "Login form detected")'),
      remainingSteps: z
        .array(z.string())
        .describe('ゴールまでの残りの主要ステップ (最大3つ程度)。状況が変われば修正すること。'),
      isPlanChanged: z.boolean().describe('予期せぬ画面遷移などで、当初の計画を変更した場合はtrue'),
    })
    .describe('現状認識と今後の見通し。常に最新の状況に合わせて更新すること。'),

  actionType: ActionTypeEnum.describe('実行するPlaywrightアクションの種類'),

  targetId: z
    .string()
    .optional()
    .describe('操作対象の要素のVirtual ID (例: "btn-login-1")。navigate/finish時は不要'),

  targetId2: z
    .string()
    .optional()
    .describe('drag_and_dropアクションの場合の「ドロップ先」要素のVirtual ID'),

  value: z
    .string()
    .optional()
    .describe(
      'アクションに必要なパラメータ。\n' +
        '- fill/type: 入力するテキスト\n' +
        '- select_option: 選択する値(value)またはラベル\n' +
        '- keypress: キー名 (Enter, Tab, Control+C)\n' +
        '- navigate: URL\n' +
        '- upload: ファイルパス\n' +
        '- switch_tab: タブのインデックス(0-based)またはタイトルの一部\n' +
        '- handle_dialog: "accept" または "dismiss"'
    ),

  isFinished: z.boolean().describe('ゴールを達成し、タスクを終了すべきか'),
});

export type ActionPlan = z.infer<typeof ActionSchema>;

// --- DOM / State Definitions ---

/**
 * セレクタ候補
 */
export interface SelectorCandidates {
  testId?: string;
  role?: { role: string; name: string };
  placeholder?: string;
  text?: string;
  label?: string;
  altText?: string;
  title?: string;
}

/**
 * システム内部で保持する要素コンテナ
 * Semantic ID導入に伴い、不変なIDと最新のHandleを管理する
 */
export interface ElementContainer {
  id: string; // Semantic Hash ID

  // 操作用 (Playwrightの参照)
  handle: ElementHandle;
  frame: Frame;

  // リカバリ & コード生成用メタデータ
  frameSelectorChain: string[];
  xpath: string; // 最終手段

  // セレクタ候補
  selectors: SelectorCandidates;

  // LLM提示用
  description: string;
  tagName: string;
  isScrollable: boolean;
  isInViewport: boolean; // 画面外判定用
}

/**
 * Observeの結果
 */
export interface ObservationResult {
  stateText: string; // LLMに渡すテキスト表現
  elementMap: Map<string, ElementContainer>; // ID -> コンテナ
}

/**
 * Executorの実行結果
 */
export interface ExecutionResult {
  success: boolean;
  generatedCode?: string; // 検証済みコード
  error?: string;
  retryable: boolean;
  userGuidance?: string; // AIへのフィードバック（エラー翻訳）
}
