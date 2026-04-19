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
