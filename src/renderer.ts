import type { BarSegment, StatusCounts, ProgressBarConfig } from "./types";
import { formatLabel } from "./aggregator";

export const COMPACT_WIDTH = "200px";

/**
 * A width value that is safe inside `style="width:…"`: `full`, `compact`,
 * or a plain CSS length / percentage. Anything else falls back to full.
 */
const SAFE_LENGTH = /^\d+(\.\d+)?(px|%|em|rem|ch|vw)$/i;

export function cssWidth(barWidth: unknown): string {
  const v = typeof barWidth === "string" ? barWidth.trim().toLowerCase() : "";
  if (v === "compact") return COMPACT_WIDTH;
  if (SAFE_LENGTH.test(v)) return v;
  return "100%";
}

/**
 * Render the progress bar HTML string.
 */
export function renderBar(
  segments: BarSegment[],
  stats: StatusCounts,
  config: ProgressBarConfig,
  instanceId: string
): string {
  if (stats.total === 0 && !config.showOnEmpty) return "";

  const label = formatLabel(stats, config.displayFormat);
  const tooltip = escape(buildTooltipLines(segments, stats).join("\n")).replace(/\n/g, "&#10;");

  const segmentsHtml = segments
    .map(
      (seg) =>
        `<div class="pb-segment" style="width:${seg.percent.toFixed(2)}%;background:${seg.color}" data-label="${escape(seg.label)}: ${seg.count}"></div>`
    )
    .join("");

  return `<div class="pb-wrapper" style="width:${cssWidth(config.barWidth)}" data-id="${escape(instanceId)}">
  <div class="pb-bar" title="${tooltip}">
    ${segmentsHtml}
  </div>
  <span class="pb-label">${escape(label)}</span>
</div>`;
}

/**
 * Render an empty state.
 */
export function renderEmpty(message: string, instanceId: string, barWidth: unknown = "full"): string {
  return `<div class="pb-wrapper pb-empty" style="width:${cssWidth(barWidth)}" data-id="${escape(instanceId)}">
  <span class="pb-empty-label">${escape(message)}</span>
</div>`;
}

/**
 * Render an error state (message is the caught error's text).
 */
export function renderError(message: string, instanceId: string): string {
  return `<div class="pb-error" data-id="${escape(instanceId)}">${escape(message)}</div>`;
}

/**
 * All CSS styles for the progress bar plugin.
 */
export const PLUGIN_CSS = `
/* Progress Bar Plugin Styles */
.pb-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  max-width: 100%;
}
.pb-bar {
  flex: 1;
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--ls-tertiary-background-color, #e2e8f0);
  cursor: default;
  min-width: 60px;
}
.pb-segment {
  height: 100%;
  transition: width 0.4s ease-in-out;
  min-width: 0;
}
.pb-segment:first-child {
  border-radius: 5px 0 0 5px;
}
.pb-segment:last-child {
  border-radius: 0 5px 5px 0;
}
.pb-segment:only-child {
  border-radius: 5px;
}
.pb-label {
  font-size: 0.8em;
  font-weight: 500;
  color: var(--ls-secondary-text-color, #6b7280);
  white-space: nowrap;
  min-width: 32px;
  text-align: right;
}
.pb-empty {
  opacity: 0.5;
}
.pb-empty-label {
  font-size: 0.8em;
  color: var(--ls-secondary-text-color, #999);
  font-style: italic;
}
.pb-error {
  color: var(--ls-error-text-color, #e55);
  background: var(--ls-tertiary-background-color, #fee);
  border: 1px solid var(--ls-error-text-color, #e55);
  border-radius: 4px;
  padding: 4px 8px;
  font-family: monospace;
  font-size: 0.8em;
}
`;

// --- Helpers ---

function buildTooltipLines(segments: BarSegment[], stats: StatusCounts): string[] {
  const lines = segments.map((s) => `${s.label}: ${s.count}`);
  lines.push("─".repeat(16));
  lines.push(`Total: ${stats.total}`);
  return lines;
}

/** One escaper for text nodes and attribute values alike. */
export function escape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
