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
      value = readPropertyValue(
        block.properties,
        prop,
        config.resolvedIdents?.[prop] ?? []
      );
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
 * Find the property value for a short name. Two paths:
 *
 *   1. Resolved-idents path (preferred): if the caller has a list of
 *      fully-qualified `:db/ident` strings (from identCache), match
 *      block-property keys exactly. No suffix guessing, no false positives.
 *
 *   2. Regex fallback: covers the four shapes Logseq emits when the cache
 *      hasn't been populated yet (pre-init, graph-load race, brand-new
 *      property created after refresh):
 *        a. `check`                            — plain name
 *        b. `:logseq.property/check`           — built-in, colon-prefixed
 *        c. `logseq.property/check`            — built-in, unprefixed
 *        d. `:user.property/check-pgUd_nnQ`    — user-defined with random suffix
 *      The suffix class includes `_` to match Logseq's actual squuid alphabet.
 *      Anchored boundary prevents `check` from matching `check-version-XXX`.
 */
function readPropertyValue(
  properties: Record<string, unknown>,
  propertyName: string,
  resolvedIdents: string[]
): string | boolean | null {
  if (resolvedIdents.length > 0) {
    const want = new Set(resolvedIdents.map(stripLeadingColon));
    for (const [key, val] of Object.entries(properties)) {
      if (val == null) continue;
      if (want.has(stripLeadingColon(key))) return extractValue(val);
    }
    // Cache hit but no match on this block — don't fall through to regex,
    // it could over-match a similarly-named property.
    return null;
  }

  const lower = propertyName.toLowerCase();
  const re = new RegExp(`^:?(.+/)?${escapeRegex(lower)}(?:-[A-Za-z0-9_]+)?$`);
  for (const [key, val] of Object.entries(properties)) {
    if (re.test(key.toLowerCase()) && val != null) {
      return extractValue(val);
    }
  }
  return null;
}

function stripLeadingColon(s: string): string {
  return s.startsWith(":") ? s.slice(1) : s;
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
