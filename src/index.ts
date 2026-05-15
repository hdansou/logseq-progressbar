import "@logseq/libs";
import { parseRendererArgs } from "./parser";
import {
  getRawSettings,
  readGlobalConfig,
  resolveConfig,
  SETTINGS_SCHEMA,
} from "./config";
import { scanChildren, countQueryStatuses, filterByTags } from "./scanner";
import { aggregate } from "./aggregator";
import { debug } from "./debug";
import type { StatusCounts } from "./types";
import { buildSegments, parseColorOverrides } from "./colors";
import { renderBar, renderEmpty, PLUGIN_CSS } from "./renderer";

async function main() {
  debug("plugin loaded");

  const offHooks: Array<() => void> = [];
  let themeMode: "light" | "dark" = "dark";

  // --- Settings ---
  logseq.useSettingsSchema(SETTINGS_SCHEMA as Parameters<typeof logseq.useSettingsSchema>[0]);

  // --- CSS ---
  logseq.provideStyle(PLUGIN_CSS);

  // --- Theme Detection ---
  try {
    const configs = await logseq.App.getUserConfigs();
    if (configs?.preferredThemeMode) {
      themeMode = configs.preferredThemeMode as "light" | "dark";
    }
  } catch {
    // default to dark
  }

  const offTheme = logseq.App.onThemeModeChanged(({ mode }) => {
    themeMode = mode as "light" | "dark";
    // Re-render all active bars with new colors
    rerenderAll();
  });
  if (typeof offTheme === "function") offHooks.push(offTheme);

  // --- Track active renderer slots for re-rendering ---
  const activeRenderers = new Map<
    string,
    { slot: string; args: string[]; uuid: string }
  >();

  // --- Core render function ---
  async function renderProgressBar(
    slot: string,
    args: string[],
    blockUuid: string
  ) {
    // Slot-scoped key — Logseq query-class blocks render the same block title
    // through multiple slot instances; a block-scoped key would cause the bar
    // to appear in each slot and look doubled.
    const instanceId = `pb-${slot}`;

    // Guarded provideUI — skips the call if the slot has been unmounted
    // during our async work. Without this, Logseq logs a "can not resolve
    // selector target" warning per stale slot.
    const safeProvideUI = async (template: string) => {
      if (await logseq.UI.checkSlotValid(slot)) {
        logseq.provideUI({ key: instanceId, slot, template });
      } else {
        activeRenderers.delete(`${slot}-${blockUuid}`);
      }
    };

    try {
      const globalConfig = readGlobalConfig();
      const overrides = parseRendererArgs(args);
      const config = resolveConfig(globalConfig, overrides);
      debug("resolved config:", config);
      const colorOverrides = parseColorOverrides(
        getRawSettings().colorOverrides
      );

      // Try query mode (explicit `query: <uuid>` param OR block has :logseq.property/query).
      // countQueryStatuses returns null when the block has no query property at all,
      // which is our signal to fall back to children-mode scanning.
      let stats: StatusCounts | null = await countQueryStatuses(
        config.queryUUID ?? blockUuid,
        config
      );
      if (stats === null) {
        let blocks = await scanChildren(blockUuid, config);
        blocks = filterByTags(blocks, config);
        stats = aggregate(blocks, config);
      }
      debug("stats:", stats);

      // Handle empty state
      if (stats.total === 0) {
        await safeProvideUI(
          config.showOnEmpty ? renderEmpty("No matching items", instanceId) : ""
        );
        return;
      }

      // Build segments and render
      const segments = buildSegments(
        stats.counts,
        stats.total,
        config.completeValues,
        themeMode,
        colorOverrides
      );

      await safeProvideUI(renderBar(segments, stats, config, instanceId));
    } catch (err) {
      console.error("Progress Bar render error:", err);
      const message = err instanceof Error ? err.message : String(err);
      await safeProvideUI(
        `<div class="pb-error">${escapeHtml(message)}</div>`
      );
    }
  }

  // --- Re-render all active bars (on theme change, settings change, DB change) ---
  async function rerenderAll() {
    for (const [key, { slot, args, uuid }] of activeRenderers.entries()) {
      const valid = await logseq.UI.checkSlotValid(slot);
      if (valid) {
        await renderProgressBar(slot, args, uuid);
      } else {
        activeRenderers.delete(key);
      }
    }
  }

  // --- Macro Renderer ---
  logseq.App.onMacroRendererSlotted(async ({ slot, payload }) => {
    const args = payload.arguments;
    const type = args[0]?.trim();
    debug("onMacroRendererSlotted:", { type, args, uuid: payload.uuid });

    if (type !== ":progress-bar") return;

    const blockUuid = payload.uuid;
    const key = `${slot}-${blockUuid}`;

    // Track for re-rendering
    activeRenderers.set(key, {
      slot,
      args,
      uuid: blockUuid,
    });

    await renderProgressBar(slot, args, blockUuid);
  });

  // --- Slash Command ---
  logseq.Editor.registerSlashCommand("progress-bar", async () => {
    try {
      await logseq.Editor.insertAtEditingCursor("{{renderer :progress-bar}}");
    } catch (err) {
      console.error("Progress Bar: Failed to insert", err);
      await logseq.UI.showMsg("Failed to insert progress bar", "error");
    }
  });

  // --- Real-Time Updates via DB.onChanged ---
  const offChanged = logseq.DB.onChanged(async () => {
    if (activeRenderers.size > 0) {
      await rerenderAll();
    }
  });
  if (typeof offChanged === "function") offHooks.push(offChanged);

  // --- Settings Change ---
  logseq.onSettingsChanged(async () => {
    await rerenderAll();
  });

  // --- Cleanup ---
  logseq.beforeunload(async () => {
    offHooks.forEach((off) => off());
    offHooks.length = 0;
    activeRenderers.clear();
  });

  debug("plugin ready");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

logseq.ready(main).catch(console.error);
