import type { SdkPort } from "./sdk";
import type { ProgressBarConfig, StatusCounts, StatusColor } from "./types";
import { parseRendererArgs } from "./parser";
import { readGlobalConfig, resolveConfig } from "./settings";
import { countQueryStatuses, filterByTags, scanChildren } from "./scanner";
import { aggregate } from "./aggregator";
import { buildSegments, parseColorOverrides, type ThemeMode } from "./colors";
import { renderBar, renderEmpty } from "./renderer";

export interface RenderInstance {
  config: ProgressBarConfig;
  colorOverrides: Record<string, StatusColor>;
}

/** Global settings + renderer args → the config for one bar. */
export function resolveInstance(rawSettings: Record<string, unknown>, args: string[]): RenderInstance {
  const config = resolveConfig(readGlobalConfig(rawSettings), parseRendererArgs(args));
  return { config, colorOverrides: parseColorOverrides(rawSettings.colorOverrides) };
}

/**
 * Query mode first (explicit `query: <uuid>` or the block's own
 * `:logseq.property/query`), children mode when the block has no query.
 */
export async function computeStats(
  sdk: SdkPort,
  blockUuid: string,
  config: ProgressBarConfig
): Promise<StatusCounts> {
  const fromQuery = await countQueryStatuses(sdk, config.queryUUID ?? blockUuid, config);
  if (fromQuery) return fromQuery;
  const blocks = filterByTags(await scanChildren(sdk, blockUuid, config), config);
  return aggregate(blocks, config);
}

/** Stats → HTML for `provideUI` ("" means "render nothing"). */
export function renderTemplate(
  stats: StatusCounts,
  config: ProgressBarConfig,
  theme: ThemeMode,
  colorOverrides: Record<string, StatusColor>,
  instanceId: string
): string {
  if (stats.total === 0) {
    return config.showOnEmpty ? renderEmpty("No matching items", instanceId, config.barWidth) : "";
  }
  const segments = buildSegments(stats.counts, stats.total, config.completeValues, theme, colorOverrides);
  return renderBar(segments, stats, config, instanceId);
}
