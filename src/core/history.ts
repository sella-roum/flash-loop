/**
 * アクション履歴を管理するクラス
 * トークン節約のために古い履歴を要約・削除する機能を持たせる場所
 */
export class HistoryManager {
  private logs: string[] = [];
  private readonly MAX_LOGS = 20; // 履歴保持数を少し増やす

  /**
   * 履歴を追加する
   * @param message アクションの結果やエラーメッセージ
   */
  add(message: string) {
    // タイムスタンプを追加して時系列を明確にする（オプション）
    // const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    // this.logs.push(`[${timestamp}] ${message}`);
    this.logs.push(message);

    // 履歴が長すぎる場合は古いものを削除（FIFO）
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }
  }

  /**
   * 現在の履歴リストを取得する
   */
  getHistory(): string[] {
    // 内部配列のコピーを返して破壊を防ぐ
    return [...this.logs];
  }

  /**
   * 履歴をクリアする（リセット用）
   */
  clear() {
    this.logs = [];
  }
}
