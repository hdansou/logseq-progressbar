export type QueryKind =
  | "dsl"
  | "datalog-map"
  | "datalog-vec"
  | "empty"
  | "unknown";

export class QueryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryParseError";
  }
}

export function classifyQuery(raw: string): QueryKind {
  const trimmed = raw.trimStart();
  if (trimmed.length === 0) return "empty";
  switch (trimmed[0]) {
    case "(":
      return "dsl";
    case "{":
      return "datalog-map";
    case "[":
      return "datalog-vec";
    default:
      return "unknown";
  }
}

export function extractDatalogVector(raw: string): string {
  const s = raw.trimStart();
  if (!s.startsWith("{")) {
    throw new QueryParseError("expected '{' at start of query map");
  }
  const keyMatch = /:query\s*\[/.exec(s);
  if (!keyMatch) {
    throw new QueryParseError(":query key missing or value is not a vector");
  }
  const start = keyMatch.index + keyMatch[0].length - 1;
  const end = findMatchingBracket(s, start);
  if (end < 0) {
    throw new QueryParseError("unbalanced brackets in :query value");
  }
  return s.slice(start, end + 1);
}

export { parseDSL } from "./scanner";
export type { ParsedDSL } from "./scanner";
import type { ParsedDSL } from "./scanner";

interface DslToBlockQueryOptions {
  trackedProperty: string;
  resolvedTags?: string[];
}

export function dslToBlockQuery(
  parsed: ParsedDSL,
  opts: DslToBlockQueryOptions
): string {
  const { trackedProperty, resolvedTags } = opts;
  if (!trackedProperty) {
    throw new QueryParseError("trackedProperty is required");
  }

  const propertyAttr = `:logseq.property/${trackedProperty}`;
  const where: string[] = [`[?b ${propertyAttr} ?s]`];

  if (parsed.statuses.length === 1) {
    where.push(`[?s :block/title "${parsed.statuses[0]}"]`);
  } else if (parsed.statuses.length > 1) {
    const ors = parsed.statuses
      .map((s) => `[?s :block/title "${s}"]`)
      .join(" ");
    where.push(`(or ${ors})`);
  }

  if (parsed.dateRange) {
    where.push("[?b :block/page ?p]");
    where.push("[?p :block/journal-day ?d]");
    where.push(`[(>= ?d ${parsed.dateRange.start})]`);
    where.push(`[(<= ?d ${parsed.dateRange.end})]`);
  }

  const tags = resolvedTags ?? parsed.tagFilters;
  if (tags.length > 0) {
    where.push("[?b :block/tags ?tag]");
    if (tags.length === 1) {
      where.push(`[?tag :block/title "${tags[0]}"]`);
    } else {
      const ors = tags.map((t) => `[?tag :block/title "${t}"]`).join(" ");
      where.push(`(or ${ors})`);
    }
  }

  parsed.propertyFilters.forEach((pf, i) => {
    const attrName = pf.key.includes("/")
      ? pf.key
      : `logseq.property/${pf.key}`;
    where.push(`[?b :${attrName} ?pv${i}]`);
    where.push(`[?pv${i} :block/title "${pf.value}"]`);
  });

  return `[:find (pull ?b [*])\n :where\n ${where.join("\n ")}]`;
}

export interface BlockData {
  uuid: string;
  tags: string[];
  properties: Record<string, unknown>;
}

export function entityToBlockData(entity: unknown): BlockData | null {
  if (entity === null || typeof entity !== "object") return null;
  const e = entity as Record<string, unknown>;

  const uuid = pickKey(e, "block/uuid");
  if (typeof uuid !== "string" || uuid.length === 0) return null;

  const rawTags = pickKey(e, "block/tags");
  const tags = Array.isArray(rawTags)
    ? rawTags
        .map((t) =>
          t && typeof t === "object"
            ? (pickKey(t as Record<string, unknown>, "block/title") as
                | string
                | undefined)
            : undefined
        )
        .filter((t): t is string => typeof t === "string")
    : [];

  const properties: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(e)) {
    const stripped = key.startsWith(":") ? key.slice(1) : key;
    if (stripped.startsWith("logseq.property/")) {
      properties[stripped] = resolvePropValue(val);
    }
  }

  return { uuid, tags, properties };
}

function resolvePropValue(val: unknown): unknown {
  if (val !== null && typeof val === "object" && !Array.isArray(val)) {
    const title = pickKey(val as Record<string, unknown>, "block/title");
    if (typeof title === "string") return title;
  }
  return val;
}

function pickKey(obj: Record<string, unknown>, name: string): unknown {
  if (name in obj) return obj[name];
  const colonKey = `:${name}`;
  if (colonKey in obj) return obj[colonKey];
  return undefined;
}

function findMatchingBracket(s: string, startIdx: number): number {
  let depth = 0;
  let i = startIdx;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\") i++;
        i++;
      }
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}
