import type { ProgressBarConfig, StatusCounts } from "./types";
import { aggregate } from "./aggregator";
import {
  classifyQuery,
  dslToBlockQuery,
  enrichPull,
  entityToBlockData,
  extractDatalogVector,
  parseDSL,
  QueryParseError,
  type BlockData,
} from "./query";

// ─── Query mode: unified DSL + custom datascript pipeline ─────────────

/**
 * Count blocks from a query block by grouping on the tracked property.
 *
 * One pipeline for every query shape:
 *   UUID → resolveQueryRaw → classify → toBlockDatalog → datascriptQuery
 *        → entityToBlockData[] → aggregate → StatusCounts
 */
export async function countQueryStatuses(
  queryUUID: string,
  config: ProgressBarConfig
): Promise<StatusCounts> {
  const raw = await resolveQueryRaw(queryUUID);
  if (!raw) return emptyStatusCounts();

  const kind = classifyQuery(raw);
  const trackedProperty =
    Object.values(config.propertyMappings)[0] || "status";

  let datalog: string;
  try {
    switch (kind) {
      case "dsl": {
        const parsed = parseDSL(raw);
        datalog = dslToBlockQuery(parsed, {
          trackedProperty,
          resolvedTags: await resolveUUIDRefs(parsed.tagFilters),
        });
        break;
      }
      case "datalog-map":
        datalog = enrichPull(extractDatalogVector(raw), trackedProperty);
        break;
      case "datalog-vec":
        datalog = enrichPull(raw.trim(), trackedProperty);
        break;
      default:
        return emptyStatusCounts();
    }
  } catch (e) {
    if (e instanceof QueryParseError) {
      console.warn("[progress-bar] query parse error:", e.message);
      return emptyStatusCounts();
    }
    throw e;
  }

  try {
    const rows = await logseq.DB.datascriptQuery(datalog);
    const blocks = rowsToBlocks(rows);
    return aggregate(blocks, config);
  } catch (e) {
    console.error("[progress-bar] datascript query failed:", e);
    return emptyStatusCounts();
  }
}

/** Unwrap [[<entity>], …] pull-row shape into BlockData[]. */
function rowsToBlocks(rows: unknown): BlockData[] {
  if (!Array.isArray(rows)) return [];
  const out: BlockData[] = [];
  for (const row of rows) {
    const entity = Array.isArray(row) ? row[0] : row;
    const bd = entityToBlockData(entity);
    if (bd) out.push(bd);
  }
  return out;
}

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
    resolved.push(ref);
  }
  return resolved;
}

function emptyStatusCounts(): StatusCounts {
  return { counts: {}, total: 0, completed: 0, percent: 0 };
}

// ─── Children/page mode: block scanning ───────────────────────────────

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
  return blocks;
}

// ─── Raw-query resolution (shared) ────────────────────────────────────

/**
 * Resolve the raw query string from a query block.
 *
 * In DB graphs, `:logseq.property/query` is a reference whose `:block/title`
 * is the query string (either DSL like `(task "Done")` or datalog like
 * `{:query [:find …]}` / `[:find …]`). Three resolution strategies in case
 * any one path is flaky in a given build.
 */
async function resolveQueryRaw(uuid: string): Promise<string | null> {
  // Strategy 1: resolve :logseq.property/query → :block/title directly.
  // This is the only shape Logseq DB uses for query blocks, so it's
  // unambiguous — we can't accidentally grab the block's own title.
  try {
    const result = await logseq.DB.datascriptQuery(`
      [:find ?q .
       :where
       [?b :block/uuid #uuid "${uuid}"]
       [?b :logseq.property/query ?qid]
       [?qid :block/title ?q]]
    `);
    if (typeof result === "string") {
      const trimmed = result.trim();
      if (isQueryOpener(trimmed[0])) return trimmed;
    }
  } catch (e) {
    console.log("[progress-bar] datascript resolve error:", e);
  }

  // Strategy 2: fall back to getBlock and inspect the query property.
  // Needed for environments where datascript pulls fail but the SDK API works.
  try {
    const block = await logseq.Editor.getBlock(uuid);
    const qRef = (block as any)?.["logseq.property/query"] ??
      (block as any)?.properties?.["logseq.property/query"] ??
      (block as any)?.properties?.query;
    const title = typeof qRef === "string"
      ? qRef
      : qRef?.["block/title"] ?? qRef?.[":block/title"] ?? qRef?.title;
    if (typeof title === "string") {
      const trimmed = title.trim();
      if (isQueryOpener(trimmed[0])) return trimmed;
    }
  } catch (e) {
    console.log("[progress-bar] getBlock error:", e);
  }

  console.warn("[progress-bar] Could not resolve query for block:", uuid);
  return null;
}

function isQueryOpener(ch: string | undefined): boolean {
  return ch === "(" || ch === "{" || ch === "[";
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
