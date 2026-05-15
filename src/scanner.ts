import type { ProgressBarConfig, StatusCounts } from "./types";
import { aggregate } from "./aggregator";
import { debug } from "./debug";
import {
  classifyQuery,
  dslToBlockQuery,
  enrichPull,
  entityToBlockData,
  extractDatalogVector,
  parseDSL,
  QueryParseError,
  rewriteCompiledDsl,
  type BlockData,
} from "./query";

// ─── Query mode: unified DSL + custom datascript pipeline ─────────────

/**
 * Count blocks from a query block by grouping on the tracked property.
 *
 * One pipeline for every query shape:
 *   UUID → resolveQueryRaw → classify → toBlockDatalog → datascriptQuery
 *        → entityToBlockData[] → aggregate → StatusCounts
 *
 * Returns `null` when the block has no `:logseq.property/query` at all so
 * the caller can fall back to children-mode scanning. Other failure paths
 * (parse errors, runtime errors) return `emptyStatusCounts()`.
 */
export async function countQueryStatuses(
  queryUUID: string,
  config: ProgressBarConfig
): Promise<StatusCounts | null> {
  const raw = await resolveQueryRaw(queryUUID);
  if (!raw) return null;

  const kind = classifyQuery(raw);
  const trackedProperty =
    Object.values(config.propertyMappings)[0] || "status";

  let datalog: string;
  try {
    if (kind === "dsl") {
      datalog = await buildDslDatalog(raw, trackedProperty);
    } else if (kind === "datalog-map" || kind === "datalog-vec") {
      const vec = kind === "datalog-map" ? extractDatalogVector(raw) : raw.trim();
      const rewritten = rewriteCompiledDsl(vec);
      datalog = rewritten
        ? await buildDslDatalog(rewritten, trackedProperty)
        : enrichPull(vec, trackedProperty);
    } else {
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
    console.error(
      "[progress-bar] datascript query failed:",
      e,
      "\n  queryUUID:",
      queryUUID,
      "\n  datalog:",
      datalog
    );
    return emptyStatusCounts();
  }
}

/** Build a block-pull datalog from a DSL string. Shared by `dsl` and the
 * compiled-DSL rewrite path so both routes land on the same generator. */
async function buildDslDatalog(
  dsl: string,
  trackedProperty: string
): Promise<string> {
  const parsed = parseDSL(dsl);
  return dslToBlockQuery(parsed, {
    trackedProperty,
    resolvedTags: await resolveUUIDRefs(parsed.tagFilters),
  });
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
    debug("datascript resolve error:", e);
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
    debug("getBlock error:", e);
  }

  debug("Could not resolve query for block:", uuid);
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
  const props = (await logseq.Editor.getBlockProperties(block.uuid)) ?? {};
  return {
    uuid: block.uuid,
    tags: extractTagNames(props as Record<string, unknown>, block),
    properties: props,
  };
}

/**
 * Pull tag titles out of an already-fetched properties record. DB graphs
 * key tags as `":block/tags"` (colon-prefixed) with plain string values;
 * legacy shapes use other keys or entity objects. Pure / synchronous so
 * `toBlockData` doesn't re-hit the SDK per block.
 */
function extractTagNames(
  props: Record<string, unknown>,
  block: { tags?: unknown }
): string[] {
  const raw =
    props[":block/tags"] ??
    props["block/tags"] ??
    props.tags ??
    block.tags ??
    [];
  if (!Array.isArray(raw)) return [];
  return raw.map(tagToTitle).filter((s): s is string => s.length > 0);
}

function tagToTitle(t: unknown): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    return (
      (o["block/title"] as string | undefined) ??
      (o[":block/title"] as string | undefined) ??
      (o.title as string | undefined) ??
      (o.name as string | undefined) ??
      (o.content as string | undefined) ??
      ""
    );
  }
  return "";
}
