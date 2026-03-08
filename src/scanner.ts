import type { ProgressBarConfig } from "./types";

interface BlockData {
  uuid: string;
  tags: string[]; // tag names on this block
  properties: Record<string, unknown>;
}

/**
 * Scan descendant blocks of a parent block, respecting depth config.
 */
export async function scanChildren(
  parentUUID: string,
  config: ProgressBarConfig
): Promise<BlockData[]> {
  const block = await logseq.Editor.getBlock(parentUUID, { includeChildren: true });
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
 * Fetch blocks returned by a Logseq query block.
 */
export async function scanQuery(
  queryUUID: string,
  config: ProgressBarConfig
): Promise<BlockData[]> {
  const queryBlock = await logseq.Editor.getBlock(queryUUID);
  if (!queryBlock) return [];

  // Extract the query DSL string
  const queryStr = await resolveQueryDSL(queryUUID, queryBlock);
  if (!queryStr) return [];

  console.log("[progress-bar] resolved query DSL:", queryStr);

  // Try to execute the query — DB.q() may fail for complex DSL with
  // (between ...) clauses since date bindings aren't provided by the plugin API.
  let queryResults: any[] | null = null;

  // Attempt 1: Execute the full DSL
  try {
    const res = await logseq.DB.q(queryStr);
    if (Array.isArray(res)) queryResults = res;
  } catch (e) {
    console.warn("[progress-bar] DB.q() failed for full DSL:", e);
  }

  // Attempt 2: Strip (between ...) and retry with just tag/property filters
  if (!queryResults?.length) {
    const simplified = stripBetweenClause(queryStr);
    if (simplified !== queryStr) {
      console.log("[progress-bar] retrying with simplified DSL:", simplified);
      try {
        const res = await logseq.DB.q(simplified);
        if (Array.isArray(res) && res.length > 0) queryResults = res;
      } catch (e) {
        console.warn("[progress-bar] DB.q() failed for simplified DSL:", e);
      }
    }
  }

  // Attempt 3: Parse (task ...) statuses and query via datascript
  if (!queryResults?.length) {
    const taskStatuses = parseTaskStatuses(queryStr);
    if (taskStatuses.length > 0) {
      const dateRange = parseBetweenDates(queryStr);
      console.log("[progress-bar] datascript task fallback, statuses:", taskStatuses, "dateRange:", dateRange);
      queryResults = await queryTasksByStatus(taskStatuses, dateRange);
    }
  }

  // Attempt 4: Extract tags from DSL and use getTagObjects as fallback
  if (!queryResults?.length) {
    console.log("[progress-bar] falling back to getTagObjects");
    queryResults = await queryByTagsFallback(queryStr);
  }

  if (!queryResults?.length) return [];

  const results: BlockData[] = [];
  for (const block of queryResults) {
    // DB.q() in DB graphs may return {id: N} without uuid.
    // Resolve uuid from entity id if needed.
    let uuid = block?.uuid;
    if (!uuid && block?.id) {
      try {
        const entity = await logseq.DB.datascriptQuery(`
          [:find ?u .
           :where [${block.id} :block/uuid ?u]]
        `);
        if (entity) uuid = typeof entity === "string" ? entity : String(entity);
      } catch {
        // skip
      }
    }
    if (!uuid) continue;
    const bd = await toBlockData({ ...block, uuid });
    if (bd) results.push(bd);
  }
  return results;
}

/**
 * Parse task status values from DSL like (task "Done" "Doing" "Todo").
 */
function parseTaskStatuses(dsl: string): string[] {
  const match = dsl.match(/\(\s*task\s+(.+?)\)/i);
  if (!match) return [];

  const inner = match[1];
  const statuses: string[] = [];

  // Extract quoted values: "Done", "Doing"
  for (const m of inner.matchAll(/"([^"]+)"/g)) {
    statuses.push(m[1]);
  }

  // If no quoted values, try bare words: done doing todo
  if (statuses.length === 0) {
    statuses.push(...inner.trim().split(/\s+/).filter(Boolean));
  }

  return statuses;
}

/**
 * Parse date range from (between [[uuid1]] [[uuid2]]) in DSL.
 * DB graph journal UUIDs follow pattern: 00000001-YYYY-MMDD-0000-000000000000
 * Returns journal-day integers in YYYYMMDD format.
 */
function parseBetweenDates(dsl: string): { start: number; end: number } | null {
  const match = dsl.match(
    /\(\s*between\s+\[\[([^\]]+)\]\]\s+\[\[([^\]]+)\]\]\s*\)/i
  );
  if (!match) return null;

  const dateFromUUID = (uuid: string): number | null => {
    const m = uuid.match(/00000001-(\d{4})-(\d{2})(\d{2})-/);
    if (!m) return null;
    return parseInt(`${m[1]}${m[2]}${m[3]}`);
  };

  const start = dateFromUUID(match[1]);
  const end = dateFromUUID(match[2]);
  if (start === null || end === null) return null;
  return { start, end };
}

/**
 * Query blocks by task status using datascript, with optional date range.
 */
async function queryTasksByStatus(
  statuses: string[],
  dateRange: { start: number; end: number } | null
): Promise<any[]> {
  const allResults: any[] = [];

  for (const status of statuses) {
    try {
      const dateClause = dateRange
        ? `[?b :block/page ?p]
           [?p :block/journal-day ?d]
           [(>= ?d ${dateRange.start})]
           [(<= ?d ${dateRange.end})]`
        : "";

      const query = `
        [:find (pull ?b [:block/uuid])
         :where
         [?b :logseq.property/status ?s]
         [?s :block/title "${status}"]
         ${dateClause}]`;

      const res = await logseq.DB.datascriptQuery(query);
      if (Array.isArray(res)) {
        for (const item of res) {
          // datascriptQuery results can be [[{...}]] or [{...}]
          const block = Array.isArray(item) ? item[0] : item;
          if (block?.uuid) {
            allResults.push(block);
          }
        }
      }
    } catch (e) {
      console.log(`[progress-bar] datascript task query failed for "${status}":`, e);
    }
  }

  // Deduplicate by uuid
  const seen = new Set<string>();
  return allResults.filter((b) => {
    if (!b?.uuid || seen.has(b.uuid)) return false;
    seen.add(b.uuid);
    return true;
  });
}

/**
 * Remove (between ...) clauses from DSL, since DB.q() can't bind dates.
 * E.g. "(and (tags [[Task]]) (between [[x]] [[y]]))" → "(tags [[Task]])"
 */
function stripBetweenClause(dsl: string): string {
  // Remove (between ...) including nested parens
  let result = dsl.replace(/\(\s*between\s+[^)]*\)/gi, "").trim();
  // Clean up leftover (and X) → X
  result = result.replace(/\(\s*and\s+(\([^)]*\))\s*\)/g, "$1").trim();
  // Clean up empty (and) → remove
  result = result.replace(/\(\s*and\s*\)/g, "").trim();
  return result || dsl;
}

/**
 * Extract tag names from DSL like "(tags [[Task]])" and use getTagObjects.
 */
async function queryByTagsFallback(dsl: string): Promise<any[]> {
  const tagMatches = dsl.match(/\[\[([^\]]+)\]\]/g);
  if (!tagMatches?.length) return [];

  const tagNames = tagMatches.map((m) => m.slice(2, -2));
  const results: any[] = [];

  for (const tagName of tagNames) {
    try {
      const objects = await logseq.Editor.getTagObjects(tagName);
      if (Array.isArray(objects)) {
        results.push(...objects);
      }
    } catch (e) {
      console.log(`[progress-bar] getTagObjects("${tagName}") error:`, e);
    }
  }

  // Deduplicate by uuid
  const seen = new Set<string>();
  return results.filter((b) => {
    if (!b?.uuid || seen.has(b.uuid)) return false;
    seen.add(b.uuid);
    return true;
  });
}

/**
 * Resolve the query DSL string from a query block.
 *
 * In DB graphs, `logseq.property/query` is a reference ({db/id: N}),
 * not the raw DSL string. The SDK's getBlockProperty returns the property
 * definition entity, not the value. We must use datascript to resolve
 * the actual value, or pull the full block entity.
 */
async function resolveQueryDSL(
  uuid: string,
  _block: any
): Promise<string | null> {
  // Strategy 1: Pull full block entity with inlined UUID (avoids :in parameter issues)
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

// --- Internal helpers ---

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

  // Fetch full block to get properties and tags
  const full = await logseq.Editor.getBlock(block.uuid);
  if (!full) return null;

  const props = (await logseq.Editor.getBlockProperties(block.uuid)) ?? {};

  // Extract tag names from block
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

    // In DB graphs, tags are in the properties or accessible via the block entity
    // The block may have a tags property that contains tag references
    const props = block.properties ?? {};

    // Try various ways tags appear in the SDK
    const tagsProp = props.tags ?? props["block/tags"] ?? [];
    if (Array.isArray(tagsProp)) {
      return tagsProp.map((t: any) =>
        typeof t === "string" ? t : t?.name ?? t?.title ?? t?.content ?? ""
      ).filter(Boolean);
    }

    return [];
  } catch {
    return [];
  }
}
