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
 * not the raw DSL string. The SDK's getBlockProperty returns the property
 * definition entity, not the value. We must use datascript to resolve
 * the actual value, or pull the full block entity.
 */
async function resolveQueryDSL(
  uuid: string,
  _block: any
): Promise<string | null> {
  // Strategy 1: Pull full block entity via datascript and inspect all attributes
  try {
    const pulled = await logseq.DB.datascriptQuery(`
      [:find (pull ?b [*]) .
       :in $ ?uuid
       :where
       [?b :block/uuid ?uuid]]
    `, `#uuid "${uuid}"`);
    console.log("[progress-bar] pulled block entity keys:", pulled ? Object.keys(pulled) : "null");
    if (pulled) {
      // Log all keys that might contain the query
      for (const [k, v] of Object.entries(pulled)) {
        if (k.toLowerCase().includes("query") || k.includes("logseq.property")) {
          console.log(`[progress-bar] entity["${k}"]:`, typeof v, v);
        }
      }
      // Try to find the query DSL in the pulled entity
      const dsl = findDSLInEntity(pulled);
      if (dsl) return dsl;
    }
  } catch (e) {
    console.log("[progress-bar] pull entity error:", e);
  }

  // Strategy 2: Datascript — resolve the reference entity's title
  try {
    const result = await logseq.DB.datascriptQuery(`
      [:find ?q .
       :in $ ?uuid
       :where
       [?b :block/uuid ?uuid]
       [?b :logseq.property/query ?qid]
       [?qid :block/title ?q]]
    `, `#uuid "${uuid}"`);
    console.log("[progress-bar] datascript resolve result:", typeof result, result);
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
      console.log("[progress-bar] getBlock keys:", Object.keys(block));
      console.log("[progress-bar] getBlock properties:", block.properties);
      const dsl = findDSLInEntity(block);
      if (dsl) return dsl;
      if (block.properties) {
        const dsl2 = findDSLInEntity(block.properties);
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
