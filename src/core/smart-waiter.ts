/**
 * src/core/smart-waiter.ts
 * DOMの変更状況を監視し、ページが「安定」するまで待機するユーティリティ。
 * networkidle に依存せず、実際のDOM描画完了を検知する。
 */
import { Page } from 'playwright';

/**
 * 待機結果の詳細情報
 */
export interface WaitResult {
  achieved: boolean; // 安定化に成功したか（falseの場合はタイムアウト）
  duration: number; // 経過時間 (ms)
}

export class SmartWaiter {
  /**
   * DOMの変更が落ち着くまで待機する。
   * 無限ループを防ぐため、タイムアウト付きのソフト待機を行う。
   *
   * @param page 対象のPlaywright Pageオブジェクト
   * @param stabilityDuration この期間(ms)変更がなければ「安定」とみなす
   * @param maxTimeout 最大待機時間(ms)。これを超えたら不安定でも次へ進む（ソフトタイムアウト）
   * @returns 待機結果（安定化したか、経過時間）
   */
  static async wait(page: Page, stabilityDuration = 300, maxTimeout = 2000): Promise<WaitResult> {
    try {
      return await page.evaluate(
        ({ duration, timeout }) => {
          return new Promise<{ achieved: boolean; duration: number }>((resolve) => {
            const start = Date.now();

            // document.body がまだない場合は何もせず終了（ロード途中など）
            if (!document.body) {
              resolve({ achieved: false, duration: Date.now() - start });
              return;
            }

            let timer: number | undefined;

            // ノイズとなりうる要素（常に更新され続けるもの）を除外するためのチェック関数
            const areAllMutationsNoisy = (mutations: MutationRecord[]): boolean => {
              return mutations.every((m) => {
                const target = m.target as Element;
                // ターゲットがない変更はノイズとして扱う (return true)
                if (!target) return true;

                // 1. タグ名による除外 (メディア要素、SVG、Canvasなど)
                const tagName = target.tagName ? target.tagName.toLowerCase() : '';
                if (['video', 'audio', 'svg', 'path', 'canvas'].includes(tagName)) return true;

                // 2. クラス名による判定 (ローディングインジケータ系)
                const classList = target.classList;
                if (classList) {
                  // 部分一致も含めて判定
                  const classNameStr = classList.toString().toLowerCase();
                  if (
                    classNameStr.includes('spinner') ||
                    classNameStr.includes('loader') ||
                    classNameStr.includes('loading') ||
                    classNameStr.includes('progress') ||
                    classNameStr.includes('busy')
                  ) {
                    return true;
                  }
                }

                // 3. IDによる判定
                if (target.id) {
                  const idStr = target.id.toLowerCase();
                  if (
                    idStr.includes('spinner') ||
                    idStr.includes('loader') ||
                    idStr.includes('loading') ||
                    idStr.includes('progress')
                  ) {
                    return true;
                  }
                }

                // 4. ARIA属性 / Data属性による判定
                if (target.getAttribute) {
                  if (
                    target.getAttribute('aria-busy') === 'true' ||
                    target.getAttribute('data-loading') !== null
                  ) {
                    return true;
                  }
                }

                return false;
              });
            };

            const observer = new MutationObserver((mutations) => {
              // ノイズのみの変更であればタイマーをリセットしない
              if (areAllMutationsNoisy(mutations)) return;

              if (timer) clearTimeout(timer);

              // 最大時間を超えたら強制終了（Resolveして進む）
              if (Date.now() - start > timeout) {
                // NOTE: 直前でclearTimeout(timer)しているため、ここでのclearTimeoutは不要
                observer.disconnect();
                resolve({ achieved: false, duration: Date.now() - start });
                return;
              }

              // 変更があったのでタイマーをリセットし、再び stabilityDuration 待つ
              timer = window.setTimeout(() => {
                observer.disconnect();
                resolve({ achieved: true, duration: Date.now() - start });
              }, duration);
            });

            // 監視開始: 子要素、属性、孫要素の変更をすべて監視
            observer.observe(document.body, { childList: true, attributes: true, subtree: true });

            // 初期タイマー（最初から変化がない場合用）
            timer = window.setTimeout(() => {
              observer.disconnect();
              resolve({ achieved: true, duration: Date.now() - start });
            }, duration);
          });
        },
        { duration: stabilityDuration, timeout: maxTimeout }
      );
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      // ページ遷移やコンテキスト破棄などの既知のエラーは警告を出して継続
      if (
        errorMessage.includes('Execution context was destroyed') ||
        errorMessage.includes('Target closed') ||
        errorMessage.includes('Navigation failed')
      ) {
        console.warn('[SmartWaiter] Wait interrupted by navigation or context destruction:', e);
        return { achieved: false, duration: 0 };
      }

      // 予期せぬエラーは再スローして隠蔽しないようにする
      console.error('[SmartWaiter] Unexpected error during wait:', e);
      throw e;
    }
  }
}
