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
 * not the raw DSL string. We try multiple strategies:
 * 1. getBlockProperty — SDK may resolve the reference to a string
 * 2. Datascript query — resolve the reference entity's title/content
 * 3. Block content fallback
 */
async function resolveQueryDSL(
  uuid: string,
  block: any
): Promise<string | null> {
  // Strategy 1: getBlockProperty may resolve the reference
  try {
    const val = await logseq.Editor.getBlockProperty(uuid, "logseq.property/query");
    if (typeof val === "string" && val.trim()) return val.trim();
  } catch { /* continue */ }

  // Strategy 2: Use datascript to resolve the property value entity
  try {
    const result = await logseq.DB.datascriptQuery(`
      [:find ?q .
       :in $ ?uuid
       :where
       [?b :block/uuid ?uuid]
       [?b :logseq.property/query ?qid]
       [?qid :block/title ?q]]
    `, `"${uuid}"`);
    if (typeof result === "string" && result.trim()) return result.trim();
  } catch { /* continue */ }

  // Strategy 3: Try getBlockProperties and extract string from any format
  try {
    const props = await logseq.Editor.getBlockProperties(uuid);
    for (const key of ["logseq.property/query", "query"]) {
      const v = props?.[key];
      if (typeof v === "string" && v.trim()) return v.trim();
      // Reference object — try extracting the title/content/name
      if (v && typeof v === "object") {
        const obj = v as Record<string, unknown>;
        const str = (obj.title ?? obj.content ?? obj.name) as string | undefined;
        if (typeof str === "string" && str.trim()) return str.trim();
      }
    }
  } catch { /* continue */ }

  // Strategy 4: Block content fallback (unlikely for query blocks)
  if (typeof block.content === "string" && block.content.trim()) {
    return block.content.trim();
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
