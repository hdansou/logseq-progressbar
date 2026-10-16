import { describe, expect, it, vi } from "vitest";
import { computeStats, renderTemplate, resolveInstance } from "./progress";
import { DEFAULTS } from "./settings";
import { _clearForTest } from "./identCache";
import type { SdkPort } from "./sdk";
import type { StatusCounts } from "./types";

const empty: StatusCounts = { counts: {}, total: 0, completed: 0, percent: 0 };
const some: StatusCounts = { counts: { Done: 1, Todo: 1 }, total: 2, completed: 1, percent: 50 };

function fakeSdk(opts: { query?: string | null; rows?: unknown[]; children?: unknown[] }): SdkPort {
  return {
    datascriptQuery: vi.fn(async (q: string) => (q.includes(":logseq.property/query") ? opts.query ?? null : (opts.rows ?? []).map((r) => [r]))),
    getBlock: vi.fn(async (_uuid, o) => (o?.includeChildren ? { children: opts.children ?? [] } : null)),
    getBlockProperties: vi.fn(async (uuid: string) => (opts.children as Array<{ uuid: string; props: Record<string, unknown> }> | undefined)?.find((c) => c.uuid === uuid)?.props ?? {}),
    getPageBlocksTree: vi.fn(async () => []),
  };
}

describe("resolveInstance", () => {
  it("merges renderer args over global settings and parses colour overrides", () => {
    _clearForTest();
    const { config, colorOverrides } = resolveInstance(
      { displayFormat: "fraction", colorOverrides: '{"Done": {"light": "#000", "dark": "#fff"}}' },
      [":progress-bar", "format: both", "tags: Bug"]
    );
    expect(config.displayFormat).toBe("both");
    expect(config.tags).toEqual(["Bug"]);
    expect(config.propertyMappings).toEqual(DEFAULTS.propertyMappings);
    expect(colorOverrides).toEqual({ Done: { light: "#000", dark: "#fff" } });
  });
});

describe("computeStats", () => {
  it("prefers query mode when the block carries a query", async () => {
    const sdk = fakeSdk({ query: '(task "Done")', rows: [{ "block/uuid": "b", "logseq.property/status": { "block/title": "Done" } }] });
    const stats = await computeStats(sdk, "block", DEFAULTS);
    expect(stats).toMatchObject({ total: 1, completed: 1 });
    expect(sdk.getBlock).not.toHaveBeenCalledWith("block", { includeChildren: true });
  });

  it("uses the explicit queryUUID over the host block", async () => {
    const sdk = fakeSdk({ query: '(task "Done")', rows: [] });
    await computeStats(sdk, "block", { ...DEFAULTS, queryUUID: "other" });
    expect((sdk.datascriptQuery as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('#uuid "other"');
  });

  it("falls back to children mode (with strict filtering) when there is no query", async () => {
    const sdk = fakeSdk({
      query: null,
      children: [
        { uuid: "a", props: { ":block/tags": ["Task"], status: "Done" } },
        { uuid: "b", props: { status: "Todo" } },
      ],
    });
    expect(await computeStats(sdk, "block", DEFAULTS)).toMatchObject({ total: 2, completed: 1 });
    expect(await computeStats(sdk, "block", { ...DEFAULTS, strict: true })).toMatchObject({ total: 1, completed: 1 });
  });
});

describe("renderTemplate", () => {
  it("renders nothing for an empty scope unless showOnEmpty", () => {
    expect(renderTemplate(empty, DEFAULTS, "dark", {}, "pb-1")).toBe("");
    const html = renderTemplate(empty, { ...DEFAULTS, showOnEmpty: true, barWidth: "compact" }, "dark", {}, "pb-1");
    expect(html).toContain("pb-empty");
    expect(html).toContain("width:200px");
  });

  it("renders a bar with theme colours and overrides applied", () => {
    const html = renderTemplate(some, DEFAULTS, "light", { done: { light: "#010203", dark: "#040506" } }, "pb-2");
    expect(html).toContain("background:#010203");
    expect(html).toContain("background:#e2e8f0"); // Todo light default
    expect(html).toContain("50%");
  });
});
