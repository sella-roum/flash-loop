/**
 * src/core/context-manager.ts
 * ブラウザコンテキスト、タブ(Page)、ダイアログを一元管理する
 * 新規タブのオートフォーカス、履歴管理（スタック）、広告フィルタリング機能を含む
 */
import { BrowserContext, Page, Dialog } from 'playwright';

export class ContextManager {
  private context: BrowserContext;
  private pages: Page[] = [];
  private activePage: Page | null = null;

  // ページ遷移履歴スタック (LIFO) - タブを閉じたときの復帰用
  private pageStack: Page[] = [];

  // ダイアログ管理用
  private pendingDialog: { message: string; type: string; dialog: Dialog } | null = null;
  private pendingDialogTimeout: NodeJS.Timeout | null = null;
  private readonly DIALOG_TIMEOUT_MS = 10000; // 10秒で自動処理

  // イベントハンドラ参照（解除用）
  private onPageHandler: (page: Page) => void;

  constructor(context: BrowserContext) {
    this.context = context;
    this.pages = context.pages();

    // 初期ページの設定
    if (this.pages.length > 0) {
      this.activePage = this.pages[0];
      this.pageStack.push(this.activePage);
      this.pages.forEach((p) => this.setupPageListeners(p));
    }

    // 新規ページの監視ハンドラ定義
    this.onPageHandler = async (page: Page) => {
      // 1. フィルタリング (簡易的な広告/トラッカー対策)
      // URLが確定するまで少し待つ（about:blank回避のため）
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});

      const url = page.url();
      if (this.isIrrelevantUrl(url) && url !== 'about:blank') {
        console.log(`🚫 Ignoring/Closing popup: ${url}`);
        // 明らかな広告/トラッカーはスタックに載せず閉じる
        await page.close().catch(() => {});
        return;
      }

      console.log('✨ New tab detected. Auto-focusing...');

      // ページリストに追加
      this.pages.push(page);

      // イベントリスナー設定
      this.setupPageListeners(page);

      // 2. オートフォーカス
      try {
        await page.bringToFront();

        // スタック管理更新
        this.pageStack.push(page);
        this.activePage = page;
      } catch (e) {
        console.error('Failed to switch to new tab:', e);
      }
    };

    // イベント登録
    this.context.on('page', this.onPageHandler);
  }

  /**
   * リソースのクリーンアップ
   */
  dispose(): void {
    if (this.pendingDialogTimeout) {
      clearTimeout(this.pendingDialogTimeout);
    }
    this.context.off('page', this.onPageHandler);
  }

  /**
   * 除外すべきURLかどうかを判定
   */
  private isIrrelevantUrl(url: string): boolean {
    return (
      url.includes('googleads') || url.includes('doubleclick') || url.includes('facebook.com/tr')
    );
  }

  /**
   * ページイベントのリスナーを設定
   */
  private setupPageListeners(page: Page) {
    // ページが閉じられたらリストから削除
    page.on('close', () => {
      this.pages = this.pages.filter((p) => p !== page);
      this.pageStack = this.pageStack.filter((p) => p !== page);

      if (this.activePage === page) {
        // 親（一つ前のタブ）に戻る
        const parentPage = this.pageStack[this.pageStack.length - 1];
        if (parentPage) {
          console.log('↩️ Tab closed. Returning to previous tab.');
          parentPage.bringToFront().catch(() => {});
          this.activePage = parentPage;
        } else if (this.pages.length > 0) {
          // スタックが空ならリストの最後
          this.activePage = this.pages[this.pages.length - 1];
          this.activePage.bringToFront().catch(() => {});
        } else {
          this.activePage = null;
        }
      }
    });

    // ダイアログ監視
    page.on('dialog', (dialog) => {
      console.log(`💬 Dialog detected: [${dialog.type()}] ${dialog.message()}`);

      // 既存のタイムアウトがあればクリア
      if (this.pendingDialogTimeout) {
        clearTimeout(this.pendingDialogTimeout);
      }

      this.pendingDialog = {
        message: dialog.message(),
        type: dialog.type(),
        dialog: dialog,
      };

      // セーフティネット: AIが処理しない場合、一定時間後に自動で閉じる
      this.pendingDialogTimeout = setTimeout(async () => {
        // 競合対策: 現在のダイアログが、タイムアウト設定時のダイアログと同一か確認
        if (!this.pendingDialog || this.pendingDialog.dialog !== dialog) return;

        console.warn(
          '⚠️ Dialog handling timed out. Automatically dismissing/accepting to unblock execution...'
        );
        try {
          if (dialog.type() === 'beforeunload') {
            await dialog.accept();
          } else {
            await dialog.dismiss();
          }
        } catch (e) {
          console.error('Failed to auto-handle dialog:', e);
        } finally {
          this.pendingDialog = null;
          this.pendingDialogTimeout = null;
        }
      }, this.DIALOG_TIMEOUT_MS);
    });
  }

  /**
   * 現在のアクティブページを取得
   */
  getActivePage(): Page {
    if (!this.activePage) {
      if (this.pages.length > 0) {
        this.activePage = this.pages[0];
      } else {
        // ページがすべて閉じられた場合のガード
        throw new Error('No open pages found in context.');
      }
    }
    return this.activePage;
  }

  /**
   * 全ページのリストを取得
   */
  getPages(): Page[] {
    return [...this.pages];
  }

  /**
   * 指定したインデックスまたはタイトルのタブに切り替える
   */
  async switchToTab(target: string | number): Promise<void> {
    let targetPage: Page | undefined;

    if (typeof target === 'number') {
      // インデックスの範囲チェック
      if (target < 0 || target >= this.pages.length) {
        throw new Error(`Tab index ${target} is out of range (0-${this.pages.length - 1}).`);
      }
      targetPage = this.pages[target];
    } else {
      // タイトルまたはURLで検索
      for (const p of this.pages) {
        const title = await p.title();
        const url = p.url();
        if (title.includes(target) || url.includes(target)) {
          targetPage = p;
          break;
        }
      }
    }

    if (targetPage) {
      await targetPage.bringToFront();
      this.activePage = targetPage;
      // スタックの最上位に移動（既存なら削除してpush）
      this.pageStack = this.pageStack.filter((p) => p !== targetPage);
      this.pageStack.push(targetPage);
    } else {
      throw new Error(`Tab not found matching: ${target}`);
    }
  }

  /**
   * 現在のページを閉じる
   */
  async closeActiveTab(): Promise<void> {
    if (this.activePage) {
      await this.activePage.close();
      // 'close'イベントリスナーが次のアクティブページを設定する
    }
  }

  /**
   * 保留中のダイアログがあるか確認し、あれば情報を返す
   */
  getPendingDialogInfo(): string | null {
    if (this.pendingDialog) {
      return `[Alert Dialog] Type: ${this.pendingDialog.type}, Message: "${this.pendingDialog.message}". Use 'handle_dialog' action.`;
    }
    return null;
  }

  /**
   * ダイアログを処理する
   */
  async handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<void> {
    if (!this.pendingDialog) {
      throw new Error('No active dialog to handle.');
    }

    // AIが処理したのでタイマーを解除
    if (this.pendingDialogTimeout) {
      clearTimeout(this.pendingDialogTimeout);
      this.pendingDialogTimeout = null;
    }

    try {
      if (action === 'accept') {
        await this.pendingDialog.dialog.accept(promptText);
      } else {
        await this.pendingDialog.dialog.dismiss();
      }
    } finally {
      this.pendingDialog = null;
    }
  }
}
