/// <reference types="@logseq/libs" />

/**
 * Verbose progress-bar logs. No-op in production unless the user flips on
 * `debug` in plugin settings, or sets `window.__LOGSEQ_PROGRESSBAR_DEBUG__ = true`
 * in the browser console for one-off troubleshooting.
 */
export function debug(...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.log("[progress-bar]", ...args);
  }
}

function isDebugEnabled(): boolean {
  if (typeof window !== "undefined") {
    const flag = (window as unknown as Record<string, unknown>)
      .__LOGSEQ_PROGRESSBAR_DEBUG__;
    if (flag === true) return true;
  }
  if (typeof logseq !== "undefined") {
    const settings = (logseq as unknown as { settings?: Record<string, unknown> })
      .settings;
    if (settings?.debug === true) return true;
  }
  return false;
}
