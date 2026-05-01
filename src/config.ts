import type { ProgressBarConfig } from "./types";

/** Default configuration — used when no settings or overrides are provided */
export const DEFAULTS: ProgressBarConfig = {
  tags: ["Task"],
  propertyMappings: { Task: "status" },
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
    default: "Task",
    title: "Tags in Scope",
    description: "Comma-separated tag names to track (e.g., `Task, Bug, Project`)",
  },
  {
    key: "propertyMappings",
    type: "string" as const,
    default: '{"Task": "status"}',
    title: "Tag → Property Mappings (JSON)",
    description:
      'Map each tag to the property used for progress. Example: `{"Task": "status", "Project": "state"}`',
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
    enumChoices: ["percent", "fraction", "both"],
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
    key: "autoDetect",
    type: "boolean" as const,
    default: true,
    title: "Auto-Detect Mode",
    description: "Automatically show progress bars on blocks with tagged children.",
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
];

/**
 * Raw `logseq.settings` accessor. Centralized so we have exactly one
 * `as unknown` cast in the codebase.
 */
export function getRawSettings(): Record<string, unknown> {
  return ((logseq as unknown as { settings?: Record<string, unknown> })
    .settings) ?? {};
}

/**
 * Read global config from logseq.settings, falling back to DEFAULTS.
 */
export function readGlobalConfig(): ProgressBarConfig {
  const s = getRawSettings();

  const tags = s.tagsInScope
    ? String(s.tagsInScope).split(",").map((t: string) => t.trim()).filter(Boolean)
    : DEFAULTS.tags;

  const propertyMappings = safeParseJSON(s.propertyMappings, DEFAULTS.propertyMappings);
  const completeValues = safeParseJSON(s.completeValues, DEFAULTS.completeValues);
  const depthStr = String(s.defaultDepth ?? "all").toLowerCase();
  const depth = depthStr === "all" ? Infinity : parseInt(depthStr, 10) || Infinity;

  return {
    tags,
    propertyMappings,
    completeValues,
    depth,
    strict: (s.strictTagFilter as boolean | undefined) ?? DEFAULTS.strict,
    displayFormat:
      (s.displayFormat as ProgressBarConfig["displayFormat"] | undefined) ??
      DEFAULTS.displayFormat,
    barWidth: (s.barWidth as string | undefined) ?? DEFAULTS.barWidth,
    showOnEmpty:
      (s.showOnEmpty as boolean | undefined) ?? DEFAULTS.showOnEmpty,
  };
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
  if (overrides.displayFormat) config.displayFormat = overrides.displayFormat as ProgressBarConfig["displayFormat"];
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

function safeParseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
