/**
 * Verbose progress-bar logs. Off unless the adapter enables it from the
 * `debug` setting, or `window.__LOGSEQ_PROGRESSBAR_DEBUG__ = true` is set in
 * the plugin frame's console for one-off troubleshooting.
 */
let enabled = false;

export function setDebug(on: boolean): void {
  enabled = on;
}

export function debug(...args: unknown[]): void {
  if (enabled || windowFlag()) console.log("[progress-bar]", ...args);
}

function windowFlag(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__LOGSEQ_PROGRESSBAR_DEBUG__ === true
  );
}
