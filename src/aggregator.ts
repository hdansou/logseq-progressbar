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
  const tagSet = new Set(config.tags.map((t) => t.toLowerCase()));

  // Collect all complete values across all properties
  const completeSet = new Set<string>();
  for (const vals of Object.values(config.completeValues)) {
    for (const v of vals) {
      completeSet.add(v.toLowerCase());
    }
  }

  for (const block of blocks) {
    // Find the property to read for this block
    const property = resolveProperty(block.tags, tagToProperty, tagSet);
    if (!property) continue;

    // Read the property value
    const value = readPropertyValue(block.properties, property);
    if (!value) continue; // Skip blocks with no value

    const label = String(value);
    counts[label] = (counts[label] || 0) + 1;
    total++;

    if (completeSet.has(label.toLowerCase())) {
      completed++;
    }
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

function resolveProperty(
  blockTags: string[],
  tagToProperty: Record<string, string>,
  tagSet: Set<string>
): string | null {
  // Find first matching tag and return its mapped property
  for (const tag of blockTags) {
    const key = Object.keys(tagToProperty).find(
      (k) => k.toLowerCase() === tag.toLowerCase()
    );
    if (key) return tagToProperty[key];
  }

  // If no tag matches but we're in inclusive mode, use the first property mapping
  const firstProp = Object.values(tagToProperty)[0];
  return firstProp ?? null;
}

function readPropertyValue(
  properties: Record<string, unknown>,
  propertyName: string
): string | null {
  // Try exact match first
  if (properties[propertyName] != null) {
    return extractStringValue(properties[propertyName]);
  }

  // Try with logseq.property/ prefix (DB graph format)
  const prefixed = `logseq.property/${propertyName}`;
  if (properties[prefixed] != null) {
    return extractStringValue(properties[prefixed]);
  }

  // Try case-insensitive match
  const lowerName = propertyName.toLowerCase();
  for (const [key, val] of Object.entries(properties)) {
    if (key.toLowerCase() === lowerName || key.toLowerCase().endsWith(`/${lowerName}`)) {
      if (val != null) return extractStringValue(val);
    }
  }

  return null;
}

function extractStringValue(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === "string") return val || null;
  if (typeof val === "object" && val !== null) {
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
