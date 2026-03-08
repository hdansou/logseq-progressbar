import type { ProgressBarConfig, StatusCounts } from "./types";

interface BlockData {
  uuid: string;
  tags: string[]; // tag names on this block
  properties: Record<string, unknown>;
}

// ─── Query mode: direct datascript counting ───────────────────────────

/** Structured representation of a parsed DSL query */
interface ParsedDSL {
  statuses: string[]; // from (task "Done" "Doing" "Todo")
  dateRange: { start: number; end: number } | null; // from (between ...)
  tagFilters: string[]; // from (tags [[Task]])
  propertyFilters: Array<{ key: string; value: string }>; // from (property :key "value")
}

/**
 * Count blocks by status directly from a query block's DSL using datascript.
 * This replaces the broken DB.q() approach with a single efficient count query.
 *
 * Flow: UUID → resolveQueryDSL() → parseDSL() → datascriptQuery(count) → StatusCounts
 */
export async function countQueryStatuses(
  queryUUID: string,
  config: ProgressBarConfig
): Promise<StatusCounts> {
  const queryBlock = await logseq.Editor.getBlock(queryUUID);
  if (!queryBlock) return emptyStatusCounts();

  // Step 1: Get the query DSL string from the block
  const queryStr = await resolveQueryDSL(queryUUID, queryBlock);
  if (!queryStr) return emptyStatusCounts();

  console.log("[progress-bar] query DSL:", queryStr);

  // Step 2: Parse DSL into structured components
  const parsed = parseDSL(queryStr);
  console.log("[progress-bar] parsed:", JSON.stringify(parsed));

  // Step 3: Build and execute datascript count query
  const dsQuery = await buildStatusCountQuery(parsed, config);
  console.log("[progress-bar] datascript:", dsQuery);

  try {
    const res = await logseq.DB.datascriptQuery(dsQuery);
    const stats = transformCountResults(res, config);
    console.log("[progress-bar] counts:", JSON.stringify(stats));
    return stats;
  } catch (e) {
    console.error("[progress-bar] datascript count query failed:", e);
    return emptyStatusCounts();
  }
}

/**
 * Parse Logseq query DSL into structured components.
 * Extracts status values, date ranges, tag filters, and property filters.
 */
export function parseDSL(dsl: string): ParsedDSL {
  const result: ParsedDSL = {
    statuses: [],
    dateRange: null,
    tagFilters: [],
    propertyFilters: [],
  };

  // Extract (task "Done" "Doing" "Todo") statuses
  const taskMatch = dsl.match(/\(\s*task\s+(.+?)\)/i);
  if (taskMatch) {
    const inner = taskMatch[1];
    for (const m of inner.matchAll(/"([^"]+)"/g)) {
      result.statuses.push(m[1]);
    }
    // Fallback: bare words if no quoted values
    if (result.statuses.length === 0) {
      result.statuses.push(...inner.trim().split(/\s+/).filter(Boolean));
    }
  }

  // Extract (between [[uuid1]] [[uuid2]]) date range
  const betweenMatch = dsl.match(
    /\(\s*between\s+\[\[([^\]]+)\]\]\s+\[\[([^\]]+)\]\]\s*\)/i
  );
  if (betweenMatch) {
    const dateFromUUID = (uuid: string): number | null => {
      const m = uuid.match(/00000001-(\d{4})-(\d{2})(\d{2})-/);
      if (!m) return null;
      return parseInt(`${m[1]}${m[2]}${m[3]}`);
    };
    const start = dateFromUUID(betweenMatch[1]);
    const end = dateFromUUID(betweenMatch[2]);
    if (start !== null && end !== null) {
      result.dateRange = { start, end };
    }
  }

  // Extract (tags [[TagName]]) filters
  const tagsMatch = dsl.match(/\(\s*tags\s+((?:\[\[[^\]]+\]\]\s*)+)\)/i);
  if (tagsMatch) {
    for (const m of tagsMatch[1].matchAll(/\[\[([^\]]+)\]\]/g)) {
      result.tagFilters.push(m[1]);
    }
  }

  // Extract (property :key "value") filters
  for (const m of dsl.matchAll(/\(\s*property\s+:(\S+)\s+"([^"]+)"\s*\)/gi)) {
    result.propertyFilters.push({ key: m[1], value: m[2] });
  }

  return result;
}

/**
 * Build a datascript query that returns [status-value, count] pairs.
 * Translates parsed DSL components into datascript where-clauses.
 */
async function buildStatusCountQuery(
  parsed: ParsedDSL,
  config: ProgressBarConfig
): Promise<string> {
  // Determine the property to track from config
  const trackedProperty =
    Object.values(config.propertyMappings)[0] || "status";
  const propertyAttr = `:logseq.property/${trackedProperty}`;

  const whereClauses: string[] = [];

  // Core: find blocks with the tracked property and get its title
  whereClauses.push(`[?b ${propertyAttr} ?s]`);
  whereClauses.push("[?s :block/title ?status]");

  // Filter by specific status values from (task ...)
  if (parsed.statuses.length > 0) {
    if (parsed.statuses.length === 1) {
      whereClauses.push(`[?s :block/title "${parsed.statuses[0]}"]`);
    } else {
      const orClauses = parsed.statuses
        .map((s) => `[?s :block/title "${s}"]`)
        .join("\n         ");
      whereClauses.push(`(or ${orClauses})`);
    }
  }

  // Date range filter from (between ...)
  if (parsed.dateRange) {
    whereClauses.push("[?b :block/page ?p]");
    whereClauses.push("[?p :block/journal-day ?d]");
    whereClauses.push(`[(>= ?d ${parsed.dateRange.start})]`);
    whereClauses.push(`[(<= ?d ${parsed.dateRange.end})]`);
  }

  // Tag filter from (tags [[...]])
  if (parsed.tagFilters.length > 0) {
    const resolvedTags = await resolveUUIDRefs(parsed.tagFilters);
    if (resolvedTags.length > 0) {
      whereClauses.push("[?b :block/tags ?tag]");
      if (resolvedTags.length === 1) {
        whereClauses.push(`[?tag :block/title "${resolvedTags[0]}"]`);
      } else {
        const orClauses = resolvedTags
          .map((t) => `[?tag :block/title "${t}"]`)
          .join("\n         ");
        whereClauses.push(`(or ${orClauses})`);
      }
    }
  }

  // Property filters from (property :key "value")
  for (let i = 0; i < parsed.propertyFilters.length; i++) {
    const pf = parsed.propertyFilters[i];
    const attrName = pf.key.includes("/")
      ? pf.key
      : `logseq.property/${pf.key}`;
    whereClauses.push(`[?b :${attrName} ?pv${i}]`);
    whereClauses.push(`[?pv${i} :block/title "${pf.value}"]`);
  }

  const whereStr = whereClauses.join("\n       ");

  return `[:find ?status (count ?b)
     :where
     ${whereStr}]`;
}

/**
 * Resolve UUID strings to page titles for use in datascript queries.
 */
async function resolveUUIDRefs(refs: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const ref of refs) {
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        ref
      )
    ) {
      try {
        const name = await logseq.DB.datascriptQuery(`
          [:find ?t .
           :where [?b :block/uuid #uuid "${ref}"]
                  [?b :block/title ?t]]
        `);
        if (typeof name === "string") {
          resolved.push(name);
          continue;
        }
      } catch {
        // skip unresolvable
      }
    }
    // Not a UUID or resolution failed — use as-is (already a page name)
    resolved.push(ref);
  }
  return resolved;
}

/**
 * Transform datascript [[status, count], ...] results into StatusCounts.
 */
export function transformCountResults(
  res: any,
  config: ProgressBarConfig
): StatusCounts {
  if (!Array.isArray(res) || res.length === 0) return emptyStatusCounts();

  const counts: Record<string, number> = {};
  let total = 0;
  let completed = 0;

  // Build the set of "complete" values from config
  const completeSet = new Set<string>();
  for (const vals of Object.values(config.completeValues)) {
    for (const v of vals) {
      completeSet.add(v.toLowerCase());
    }
  }

  for (const item of res) {
    // datascriptQuery with :find ?x (count ?b) returns [[status, count], ...]
    const row = Array.isArray(item) ? item : [item];
    const status = String(row[0]);
    const count = typeof row[1] === "number" ? row[1] : 1;

    counts[status] = (counts[status] || 0) + count;
    total += count;

    if (completeSet.has(status.toLowerCase())) {
      completed += count;
    }
  }

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { counts, total, completed, percent };
}

function emptyStatusCounts(): StatusCounts {
  return { counts: {}, total: 0, completed: 0, percent: 0 };
}

// ─── Children/page mode: block scanning ───────────────────────────────

/**
 * Scan descendant blocks of a parent block, respecting depth config.
 */
export async function scanChildren(
  parentUUID: string,
  config: ProgressBarConfig
): Promise<BlockData[]> {
  const block = await logseq.Editor.getBlock(parentUUID, {
    includeChildren: true,
  });
  if (!block?.children?.length) return [];

  const results: BlockData[] = [];
  await collectBlocks(block.children as any[], results, 1, config.depth);
  return results;
}

/**
 * Scan all blocks on a page, respecting depth config.
 */
export async function scanPage(
  pageName: string,
  config: ProgressBarConfig
): Promise<BlockData[]> {
  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  if (!blocks?.length) return [];

  const results: BlockData[] = [];
  await collectBlocks(blocks as any[], results, 1, config.depth);
  return results;
}

/**
 * Filter blocks by tag scope according to config.
 * - Strict mode: only blocks with matching tags
 * - Inclusive mode: all blocks, using first matching tag for property lookup
 */
export function filterByTags(
  blocks: BlockData[],
  config: ProgressBarConfig
): BlockData[] {
  const tagSet = new Set(config.tags.map((t) => t.toLowerCase()));

  if (config.strict) {
    return blocks.filter((b) =>
      b.tags.some((t) => tagSet.has(t.toLowerCase()))
    );
  }

  // Inclusive mode: return all blocks (tag mapping resolved in aggregator)
  return blocks;
}

// ─── DSL resolution (shared) ──────────────────────────────────────────

/**
 * Resolve the query DSL string from a query block.
 *
 * In DB graphs, `logseq.property/query` is a reference ({db/id: N}),
 * not the raw DSL string. We use datascript to follow the reference
 * and extract the actual DSL string.
 */
async function resolveQueryDSL(
  uuid: string,
  _block: any
): Promise<string | null> {
  // Strategy 1: Pull full block entity with inlined UUID
  try {
    const pulled = await logseq.DB.datascriptQuery(`
      [:find (pull ?b [*]) .
       :where
       [?b :block/uuid #uuid "${uuid}"]]
    `);
    if (pulled) {
      const dsl = findDSLInEntity(pulled);
      if (dsl) return dsl;
    }
  } catch (e) {
    console.log("[progress-bar] pull entity error:", e);
  }

  // Strategy 2: Resolve the query reference entity's title via datascript
  try {
    const result = await logseq.DB.datascriptQuery(`
      [:find ?q .
       :where
       [?b :block/uuid #uuid "${uuid}"]
       [?b :logseq.property/query ?qid]
       [?qid :block/title ?q]]
    `);
    if (typeof result === "string" && result.trim().startsWith("(")) {
      return result.trim();
    }
  } catch (e) {
    console.log("[progress-bar] datascript resolve error:", e);
  }

  // Strategy 3: getBlock + deep inspect of properties
  try {
    const block = await logseq.Editor.getBlock(uuid);
    if (block) {
      const dsl = findDSLInEntity(block as any);
      if (dsl) return dsl;
      if (block.properties) {
        const dsl2 = findDSLInEntity(block.properties as any);
        if (dsl2) return dsl2;
      }
    }
  } catch (e) {
    console.log("[progress-bar] getBlock error:", e);
  }

  console.warn("[progress-bar] Could not resolve query DSL for block:", uuid);
  return null;
}

/**
 * Recursively search an entity object for a DSL query string.
 * Valid DSL queries start with "(".
 */
function findDSLInEntity(obj: Record<string, unknown>): string | null {
  for (const [_key, val] of Object.entries(obj)) {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed.startsWith("(") && trimmed.endsWith(")")) return trimmed;
    }
    // Check one level deep into nested objects
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      for (const [_nk, nv] of Object.entries(nested)) {
        if (typeof nv === "string") {
          const trimmed = nv.trim();
          if (trimmed.startsWith("(") && trimmed.endsWith(")")) return trimmed;
        }
      }
    }
  }
  return null;
}

// ─── Internal helpers (children mode) ─────────────────────────────────

async function collectBlocks(
  children: any[],
  results: BlockData[],
  currentDepth: number,
  maxDepth: number
): Promise<void> {
  if (currentDepth > maxDepth) return;

  for (const child of children) {
    if (!child?.uuid) continue;

    const bd = await toBlockData(child);
    if (bd) results.push(bd);

    if (child.children?.length && currentDepth < maxDepth) {
      await collectBlocks(child.children, results, currentDepth + 1, maxDepth);
    }
  }
}

async function toBlockData(block: any): Promise<BlockData | null> {
  if (!block?.uuid) return null;

  const full = await logseq.Editor.getBlock(block.uuid);
  if (!full) return null;

  const props = (await logseq.Editor.getBlockProperties(block.uuid)) ?? {};
  const tags = await getBlockTagNames(block.uuid);

  return {
    uuid: block.uuid,
    tags,
    properties: props,
  };
}

async function getBlockTagNames(uuid: string): Promise<string[]> {
  try {
    const block = await logseq.Editor.getBlock(uuid);
    if (!block) return [];

    const props = block.properties ?? {};
    const tagsProp = props.tags ?? props["block/tags"] ?? [];
    if (Array.isArray(tagsProp)) {
      return tagsProp
        .map((t: any) =>
          typeof t === "string" ? t : t?.name ?? t?.title ?? t?.content ?? ""
        )
        .filter(Boolean);
    }

    return [];
  } catch {
    return [];
  }
}
