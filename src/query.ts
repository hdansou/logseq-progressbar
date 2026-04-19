export type QueryKind =
  | "dsl"
  | "datalog-map"
  | "datalog-vec"
  | "empty"
  | "unknown";

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
