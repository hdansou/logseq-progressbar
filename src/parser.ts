import type { ProgressBarConfig } from "./types";
import { parseDepth, parseDisplayFormat } from "./settings";

export type RendererOverrides = Partial<ProgressBarConfig> & {
  _property?: string;
  _complete?: string[];
};

/**
 * Parse pipe-delimited values: "Task|Bug|Feature" -> ["Task", "Bug", "Feature"]
 */
export function parsePipeList(value: string): string[] {
  return value.split("|").map((v) => v.trim()).filter(Boolean);
}

/**
 * Parse renderer macro arguments into a partial config.
 *
 * Input: the `payload.arguments` array from onMacroRendererSlotted.
 * Arguments[0] is the renderer type (":progress-bar"), rest are "key: value" pairs.
 *
 * Example args: [":progress-bar", "tags: Task|Bug", "property: status", "depth: 2"]
 */
export function parseRendererArgs(args: string[]): RendererOverrides {
  const result: RendererOverrides = {};

  // Skip first arg (renderer type ":progress-bar")
  for (let i = 1; i < args.length; i++) {
    const arg = args[i].trim();
    const colonIdx = arg.indexOf(":");
    if (colonIdx === -1) continue;

    const key = arg.slice(0, colonIdx).trim().toLowerCase();
    const value = arg.slice(colonIdx + 1).trim();
    if (!value) continue;

    switch (key) {
      case "tags":
        result.tags = parsePipeList(value);
        break;
      case "property":
        // Store raw — config resolver maps to propertyMappings
        result._property = value;
        break;
      case "complete":
        // Store raw — config resolver maps to completeValues
        result._complete = parsePipeList(value);
        break;
      case "depth":
        result.depth = parseDepth(value);
        break;
      case "strict":
        result.strict = value.toLowerCase() === "true";
        break;
      case "format": {
        const format = parseDisplayFormat(value);
        if (format) result.displayFormat = format;
        break;
      }
      case "width":
        result.barWidth = value;
        break;
      case "query":
        result.queryUUID = value;
        break;
    }
  }

  return result;
}
