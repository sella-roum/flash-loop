/**
 * アクション履歴を管理するクラス
 * トークン節約のために古い履歴を要約・削除する機能を持たせる場所
 */
export class HistoryManager {
  private logs: string[] = [];
  private readonly MAX_LOGS = 15;

  add(message: string) {
    this.logs.push(message);
    // 履歴が長すぎる場合は古いものを削除（単純なFIFO）
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }
  }

  getHistory(): string[] {
    // 内部配列のコピーを返して破壊を防ぐ
    return [...this.logs];
  }
}
