import type { ProgressBarConfig } from "./types";
import {
  lookup as lookupIdents,
  lookupType as lookupIdentType,
  getAllClassProps,
} from "./identCache";

export const DISPLAY_FORMATS = ["percent", "fraction", "both"] as const;
export type DisplayFormat = (typeof DISPLAY_FORMATS)[number];

/** Default configuration — used when no settings or overrides are provided */
export const DEFAULTS: ProgressBarConfig = {
  tags: ["Task", "Checklist"],
  propertyMappings: { Task: "status", Checklist: "check" },
  completeValues: { status: ["Done"] },
  depth: Infinity,
  strict: false,
  displayFormat: "percent",
  barWidth: "full",
  showOnEmpty: false,
};

/** Logseq plugin settings schema for useSettingsSchema */
export const SETTINGS_SCHEMA = [
  {
    key: "heading_tags",
    type: "heading" as const,
    default: "",
    title: "Tag & Property Configuration",
    description: "",
  },
  {
    key: "tagsInScope",
    type: "string" as const,
    default: "Task, Checklist",
    title: "Tags in Scope",
    description: "Comma-separated tag names to track (e.g., `Task, Bug, Checklist`)",
  },
  {
    key: "propertyMappings",
    type: "string" as const,
    default: '{"Task": "status", "Checklist": "check"}',
    title: "Tag → Property Mappings (JSON)",
    description:
      'Map each tag to the property used for progress. Checkbox-typed properties self-bucket (`true` → Done, `false` → Todo). Example: `{"Task": "status", "Checklist": "check"}`',
    inputAs: "textarea" as const,
  },
  {
    key: "completeValues",
    type: "string" as const,
    default: '{"status": ["Done"]}',
    title: "Complete Values (JSON)",
    description:
      'Map each property to values that count as "complete". Example: `{"status": ["Done", "Canceled"], "state": ["Completed"]}`',
    inputAs: "textarea" as const,
  },
  {
    key: "heading_display",
    type: "heading" as const,
    default: "",
    title: "Display Settings",
    description: "",
  },
  {
    key: "defaultDepth",
    type: "string" as const,
    default: "all",
    title: "Default Scan Depth",
    description: '`all` for unlimited, or a number like `1` (direct children only), `2`, etc.',
  },
  {
    key: "strictTagFilter",
    type: "boolean" as const,
    default: false,
    title: "Strict Tag Filtering",
    description: "Only count blocks that have a matching tag. Untagged blocks are excluded.",
  },
  {
    key: "displayFormat",
    type: "enum" as const,
    enumChoices: [...DISPLAY_FORMATS],
    enumPicker: "select" as const,
    default: "percent",
    title: "Display Format",
    description: "How to show completion: `54%`, `7/13`, or `7/13 · 54%`",
  },
  {
    key: "barWidth",
    type: "enum" as const,
    enumChoices: ["full", "compact"],
    enumPicker: "select" as const,
    default: "full",
    title: "Bar Width",
    description: "`full` = 100% of block width, `compact` = inline fixed width",
  },
  {
    key: "showOnEmpty",
    type: "boolean" as const,
    default: false,
    title: "Show on Empty",
    description: "Show an empty 0% bar when no matching blocks are found.",
  },
  {
    key: "heading_colors",
    type: "heading" as const,
    default: "",
    title: "Color Overrides",
    description: "",
  },
  {
    key: "colorOverrides",
    type: "string" as const,
    default: "{}",
    title: "Color Overrides (JSON)",
    description:
      'Override segment colors per status. Example: `{"Done": {"light": "#22c55e", "dark": "#16a34a"}}`',
    inputAs: "textarea" as const,
  },
  {
    key: "debug",
    type: "boolean" as const,
    default: false,
    title: "Debug logging",
    description: "Log scan and render details to the plugin console.",
  },
];

/**
 * Build the global config from the raw `logseq.settings` record, falling
 * back to DEFAULTS field by field. Every value is coerced defensively: the
 * settings file can carry stale or hand-edited values from older versions.
 */
export function readGlobalConfig(raw: Record<string, unknown>): ProgressBarConfig {
  const tags =
    typeof raw.tagsInScope === "string" && raw.tagsInScope.trim()
      ? raw.tagsInScope.split(",").map((t) => t.trim()).filter(Boolean)
      : DEFAULTS.tags;

  const propertyMappings =
    parseJsonRecord(raw.propertyMappings, isNonEmptyString) ?? DEFAULTS.propertyMappings;
  const completeValues =
    parseJsonRecord(raw.completeValues, isStringArray) ?? DEFAULTS.completeValues;

  const { resolvedIdents, propertyTypes, tagClassProps } = snapshotIdentCache(
    Object.values(propertyMappings)
  );

  return {
    tags,
    propertyMappings,
    completeValues,
    depth: parseDepth(raw.defaultDepth),
    strict: parseBoolean(raw.strictTagFilter, DEFAULTS.strict),
    displayFormat: parseDisplayFormat(raw.displayFormat) ?? DEFAULTS.displayFormat,
    barWidth: typeof raw.barWidth === "string" && raw.barWidth.trim() ? raw.barWidth.trim() : DEFAULTS.barWidth,
    showOnEmpty: parseBoolean(raw.showOnEmpty, DEFAULTS.showOnEmpty),
    resolvedIdents,
    propertyTypes,
    tagClassProps,
  };
}

/** `all`, empty, non-numeric or ≤ 0 → unlimited; otherwise the integer. */
export function parseDepth(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value >= 1 ? Math.floor(value) : Infinity;
  if (typeof value !== "string") return Infinity;
  const n = parseInt(value.trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : Infinity;
}

export function parseDisplayFormat(value: unknown): DisplayFormat | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (DISPLAY_FORMATS as readonly string[]).includes(v) ? (v as DisplayFormat) : null;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Parse a JSON object setting, keeping only entries whose value passes
 * `isValue`. Returns null when the input is not a JSON object at all, so
 * the caller can fall back to its default.
 */
function parseJsonRecord<T>(
  value: unknown,
  isValue: (v: unknown) => v is T
): Record<string, T> | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.trim() && isValue(v)) out[k.trim()] = v;
  }
  return out;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Snapshot ident-cache state for the supplied property names.
 *
 *   - `resolvedIdents`: short name → :db/ident[] for the in-scope properties.
 *   - `propertyTypes` : short name → property type (e.g. "checkbox").
 *   - `tagClassProps` : every tag known to the cache → its class-property
 *                       ident list (NOT filtered by `tagsInScope` — blocks
 *                       can carry out-of-scope tags that still imply an
 *                       inherited default we want to count).
 */
function snapshotIdentCache(propertyNames: string[]): {
  resolvedIdents: Record<string, string[]>;
  propertyTypes: Record<string, string>;
  tagClassProps: Record<string, string[]>;
} {
  const resolvedIdents: Record<string, string[]> = {};
  const propertyTypes: Record<string, string> = {};
  for (const shortName of new Set(propertyNames)) {
    const idents = lookupIdents(shortName);
    if (idents.length === 0) continue;
    resolvedIdents[shortName] = idents;
    // First resolved ident wins for type — all idents sharing a friendly
    // name in the same graph should agree on type anyway.
    for (const ident of idents) {
      const t = lookupIdentType(ident);
      if (t) {
        propertyTypes[shortName] = t;
        break;
      }
    }
  }

  return { resolvedIdents, propertyTypes, tagClassProps: getAllClassProps() };
}

/**
 * Merge global config with per-instance renderer overrides.
 * Per-instance values take precedence.
 */
export function resolveConfig(
  global: ProgressBarConfig,
  overrides: Record<string, unknown>
): ProgressBarConfig {
  const config = { ...global };

  if (overrides.tags) config.tags = overrides.tags as string[];
  if (overrides.depth !== undefined) config.depth = overrides.depth as number;
  if (overrides.strict !== undefined) config.strict = overrides.strict as boolean;
  if (overrides.displayFormat) config.displayFormat = overrides.displayFormat as DisplayFormat;
  if (overrides.barWidth) config.barWidth = overrides.barWidth as string;
  if (overrides.showOnEmpty !== undefined) config.showOnEmpty = overrides.showOnEmpty as boolean;
  if (overrides.queryUUID) config.queryUUID = overrides.queryUUID as string;

  // Handle _property override: apply to all tags in scope
  if (overrides._property) {
    const prop = overrides._property as string;
    config.propertyMappings = {};
    for (const tag of config.tags) {
      config.propertyMappings[tag] = prop;
    }
    // Re-snapshot the ident cache for the newly-introduced property name.
    const idents = lookupIdents(prop);
    if (idents.length > 0) {
      config.resolvedIdents = { ...(config.resolvedIdents ?? {}), [prop]: idents };
      const t = lookupIdentType(idents[0]);
      if (t) {
        config.propertyTypes = { ...(config.propertyTypes ?? {}), [prop]: t };
      }
    }
  }

  // Handle _complete override: apply to all properties in scope
  if (overrides._complete) {
    const vals = overrides._complete as string[];
    config.completeValues = {};
    const properties = new Set(Object.values(config.propertyMappings));
    for (const prop of properties) {
      config.completeValues[prop] = vals;
    }
  }

  return config;
}
