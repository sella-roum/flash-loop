/**
 * src/core/smart-waiter.ts
 * DOMの変更状況を監視し、ページが「安定」するまで待機するユーティリティ。
 * networkidle に依存せず、実際のDOM描画完了を検知する。
 */
import { Page } from 'playwright';

export class SmartWaiter {
  /**
   * DOMの変更が落ち着くまで待機する。
   * 無限ループを防ぐため、タイムアウト付きのソフト待機を行う。
   *
   * @param page 対象のPlaywright Pageオブジェクト
   * @param stabilityDuration この期間(ms)変更がなければ「安定」とみなす
   * @param maxTimeout 最大待機時間(ms)。これを超えたら不安定でも次へ進む（ソフトタイムアウト）
   */
  static async wait(page: Page, stabilityDuration = 300, maxTimeout = 2000): Promise<void> {
    try {
      await page.evaluate(
        ({ duration, timeout }) => {
          return new Promise<void>((resolve) => {
            let timer: number | undefined;
            const start = Date.now();

            // ノイズとなりうる要素（常に更新され続けるもの）を除外するためのチェック関数
            const isNoisyMutation = (mutations: MutationRecord[]): boolean => {
              return mutations.every((m) => {
                const target = m.target as Element;
                if (!target) return false;

                // SVGアニメーション、動画、スピナーなどは無視
                const tagName = target.tagName ? target.tagName.toLowerCase() : '';
                const classList = target.classList ? Array.from(target.classList).join(' ') : '';

                return (
                  tagName === 'video' ||
                  tagName === 'svg' ||
                  tagName === 'path' ||
                  classList.includes('spinner') ||
                  classList.includes('loader') ||
                  classList.includes('progress')
                );
              });
            };

            const observer = new MutationObserver((mutations) => {
              // ノイズのみの変更であればタイマーをリセットしない
              if (isNoisyMutation(mutations)) return;

              if (timer) clearTimeout(timer);

              // 最大時間を超えたら強制終了（Resolveして進む）
              if (Date.now() - start > timeout) {
                observer.disconnect();
                resolve();
                return;
              }

              // 変更があったのでタイマーをリセットし、再び stabilityDuration 待つ
              timer = window.setTimeout(() => {
                observer.disconnect();
                resolve();
              }, duration);
            });

            // 監視開始: 子要素、属性、孫要素の変更をすべて監視
            observer.observe(document.body, { childList: true, attributes: true, subtree: true });

            // 初期タイマー（最初から変化がない場合用）
            timer = window.setTimeout(() => {
              observer.disconnect();
              resolve();
            }, duration);
          });
        },
        { duration: stabilityDuration, timeout: maxTimeout }
      );
    } catch (e) {
      // 評価中にページ遷移が発生した場合などはエラーになるが、
      // 待機失敗として処理を止めず、警告を出して進む
      console.warn('[SmartWaiter] Wait logic interrupted (likely navigation):', e);
    }
  }
}
