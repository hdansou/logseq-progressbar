import type { StatusColor, BarSegment } from "./types";

/** Default color palette — keys are lowercase status names */
const DEFAULT_COLORS: Record<string, StatusColor> = {
  done:        { light: "#4ade80", dark: "#22c55e" },
  completed:   { light: "#4ade80", dark: "#22c55e" },
  doing:       { light: "#60a5fa", dark: "#3b82f6" },
  now:         { light: "#60a5fa", dark: "#3b82f6" },
  "in review": { light: "#facc15", dark: "#eab308" },
  "in-review": { light: "#facc15", dark: "#eab308" },
  todo:        { light: "#e2e8f0", dark: "#475569" },
  next:        { light: "#c4b5fd", dark: "#7c3aed" },
  later:       { light: "#e2e8f0", dark: "#475569" },
  backlog:     { light: "#f1f5f9", dark: "#334155" },
  canceled:    { light: "#fca5a5", dark: "#ef4444" },
  cancelled:   { light: "#fca5a5", dark: "#ef4444" },
};

export const FALLBACK_COLOR: StatusColor = { light: "#d1d5db", dark: "#4b5563" };

export type ThemeMode = "light" | "dark";

/**
 * Segment ordering priority — completed statuses first, then active, then pending.
 * Lower number = further left in the bar.
 */
const ORDER_PRIORITY: Record<string, number> = {
  done: 0,
  completed: 0,
  canceled: 1,
  cancelled: 1,
  "in review": 2,
  "in-review": 2,
  doing: 3,
  now: 3,
  next: 4,
  todo: 5,
  later: 5,
  backlog: 6,
};

/**
 * A colour value that is safe to place inside `style="background:…"`:
 * hex, `rgb()/rgba()/hsl()/hsla()` with numeric arguments, a CSS variable
 * reference, or a bare keyword. Anything else (`;`, `}`, `url(`, …) is
 * rejected so a settings value can never break out of the declaration.
 */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/]+\)|var\(--[a-z0-9-]+\)|[a-z]+)$/i;

export function isSafeColor(value: unknown): value is string {
  return typeof value === "string" && SAFE_COLOR.test(value.trim());
}

/**
 * Get the color for a status value, respecting user overrides.
 */
export function getStatusColor(
  status: string,
  mode: ThemeMode,
  overrides: Record<string, StatusColor>
): string {
  const key = status.toLowerCase();
  const candidate =
    overrides[key]?.[mode] ?? overrides[status]?.[mode] ?? DEFAULT_COLORS[key]?.[mode];
  return isSafeColor(candidate) ? candidate.trim() : FALLBACK_COLOR[mode];
}

/**
 * Build sorted bar segments from status counts.
 * Completed segments on the left, pending on the right.
 */
export function buildSegments(
  counts: Record<string, number>,
  total: number,
  completeValues: Record<string, string[]>,
  mode: ThemeMode,
  colorOverrides: Record<string, StatusColor>
): BarSegment[] {
  const completeSet = new Set<string>();
  for (const vals of Object.values(completeValues)) {
    for (const v of vals) completeSet.add(v.toLowerCase());
  }

  const segments: BarSegment[] = Object.entries(counts).map(([label, count]) => ({
    label,
    count,
    percent: total > 0 ? (count / total) * 100 : 0,
    color: getStatusColor(label, mode, colorOverrides),
    isComplete: completeSet.has(label.toLowerCase()),
  }));

  // Sort: completed first, then by priority order, then alphabetically
  segments.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? -1 : 1;
    const pa = ORDER_PRIORITY[a.label.toLowerCase()] ?? 99;
    const pb = ORDER_PRIORITY[b.label.toLowerCase()] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.label.localeCompare(b.label);
  });

  return segments;
}

/**
 * Parse user color overrides from the settings JSON string. Only entries
 * shaped `{ light: string, dark: string }` survive; the values themselves
 * are validated again by `getStatusColor` at render time.
 */
export function parseColorOverrides(raw: unknown): Record<string, StatusColor> {
  if (typeof raw !== "string") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, StatusColor> = {};
  for (const [status, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== "object") continue;
    const { light, dark } = entry as Record<string, unknown>;
    if (typeof light === "string" && typeof dark === "string") out[status] = { light, dark };
  }
  return out;
}
