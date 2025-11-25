/**
 * src/constants.ts
 * アプリケーション全体で使用する定数定義
 */

// DOM汚染を行わないため、ATTR_FLASH_ID は廃止されました。
// 現在はIn-MemoryでIDを管理しています。

/**
 * AI推論のタイムアウト設定 (ms)
 */
export const AI_TIMEOUT_MS = 60000;

/**
 * DOM安定化待ちのタイムアウト設定 (ms)
 */
export const DOM_WAIT_TIMEOUT_MS = 2000;