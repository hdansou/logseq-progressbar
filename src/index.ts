import "@logseq/libs";
import { parseRendererArgs } from "./parser";
import { readGlobalConfig, resolveConfig, SETTINGS_SCHEMA } from "./config";
import { scanChildren, countQueryStatuses, filterByTags } from "./scanner";
import { aggregate } from "./aggregator";
import type { StatusCounts } from "./types";
import { buildSegments, parseColorOverrides } from "./colors";
import { renderBar, renderEmpty, PLUGIN_CSS } from "./renderer";

async function main() {
  console.log("Progress Bar plugin loaded!");

  const offHooks: Array<() => void> = [];
  let themeMode: "light" | "dark" = "dark";

  // --- Settings ---
  logseq.useSettingsSchema(SETTINGS_SCHEMA as any);

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
    const instanceId = `pb-${blockUuid}`;

    try {
      const globalConfig = readGlobalConfig();
      const overrides = parseRendererArgs(args);
      const config = resolveConfig(globalConfig, overrides);
      console.log("[progress-bar] resolved config:", JSON.stringify(config, (_, v) => v === Infinity ? "Infinity" : v));
      const colorOverrides = parseColorOverrides(
        (logseq as any).settings?.colorOverrides
      );

      // Auto-detect query block: if the block has :logseq.property/query, treat as query
      if (!config.queryUUID) {
        try {
          const entity = await logseq.DB.datascriptQuery(`
            [:find (pull ?b [:logseq.property/query]) .
             :where [?b :block/uuid #uuid "${blockUuid}"]]
          `);
          if (entity?.[":logseq.property/query"]) {
            config.queryUUID = blockUuid;
            console.log("[progress-bar] auto-detected query block:", blockUuid);
          }
        } catch {
          // not a query block, continue with children scan
        }
      }

      // Determine scan mode and get status counts
      let stats: StatusCounts;
      if (config.queryUUID) {
        // Query mode: count statuses directly via datascript
        stats = await countQueryStatuses(config.queryUUID, config);
      } else {
        // Children mode: scan blocks, filter, aggregate
        let blocks = await scanChildren(blockUuid, config);
        blocks = filterByTags(blocks, config);
        stats = aggregate(blocks, config);
      }
      console.log("[progress-bar] stats:", JSON.stringify(stats));

      // Handle empty state
      if (stats.total === 0) {
        if (config.showOnEmpty) {
          logseq.provideUI({
            key: instanceId,
            slot,
            template: renderEmpty("No matching items", instanceId),
          });
        } else {
          logseq.provideUI({
            key: instanceId,
            slot,
            template: "",
          });
        }
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

      const html = renderBar(segments, stats, config, instanceId);
      logseq.provideUI({ key: instanceId, slot, template: html });
    } catch (err: any) {
      console.error("Progress Bar render error:", err);
      logseq.provideUI({
        key: instanceId,
        slot,
        template: `<div class="pb-error">${escapeHtml(err.message)}</div>`,
      });
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
    console.log("[progress-bar] onMacroRendererSlotted:", { type, args, uuid: payload.uuid });

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

  console.log("Progress Bar plugin ready!");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

logseq.ready(main).catch(console.error);
