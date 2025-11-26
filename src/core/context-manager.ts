/**
 * src/core/context-manager.ts
 * ブラウザコンテキスト、タブ(Page)、ダイアログを一元管理する
 */
import { BrowserContext, Page, Dialog } from 'playwright';

export class ContextManager {
  private context: BrowserContext;
  private pages: Page[] = [];
  private activePage: Page | null = null;
  private pendingDialog: { message: string; type: string; dialog: Dialog } | null = null;

  constructor(context: BrowserContext) {
    this.context = context;
    this.pages = context.pages();
    this.activePage = this.pages[0] || null;

    // 初期ページのリスナー設定
    this.pages.forEach((p) => this.setupPageListeners(p));

    // 新規ページの監視
    this.context.on('page', (page) => {
      console.log('✨ New tab detected');
      this.pages.push(page);
      this.setupPageListeners(page);
      // 新しいタブが開いたら自動的にアクティブにする（ユーザーの挙動に近い）
      this.activePage = page;
    });
  }

  /**
   * ページイベントのリスナーを設定
   */
  private setupPageListeners(page: Page) {
    // ページが閉じられたらリストから削除
    page.on('close', () => {
      this.pages = this.pages.filter((p) => p !== page);
      if (this.activePage === page) {
        // アクティブページが閉じられたら、最後のページをアクティブに
        this.activePage = this.pages[this.pages.length - 1] || null;
      }
    });

    // ダイアログ監視
    page.on('dialog', (dialog) => {
      console.log(`💬 Dialog detected: [${dialog.type()}] ${dialog.message()}`);
      this.pendingDialog = {
        message: dialog.message(),
        type: dialog.type(),
        dialog: dialog,
      };
      // 自動で閉じない。AIに判断させるため保留する。
      // ただし、beforeunloadなどはブロックする可能性があるので注意が必要だが、
      // ここではAI操作のループ内で処理することを前提とする。
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
