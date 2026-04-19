import type { ProgressBarConfig, StatusCounts } from "./types";
import { aggregate } from "./aggregator";
import {
  classifyQuery,
  dslToBlockQuery,
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
        datalog = extractDatalogVector(raw);
        break;
      case "datalog-vec":
        datalog = raw.trim();
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
  try {
    const pulled = await logseq.DB.datascriptQuery(`
      [:find (pull ?b [*]) .
       :where
       [?b :block/uuid #uuid "${uuid}"]]
    `);
    if (pulled) {
      const raw = findQueryStringInEntity(pulled);
      if (raw) return raw;
    }
  } catch (e) {
    console.log("[progress-bar] pull entity error:", e);
  }

  try {
    const result = await logseq.DB.datascriptQuery(`
      [:find ?q .
       :where
       [?b :block/uuid #uuid "${uuid}"]
       [?b :logseq.property/query ?qid]
       [?qid :block/title ?q]]
    `);
    if (typeof result === "string" && isQueryOpener(result.trim()[0])) {
      return result.trim();
    }
  } catch (e) {
    console.log("[progress-bar] datascript resolve error:", e);
  }

  try {
    const block = await logseq.Editor.getBlock(uuid);
    if (block) {
      const raw = findQueryStringInEntity(block as any);
      if (raw) return raw;
      if ((block as any).properties) {
        const raw2 = findQueryStringInEntity((block as any).properties);
        if (raw2) return raw2;
      }
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

/** Walk an entity looking for a string that opens with (, {, or [. */
function findQueryStringInEntity(obj: Record<string, unknown>): string | null {
  for (const val of Object.values(obj)) {
    const hit = asQueryString(val);
    if (hit) return hit;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const nv of Object.values(val as Record<string, unknown>)) {
        const nested = asQueryString(nv);
        if (nested) return nested;
      }
    }
  }
  return null;
}

function asQueryString(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return isQueryOpener(trimmed[0]) ? trimmed : null;
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
