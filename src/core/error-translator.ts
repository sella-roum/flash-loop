/**
 * src/core/error-translator.ts
 * Playwrightの技術的なエラーメッセージを、AIがアクション修正に使える自然言語に翻訳する
 */

export class ErrorTranslator {
  /**
   * エラーオブジェクトまたはメッセージを解析し、AIへのアドバイスを生成する
   */
  static translate(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);

    // 1. Timeout Error (要素が見つからない、消えない)
    if (msg.includes('Timeout') || msg.includes('waiting for selector')) {
      return `Timeout Error: The element could not be found or interacted with within the time limit.
Advice:
- Check if the 'targetId' corresponds to the correct element.
- The element might be hidden or inside a collapsed section. Try 'scroll' to make it visible.
- If the page is loading, use 'wait_for_element' or check if a spinner is visible.`;
    }

    // 2. Click Intercepted (別の要素が重なっている)
    if (msg.includes('intercepted') || msg.includes('obscures')) {
      return `Interaction Failed: The click was intercepted by another element (likely a modal, overlay, or sticky header).
Advice:
- Look for a modal dialog or popup and close it first.
- If it's a cookie banner, try to close or accept it.
- If the element is covered by a header, try 'scroll' to move it to a clear area.`;
    }

    // 3. Detached / Stale Element (DOMが更新された)
    if (msg.includes('detached') || msg.includes('stale') || msg.includes('target closed')) {
      return `Stale Element Error: The page structure changed while trying to interact.
Advice:
- The element might have been removed or re-rendered.
- Stop and re-observe the current state. The ID might have changed or the element is gone.`;
    }

    // 4. Element not visible / hidden
    if (msg.includes('not visible') || msg.includes('hidden')) {
      return `Visibility Error: The target element is present in the DOM but not visible to the user.
Advice:
- It might be \`display: none\` or \`visibility: hidden\`.
- If it's inside a dropdown or menu, click the parent trigger first.
- Try scrolling to the element.`;
    }

    // 5. Navigation Failed
    if (msg.includes('Navigation failed') || msg.includes('net::')) {
      return `Navigation Error: Failed to load the URL.
Advice:
- Check the URL format.
- The site might be down or blocking the request.`;
    }

    // Fallback
    const cleanMsg = msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
    return `Unknown Execution Error: ${cleanMsg}
Advice: Try a different approach or verify the target element.`;
  }
}
