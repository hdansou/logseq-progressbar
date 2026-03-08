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

  // Extract the query DSL string — the property value is often a DB reference,
  // not a raw string. Try multiple resolution strategies.
  const queryStr = await resolveQueryDSL(queryUUID, queryBlock);
  if (!queryStr) return [];

  // Execute the DSL query
  const queryResults = await logseq.DB.q(queryStr);
  if (!Array.isArray(queryResults)) return [];

  const results: BlockData[] = [];
  for (const block of queryResults) {
    if (!block?.uuid) continue;
    const bd = await toBlockData(block);
    if (bd) results.push(bd);
  }
  return results;
}

/**
 * Resolve the query DSL string from a query block.
 *
 * In DB graphs, `logseq.property/query` is a reference ({db/id: N}),
 * not the raw DSL string. We try multiple strategies to extract it.
 */
async function resolveQueryDSL(
  uuid: string,
  _block: any
): Promise<string | null> {
  // Strategy 1: getBlockProperty with short key "query" (SDK normalizes namespaced keys)
  for (const key of ["query", "logseq.property/query"]) {
    try {
      const val = await logseq.Editor.getBlockProperty(uuid, key);
      console.log(`[progress-bar] getBlockProperty("${key}"):`, typeof val, val);
      const str = extractDSLString(val);
      if (str) return str;
    } catch (e) {
      console.log(`[progress-bar] getBlockProperty("${key}") error:`, e);
    }
  }

  // Strategy 2: getBlockProperties — inspect all keys for query-related ones
  try {
    const props = await logseq.Editor.getBlockProperties(uuid);
    console.log("[progress-bar] getBlockProperties keys:", props ? Object.keys(props) : "null");
    if (props) {
      for (const [key, val] of Object.entries(props)) {
        if (key.toLowerCase().includes("query")) {
          console.log(`[progress-bar] property "${key}":`, typeof val, val);
          const str = extractDSLString(val);
          if (str) return str;
        }
      }
    }
  } catch (e) {
    console.log("[progress-bar] getBlockProperties error:", e);
  }

  // Strategy 3: Datascript — resolve the reference entity's title directly
  try {
    const result = await logseq.DB.datascriptQuery(`
      [:find ?q .
       :in $ ?uuid
       :where
       [?b :block/uuid ?uuid]
       [?b :logseq.property/query ?qid]
       [?qid :block/title ?q]]
    `, `#uuid "${uuid}"`);
    console.log("[progress-bar] datascript result:", typeof result, result);
    const str = extractDSLString(result);
    if (str) return str;
  } catch (e) {
    console.log("[progress-bar] datascript error:", e);
  }

  // Strategy 4: Datascript — try pulling the entity with content
  try {
    const result = await logseq.DB.datascriptQuery(`
      [:find ?q .
       :in $ ?uuid
       :where
       [?b :block/uuid ?uuid]
       [?b :logseq.property/query ?qid]
       [(str ?qid) ?q]]
    `, `#uuid "${uuid}"`);
    console.log("[progress-bar] datascript str result:", typeof result, result);
    const str = extractDSLString(result);
    if (str) return str;
  } catch (e) {
    console.log("[progress-bar] datascript str error:", e);
  }

  console.warn("[progress-bar] Could not resolve query DSL for block:", uuid);
  return null;
}

/**
 * Extract a valid DSL query string from a value (string, object, or nested).
 * Valid DSL queries start with "(" — e.g., (and (tags [[Task]]) ...)
 */
function extractDSLString(val: unknown): string | null {
  if (val == null) return null;

  // Direct string
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("(")) return trimmed;
    return null; // Not a DSL query (e.g., block title)
  }

  // Reference object — look for nested string fields
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    for (const field of ["title", "content", "name", "value"]) {
      if (typeof obj[field] === "string") {
        const trimmed = (obj[field] as string).trim();
        if (trimmed.startsWith("(")) return trimmed;
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
