import "@logseq/libs";
import type { SdkPort } from "./sdk";
import type { ThemeMode } from "./colors";
import { SETTINGS_SCHEMA, readGlobalConfig } from "./settings";
import { computeStats, renderTemplate, resolveInstance } from "./progress";
import { PLUGIN_CSS, renderError } from "./renderer";
import { createSlotRegistry, type SlotEntry } from "./slots";
import { debug, setDebug } from "./debug";
import * as identCache from "./identCache";

/**
 * Thin SDK adapter — the only module that imports `@logseq/libs`.
 * Everything that can be tested without a host lives in the pure modules;
 * this file only wires hooks, owns the debounce timer and publishes HTML.
 */
const LOG = "[progress-bar]";
const sdk: SdkPort = {
  datascriptQuery: (q) => logseq.DB.datascriptQuery(q),
  getBlock: (uuid, opts) => logseq.Editor.getBlock(uuid, opts),
  getBlockProperties: (uuid) => logseq.Editor.getBlockProperties(uuid),
  getPageBlocksTree: (name) => logseq.Editor.getPageBlocksTree(name),
};
const slots = createSlotRegistry();
const offHooks: Array<() => void> = [];
let themeMode: ThemeMode = "dark";
let rerenderTimer: ReturnType<typeof setTimeout> | undefined;

function rawSettings(): Record<string, unknown> {
  return (logseq.settings ?? {}) as Record<string, unknown>;
}

/** Render one slot; publish only if no newer render of the same slot has started. */
async function render(entry: SlotEntry): Promise<void> {
  const generation = slots.begin(entry.slot);
  // Slot-scoped key: Logseq renders a query block's title through several
  // slot instances, and a block-scoped key would show the bar in each.
  const instanceId = `pb-${entry.slot}`;

  // Guarded provideUI (AGENTS.md): the slot can unmount during our async DB
  // work; publishing then only produces "can not resolve selector" noise.
  const safeProvideUI = async (template: string) => {
    if (!slots.isCurrent(entry.slot, generation)) return;
    if (await logseq.UI.checkSlotValid(entry.slot)) {
      logseq.provideUI({ key: instanceId, slot: entry.slot, template });
    } else {
      slots.forget(entry.slot);
    }
  };

  try {
    const { config, colorOverrides } = resolveInstance(rawSettings(), entry.args);
    debug("render", entry.slot, config);
    const stats = await computeStats(sdk, entry.uuid, config);
    debug("stats", entry.slot, stats);
    await safeProvideUI(renderTemplate(stats, config, themeMode, colorOverrides, instanceId));
  } catch (err) {
    console.error(`${LOG} render error:`, err);
    await safeProvideUI(renderError(err instanceof Error ? err.message : String(err), instanceId));
  }
}

async function rerenderAll(): Promise<void> {
  for (const entry of slots.entries()) await render(entry);
}

/** Coalesce bursts of DB / settings / theme events into one re-render pass. */
function scheduleRerender(delay: number): void {
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    if (slots.size > 0) void rerenderAll();
  }, delay);
}

/** Resolve user-property idents for the configured short names (one DB query). */
async function refreshIdentCache(): Promise<void> {
  const names = Object.values(readGlobalConfig(rawSettings()).propertyMappings);
  try {
    await identCache.refresh(sdk, [...new Set(names)]);
  } catch (err) {
    console.warn(`${LOG} identCache refresh failed`, err);
  }
}

async function main(): Promise<void> {
  logseq.useSettingsSchema(SETTINGS_SCHEMA);
  setDebug(rawSettings().debug === true);
  logseq.provideStyle({ key: "progress-bar", style: PLUGIN_CSS });
  await refreshIdentCache();

  try {
    const mode = (await logseq.App.getUserConfigs())?.preferredThemeMode;
    if (mode === "light" || mode === "dark") themeMode = mode;
  } catch {
    // keep the dark default
  }

  // Slot hooks return no off-function in the SDK; the host drops them on unload.
  logseq.App.onMacroRendererSlotted(({ slot, payload }) => {
    if (payload.arguments[0]?.trim() !== ":progress-bar") return;
    void render(slots.track(slot, payload.arguments, payload.uuid));
  });

  offHooks.push(
    logseq.App.onThemeModeChanged(({ mode }) => {
      themeMode = mode;
      scheduleRerender(50);
    }),
    logseq.DB.onChanged(() => scheduleRerender(300)),
    logseq.onSettingsChanged(() => {
      setDebug(rawSettings().debug === true);
      void refreshIdentCache().then(() => scheduleRerender(100));
    }),
    logseq.App.onCurrentGraphChanged(() => {
      identCache.clear();
      void refreshIdentCache().then(() => scheduleRerender(100));
    })
  );

  const unregister = logseq.Editor.registerSlashCommand("progress-bar", async () => {
    try {
      await logseq.Editor.insertAtEditingCursor("{{renderer :progress-bar}}");
    } catch (err) {
      console.error(`${LOG} failed to insert`, err);
      await logseq.UI.showMsg("Failed to insert progress bar", "error");
    }
  });
  if (typeof unregister === "function") offHooks.push(unregister);

  logseq.beforeunload(async () => {
    clearTimeout(rerenderTimer);
    for (const off of offHooks.splice(0)) off();
    slots.clear();
  });

  debug("plugin ready");
}

logseq.ready(main).catch((err) => console.error(`${LOG} failed to start:`, err));
