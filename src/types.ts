import { z } from 'zod';
import { ElementHandle, Frame } from 'playwright';

/**
 * Playwrightで実行可能なすべてのアクションタイプ
 * LLMが迷わないよう、意図ごとに分類して定義
 */
export const ActionTypeEnum = z.enum([
  // --- Basic Interaction ---
  'click', // 通常の左クリック
  'dblclick', // ダブルクリック
  'right_click', // 右クリック (コンテキストメニュー用)
  'hover', // マウスホバー (ツールチップ表示など)
  'focus', // フォーカスを当てる

  // --- Input / Form ---
  'fill', // テキスト入力 (高速、標準的)
  'type', // キーを1つずつタイプ (検索サジェスト発火など、人間らしい入力が必要な場合)
  'clear', // 入力欄の消去
  'check', // チェックボックス/ラジオボタンをオン
  'uncheck', // チェックボックスをオフ
  'select_option', // ドロップダウン(selectタグ)の選択
  'upload', // ファイルアップロード (setInputFiles)

  // --- Advanced Interaction ---
  'drag_and_drop', // ドラッグ＆ドロップ (targetId から targetId2 へ)
  'keypress', // 特定のキー押下 (Enter, Escape, ArrowDown, Control+C 等)

  // --- Navigation / Page ---
  'navigate', // URL遷移
  'reload', // ページ再読み込み
  'go_back', // 戻る
  'scroll', // スクロール (要素指定またはページ全体)

  // --- Assertion (Verification) ---
  'assert_visible', // 要素が表示されているか
  'assert_text', // 要素のテキストが value を含むか
  'assert_value', // inputのvalueが value と一致するか
  'assert_url', // URLが value を含むか

  // --- Meta ---
  'finish', // タスク完了
]);

export type ActionType = z.infer<typeof ActionTypeEnum>;

/**
 * LLMが生成するアクションプラン (Schema Definition)
 * 思考(thought)とアクション(actionType, targetId)を構造化します。
 */
export const ActionSchema = z.object({
  thought: z.string().describe('現在の状況分析と、なぜこのアクションを選択したかの思考プロセス'),

  actionType: ActionTypeEnum.describe('実行するPlaywrightアクションの種類'),

  targetId: z
    .string()
    .optional()
    .describe('操作対象の要素のVirtual ID (例: "12")。navigate/finish時は不要'),

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
        '- assert_text/value/url: 期待する値'
    ),

  isFinished: z.boolean().describe('ゴールを達成し、タスクを終了すべきか'),
});

export type ActionPlan = z.infer<typeof ActionSchema>;

/**
 * システム内部で保持する要素コンテナ
 * DOMを汚さずに要素を特定・操作するための全情報を持つ
 */
export interface ElementContainer {
  id: string;

  // 操作用 (Playwrightの参照)
  // メモリ上でDOM要素へのポインタを保持することで高速な操作を実現
  handle: ElementHandle;
  frame: Frame;

  // リカバリ & コード生成用メタデータ
  // ネストされたiframeに対応するためのセレクタチェーン
  frameSelectorChain: string[];
  xpath: string; // 最終手段のパス (Stale Element対策)

  // 事前計算されたセレクタ候補
  // ブラウザ内で一意性が確認されたものを格納する
  selectors: {
    testId?: string; // 一意な data-testid
    role?: { role: string; name: string }; // 一意な Role + Name
    placeholder?: string; // 一意な Placeholder
    text?: string; // 一意な Text
    label?: string; // Associated Label
  };

  // LLM提示用
  description: string;
  tagName: string;
  isScrollable: boolean;
}

/**
 * Observeの結果
 */
export interface ObservationResult {
  stateText: string; // LLMに渡すYAMLテキスト
  elementMap: Map<string, ElementContainer>; // ID -> コンテナのマップ
}

/**
 * Executorの実行結果
 */
export interface ExecutionResult {
  success: boolean;
  generatedCode?: string; // テストファイルに書き込むための検証済みコード
  error?: string;
  retryable: boolean; // リトライによって解決する可能性があるエラーか
}
