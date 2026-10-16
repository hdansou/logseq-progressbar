import { beforeAll, describe, expect, it, vi } from "vitest";
import { computeStats, renderTemplate, resolveInstance } from "./progress";
import { formatLabel } from "./aggregator";
import { getStatusColor, isSafeColor, type ThemeMode } from "./colors";
import { cssWidth } from "./renderer";
import { DISPLAY_FORMATS } from "./settings";
import { _seedForTest } from "./identCache";
import type { ProgressBarConfig, StatusCounts } from "./types";
import type { SdkPort } from "./sdk";

/**
 * Every feature × every settings permutation through the pure pipeline
 * (resolveInstance → computeStats → renderTemplate). Catches a scan mode
 * that silently drops blocks, a setting that stops having an effect, a
 * renderer arg that no longer overrides, or a value that reaches
 * `style=""` unvalidated.
 */

// ─── Settings permutations (what the host stores in logseq.settings) ──

interface Perm {
  displayFormat: string;
  barWidth: string;
  strictTagFilter: boolean;
  showOnEmpty: boolean;
  defaultDepth: string;
  theme: ThemeMode;
}
const perms: Perm[] = [];
for (const displayFormat of DISPLAY_FORMATS)
  for (const barWidth of ["full", "compact", "240px"])
    for (const strictTagFilter of [true, false])
      for (const showOnEmpty of [true, false])
        for (const defaultDepth of ["all", "1"])
          for (const theme of ["light", "dark"] as ThemeMode[])
            perms.push({ displayFormat, barWidth, strictTagFilter, showOnEmpty, defaultDepth, theme });

const permName = (p: Perm) =>
  `${p.displayFormat} ${p.barWidth} strict=${p.strictTagFilter} empty=${p.showOnEmpty} depth=${p.defaultDepth} ${p.theme}`;

const rawSettings = (p: Perm): Record<string, unknown> => ({
  tagsInScope: "Task, Checklist",
  propertyMappings: '{"Task": "status", "Checklist": "check"}',
  completeValues: '{"status": ["Done"]}',
  defaultDepth: p.defaultDepth,
  strictTagFilter: p.strictTagFilter,
  displayFormat: p.displayFormat,
  barWidth: p.barWidth,
  showOnEmpty: p.showOnEmpty,
  colorOverrides: "{}",
});

// ─── Fake graph ───────────────────────────────────────────────────────

const CHECK = ":user.property/check-pgUd_nnQ";

interface Node {
  uuid: string;
  props: Record<string, unknown>;
  children?: Node[];
}
const task = (uuid: string, status: string, children?: Node[]): Node => ({ uuid, props: { ":block/tags": ["Task"], ":logseq.property/status": status }, children });
const check = (uuid: string, value: boolean): Node => ({ uuid, props: { ":block/tags": ["Checklist"], [CHECK]: value } });
const tido = (uuid: string): Node => ({ uuid, props: { ":block/tags": ["Tido"] } });
const plain = (uuid: string, props: Record<string, unknown> = {}): Node => ({ uuid, props });
const row = (status: string) => [{ "block/uuid": status + Math.random(), "logseq.property/status": { "block/title": status } }];

/** Children-mode graph: the host block has `children`; no query anywhere. */
function treeSdk(children: Node[]): SdkPort {
  const byUuid = new Map<string, Node>();
  const index = (ns: Node[]) => ns.forEach((n) => { byUuid.set(n.uuid, n); if (n.children) index(n.children); });
  index(children);
  return {
    datascriptQuery: vi.fn(async () => null),
    getBlock: vi.fn(async (uuid, o) => (uuid === "host" && o?.includeChildren ? { uuid, children } : null)),
    getBlockProperties: vi.fn(async (uuid) => byUuid.get(uuid)?.props ?? {}),
    getPageBlocksTree: vi.fn(async () => []),
  };
}

/** Query-mode graph: `queryUuid` carries `query`; the data query returns `rows`. */
function querySdk(query: string, rows: unknown[][], queryUuid = "host"): SdkPort {
  return {
    datascriptQuery: vi.fn(async (q: string) => {
      if (q.includes(":logseq.property/query")) return q.includes(`#uuid "${queryUuid}"`) ? query : null;
      return rows;
    }),
    getBlock: vi.fn(async () => null),
    getBlockProperties: vi.fn(async () => ({})),
    getPageBlocksTree: vi.fn(async () => []),
  };
}

// ─── Features ─────────────────────────────────────────────────────────

type Expected = Pick<StatusCounts, "counts" | "total" | "completed">;
interface Feature {
  name: string;
  args: string[];
  sdk: () => SdkPort;
  /** Expected stats given the *resolved* config (strict / depth / overrides applied). */
  expected: (config: ProgressBarConfig) => Expected;
  /** Fixed values the renderer args force regardless of settings. */
  forced?: { width?: string; displayFormat?: string };
}

const E = (counts: Record<string, number>, completed: number): Expected => ({
  counts,
  total: Object.values(counts).reduce((a, b) => a + b, 0),
  completed,
});

const features: Feature[] = [
  {
    name: "enum children",
    args: [":progress-bar"],
    sdk: () => treeSdk([task("a", "Done"), task("b", "Doing"), task("c", "Todo"), task("d", "Done")]),
    expected: () => E({ Done: 2, Doing: 1, Todo: 1 }, 2),
  },
  {
    name: "checkbox children incl. inherited unset class-property (strict-sensitive)",
    args: [":progress-bar"],
    sdk: () => treeSdk([check("a", true), check("b", false), tido("c")]),
    // #Tido is outside tagsInScope: inclusive mode counts it through the
    // inherited `check` default, strict mode drops it (documented behaviour).
    expected: (c) => (c.strict ? E({ Done: 1, Todo: 1 }, 1) : E({ Done: 1, Todo: 2 }, 1)),
  },
  {
    name: "mixed enum + checkbox",
    args: [":progress-bar"],
    sdk: () => treeSdk([task("a", "Done"), check("b", true), check("c", false), task("d", "Todo")]),
    expected: () => E({ Done: 2, Todo: 2 }, 2),
  },
  {
    name: "untagged children (strict-sensitive)",
    args: [":progress-bar"],
    sdk: () => treeSdk([task("a", "Done"), plain("b", { ":logseq.property/status": "Todo" }), plain("c")]),
    expected: (c) => (c.strict ? E({ Done: 1 }, 1) : E({ Done: 1, Todo: 1 }, 1)),
  },
  {
    name: "nested children (depth-sensitive)",
    args: [":progress-bar"],
    sdk: () => treeSdk([task("a", "Todo", [task("b", "Done", [task("c", "Done")])])]),
    expected: (c) => (c.depth === 1 ? E({ Todo: 1 }, 0) : E({ Todo: 1, Done: 2 }, 2)),
  },
  {
    name: "args: tags / property / complete override",
    args: [":progress-bar", "tags: Project", "property: state", "complete: Completed"],
    sdk: () =>
      treeSdk([
        { uuid: "a", props: { ":block/tags": ["Project"], ":logseq.property/state": "Completed" } },
        { uuid: "b", props: { ":block/tags": ["Project"], ":logseq.property/state": "Now" } },
        task("c", "Done"),
      ]),
    expected: () => E({ Completed: 1, Now: 1 }, 1),
  },
  {
    name: "args: format / width / depth / strict override",
    args: [":progress-bar", "format: both", "width: 300px", "depth: 1", "strict: true"],
    sdk: () => treeSdk([task("a", "Done", [task("b", "Todo")]), plain("c", { ":logseq.property/status": "Done" })]),
    expected: () => E({ Done: 1 }, 1),
    forced: { width: "300px", displayFormat: "both" },
  },
  {
    name: "query: DSL",
    args: [":progress-bar"],
    sdk: () => querySdk('(task "Todo" "Done")', [row("Done"), row("Done"), row("Todo")]),
    expected: () => E({ Done: 2, Todo: 1 }, 2),
  },
  {
    name: "query: datalog map",
    args: [":progress-bar"],
    sdk: () => querySdk("{:query [:find (pull ?b [*]) :where [?b :logseq.property/status ?s]]}", [row("Done"), row("Doing")]),
    expected: () => E({ Done: 1, Doing: 1 }, 1),
  },
  {
    name: "query: bare datalog vector",
    args: [":progress-bar"],
    sdk: () => querySdk("[:find (pull ?b [*]) :where [?b :logseq.property/status ?s]]", [row("Todo")]),
    expected: () => E({ Todo: 1 }, 0),
  },
  {
    name: "query: compiled (task ?b #{…}) with :in $ %",
    args: [":progress-bar"],
    sdk: () => querySdk('[:find (pull ?b [*]) :in $ % :where (task ?b #{"Done" "Todo"})]', [row("Done")]),
    expected: () => E({ Done: 1 }, 1),
  },
  {
    name: "query: explicit query: <uuid> on another block",
    args: [":progress-bar", "query: 22222222-2222-2222-2222-222222222222"],
    sdk: () => querySdk('(task "Done")', [row("Done"), row("Todo")], "22222222-2222-2222-2222-222222222222"),
    expected: () => E({ Done: 1, Todo: 1 }, 1),
  },
  {
    name: "empty scope",
    args: [":progress-bar"],
    sdk: () => treeSdk([plain("a")]),
    expected: () => E({}, 0),
  },
];

// ─── The sweep ────────────────────────────────────────────────────────

const SAFE_WIDTH = /^(\d+(\.\d+)?(px|%|em|rem|ch|vw))$/;
const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]);

beforeAll(() => {
  _seedForTest({
    byShortName: { check: [CHECK], status: [":logseq.property/status"], state: [":logseq.property/state"] },
    typeByIdent: { [CHECK]: "checkbox" },
    classPropsByTag: { Tido: [CHECK] },
  });
});

describe.each(perms.map((p) => [permName(p), p] as const))("%s", (_name, perm) => {
  it.each(features.map((f) => [f.name, f] as const))("%s", async (_n, feature) => {
    const { config, colorOverrides } = resolveInstance(rawSettings(perm), feature.args);
    const stats = await computeStats(feature.sdk(), "host", config);
    const expected = feature.expected(config);
    expect(stats).toMatchObject(expected);
    expect(stats.percent).toBe(expected.total ? Math.round((expected.completed / expected.total) * 100) : 0);

    const html = renderTemplate(stats, config, perm.theme, colorOverrides, "pb-slot");
    expect(html).not.toMatch(/undefined|NaN|null/);

    const wantWidth = feature.forced?.width ?? cssWidth(perm.barWidth);
    if (expected.total === 0) {
      if (!perm.showOnEmpty) return expect(html).toBe("");
      expect(html).toContain("pb-empty");
      expect(attr(html, "style")).toEqual([`width:${wantWidth}`]);
      return;
    }

    // Label follows the resolved format (renderer arg beats setting).
    const format = (feature.forced?.displayFormat ?? perm.displayFormat) as ProgressBarConfig["displayFormat"];
    expect(config.displayFormat).toBe(format);
    const label = html.match(/<span class="pb-label">([^<]*)<\/span>/)![1];
    expect(label).toBe(formatLabel(stats, format));
    expect(label).toMatch({ percent: /^\d+%$/, fraction: /^\d+\/\d+$/, both: /^\d+\/\d+ · \d+%$/ }[format]);

    // Wrapper width: validated, and the renderer arg wins over the setting.
    const styles = attr(html, "style");
    expect(styles[0]).toBe(`width:${wantWidth}`);
    expect(wantWidth).toMatch(SAFE_WIDTH);

    // One segment per status, widths sum to 100, every colour validated and theme-correct.
    const segments = styles.slice(1).map((s) => /^width:([\d.]+)%;background:(.+)$/.exec(s)!);
    expect(segments).toHaveLength(Object.keys(expected.counts).length);
    const sum = segments.reduce((a, m) => a + parseFloat(m[1]), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.1);
    for (const m of segments) expect(isSafeColor(m[2])).toBe(true);
    const labels = attr(html, "data-label").map((l) => l.split(":")[0]);
    labels.forEach((status, i) => expect(segments[i][2]).toBe(getStatusColor(status, perm.theme, {})));

    // Completed segments come first.
    const completeSet = new Set(Object.values(config.completeValues).flat().map((v) => v.toLowerCase()));
    completeSet.add("done");
    const firstComplete = labels.findIndex((l) => completeSet.has(l.toLowerCase()));
    const lastComplete = labels.map((l) => completeSet.has(l.toLowerCase())).lastIndexOf(true);
    if (expected.completed > 0) {
      expect(firstComplete).toBe(0);
      expect(labels.slice(0, lastComplete + 1).every((l) => completeSet.has(l.toLowerCase()))).toBe(true);
    }
  });
});
