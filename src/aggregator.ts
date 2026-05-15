import type { ProgressBarConfig, StatusCounts } from "./types";

interface BlockData {
  uuid: string;
  tags: string[];
  properties: Record<string, unknown>;
}

/**
 * Aggregate status counts from filtered blocks.
 *
 * For each block:
 * 1. Determine which property to read based on tag-to-property mapping
 * 2. Read the property value
 * 3. Skip blocks with no value set
 * 4. Count occurrences per status value
 * 5. Compute completion percentage
 */
export function aggregate(
  blocks: BlockData[],
  config: ProgressBarConfig
): StatusCounts {
  const counts: Record<string, number> = {};
  let total = 0;
  let completed = 0;

  const tagToProperty = config.propertyMappings;

  // Collect all complete values across all properties
  const completeSet = new Set<string>();
  for (const vals of Object.values(config.completeValues)) {
    for (const v of vals) {
      completeSet.add(v.toLowerCase());
    }
  }

  for (const block of blocks) {
    // Try each candidate property in turn. Tag-matched mappings come first;
    // if no tag matches (or tag resolution failed), fall back to every
    // mapped property so a checkbox block with empty tags still counts.
    const candidates = resolvePropertyCandidates(block.tags, tagToProperty);
    let value: string | boolean | null = null;
    for (const prop of candidates) {
      value = readPropertyValue(block.properties, prop);
      if (value !== null) break;
    }
    if (value === null) continue;

    // Boolean (checkbox) values self-bucket and self-complete.
    // Enum string values defer to the configured completeValues map.
    const label = typeof value === "boolean" ? (value ? "Done" : "Todo") : value;
    const isComplete =
      typeof value === "boolean" ? value : completeSet.has(label.toLowerCase());

    counts[label] = (counts[label] || 0) + 1;
    total++;
    if (isComplete) completed++;
  }

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { counts, total, completed, percent };
}

/**
 * Format the display label based on config.
 */
export function formatLabel(
  stats: StatusCounts,
  format: ProgressBarConfig["displayFormat"]
): string {
  switch (format) {
    case "fraction":
      return `${stats.completed}/${stats.total}`;
    case "both":
      return `${stats.completed}/${stats.total} · ${stats.percent}%`;
    case "percent":
    default:
      return `${stats.percent}%`;
  }
}

// --- Helpers ---

/**
 * Ordered list of properties to try for a block, in priority order:
 *   1. Properties whose tag matches one of the block's tags.
 *   2. (Fallback, when no tag matches OR tag resolution returned []) every
 *      property in the mapping, so a checkbox block with empty tags still
 *      counts.
 */
function resolvePropertyCandidates(
  blockTags: string[],
  tagToProperty: Record<string, string>
): string[] {
  const matched: string[] = [];
  for (const tag of blockTags) {
    const key = Object.keys(tagToProperty).find(
      (k) => k.toLowerCase() === tag.toLowerCase()
    );
    if (key) matched.push(tagToProperty[key]);
  }
  return matched.length > 0 ? matched : Object.values(tagToProperty);
}

/**
 * Find the property value across the four key shapes Logseq emits:
 *   1. `check`                            — plain name
 *   2. `:logseq.property/check`           — built-in, colon-prefixed
 *   3. `logseq.property/check`            — built-in, unprefixed
 *   4. `:user.property/check-F44tqsqr`    — user-defined with hash suffix
 *
 * One anchored regex covers all four. The leading `(.+/)?` makes the
 * namespace prefix optional, so plain `"check"` matches too. Anchored
 * boundary prevents looking up `check` from matching `check-version-XXX`.
 */
function readPropertyValue(
  properties: Record<string, unknown>,
  propertyName: string
): string | boolean | null {
  const lower = propertyName.toLowerCase();
  const re = new RegExp(`^:?(.+/)?${escapeRegex(lower)}(?:-[A-Za-z0-9]+)?$`);
  for (const [key, val] of Object.entries(properties)) {
    if (re.test(key.toLowerCase()) && val != null) {
      return extractValue(val);
    }
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractValue(val: unknown): string | boolean | null {
  if (val == null) return null;
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val || null;
  if (typeof val === "object") {
    // Reference property — may have name, title, or content
    const obj = val as Record<string, unknown>;
    return (
      (obj.name as string) ??
      (obj.title as string) ??
      (obj.content as string) ??
      String(val)
    );
  }
  return String(val);
}
