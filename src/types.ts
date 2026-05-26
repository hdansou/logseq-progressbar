/** Resolved configuration for a single progress bar instance */
export interface ProgressBarConfig {
  tags: string[];
  propertyMappings: Record<string, string>; // tag -> property name
  completeValues: Record<string, string[]>; // property -> values that count as complete
  depth: number; // Infinity = all descendants
  strict: boolean; // strict tag filtering
  displayFormat: "percent" | "fraction" | "both";
  barWidth: string; // "full" | "compact" | "200px" etc.
  showOnEmpty: boolean;
  queryUUID?: string; // if tracking a query's results
  // Short property name -> list of fully-qualified :db/ident strings that
  // map to it in the current graph (e.g. "check" -> [":user.property/check-pgUd_nnQ"]).
  // Populated at plugin init from identCache; undefined falls back to regex.
  resolvedIdents?: Record<string, string[]>;
  // Property type per short name (e.g. "check" -> "checkbox"). Used by the
  // aggregator to default unset checkbox class-properties to false.
  propertyTypes?: Record<string, string>;
  // Tag title (lowercased) -> set of :db/idents declared as class-properties.
  // Lets the aggregator know which tags imply which inherited-default props.
  tagClassProps?: Record<string, string[]>;
}

/** Aggregated status counts from scanned blocks */
export interface StatusCounts {
  counts: Record<string, number>; // status value -> count
  total: number;
  completed: number;
  percent: number;
}

/** Color entry for a status value */
export interface StatusColor {
  light: string;
  dark: string;
}

/** A segment in the progress bar */
export interface BarSegment {
  label: string;
  count: number;
  percent: number;
  color: string;
  isComplete: boolean;
}
