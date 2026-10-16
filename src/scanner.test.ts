import { describe, it, expect, vi } from "vitest";
import { countQueryStatuses, filterByTags, scanChildren, scanPage } from "./scanner";
import { aggregate } from "./aggregator";
import { DEFAULTS } from "./settings";
import type { ProgressBarConfig } from "./types";
import type { SdkPort } from "./sdk";

const baseConfig: ProgressBarConfig = {
  ...DEFAULTS,
  tags: ["Task", "Checklist"],
  propertyMappings: { Task: "status", Checklist: "check" },
  completeValues: { status: ["Done"] },
};

interface MockChild {
  uuid: string;
  props: Record<string, unknown>;
  children?: MockChild[];
}

/**
 * A fake SdkPort that mimics the DB-graph shapes observed in production:
 * `getBlock(parent, {includeChildren:true})` returns `.children`, and
 * `getBlockProperties(uuid)` returns colon-prefixed keys.
 */
function treeSdk(parentUUID: string, children: MockChild[]): SdkPort {
  const byUUID = new Map<string, MockChild>();
  const collect = (cs: MockChild[]) => {
    for (const c of cs) {
      byUUID.set(c.uuid, c);
      if (c.children) collect(c.children);
    }
  };
  collect(children);
  return {
    datascriptQuery: vi.fn(async () => null),
    getBlock: vi.fn(async (uuid, opts) =>
      uuid === parentUUID
        ? { uuid: parentUUID, children: opts?.includeChildren ? children : undefined }
        : null
    ),
    getBlockProperties: vi.fn(async (uuid) => byUUID.get(uuid)?.props ?? {}),
    getPageBlocksTree: vi.fn(async () => children),
  };
}

describe("scanChildren — DB-graph SDK shapes", () => {
  it("reads tags from `:block/tags` (colon-prefixed) as plain string array", async () => {
    const sdk = treeSdk("parent", [
      { uuid: "c1", props: { ":block/tags": ["Checklist"], ":user.property/check-F44tqsqr": true } },
    ]);
    const blocks = await scanChildren(sdk, "parent", baseConfig);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tags).toEqual(["Checklist"]);
  });

  it("reads tags from `block/tags` (un-prefixed) for legacy/file-graph shape", async () => {
    const sdk = treeSdk("parent", [{ uuid: "c1", props: { "block/tags": ["Task"], status: "Done" } }]);
    const blocks = await scanChildren(sdk, "parent", baseConfig);
    expect(blocks[0].tags).toEqual(["Task"]);
  });

  it("reads tags as entity objects with `:block/title`", async () => {
    const sdk = treeSdk("parent", [
      { uuid: "c1", props: { ":block/tags": [{ ":block/title": "Tido" }], ":user.property/check-F44tqsqr": false } },
    ]);
    const blocks = await scanChildren(sdk, "parent", baseConfig);
    expect(blocks[0].tags).toEqual(["Tido"]);
  });

  it("falls back to the block's own `tags` field and tolerates odd shapes", async () => {
    const sdk = treeSdk("parent", [{ uuid: "c1", props: {} }]);
    (sdk.getBlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      uuid: "parent",
      children: [
        { uuid: "c1", tags: [{ name: "Task" }, { content: "Bug" }, 42, null] },
        { uuid: "c2", tags: "not-an-array" },
        { notAUuid: true },
      ],
    });
    const blocks = await scanChildren(sdk, "parent", baseConfig);
    expect(blocks.map((b) => b.tags)).toEqual([["Task", "Bug"], []]);
  });

  it("returns empty tags when no tag key is present", async () => {
    const sdk = treeSdk("parent", [{ uuid: "c1", props: { ":user.property/check-F44tqsqr": true } }]);
    const blocks = await scanChildren(sdk, "parent", baseConfig);
    expect(blocks[0].tags).toEqual([]);
  });

  it("preserves the colon-prefixed user-property key end-to-end", async () => {
    const sdk = treeSdk("parent", [
      { uuid: "c1", props: { ":block/tags": ["Checklist"], ":user.property/check-F44tqsqr": true } },
    ]);
    const blocks = await scanChildren(sdk, "parent", baseConfig);
    expect(blocks[0].properties[":user.property/check-F44tqsqr"]).toBe(true);
  });

  it("returns empty array when parent has no children or does not exist", async () => {
    expect(await scanChildren(treeSdk("parent", []), "parent", baseConfig)).toEqual([]);
    expect(await scanChildren(treeSdk("parent", []), "missing", baseConfig)).toEqual([]);
  });

  it("integrates with aggregate(): the user's 4-checkbox + 1-untagged scenario", async () => {
    const sdk = treeSdk("parent", [
      { uuid: "tido1", props: { ":block/tags": ["Tido"], ":user.property/check-F44tqsqr": false } },
      { uuid: "tido2", props: { ":block/tags": ["Tido"], ":user.property/check-F44tqsqr": true } },
      { uuid: "cl1", props: { ":block/tags": ["Checklist"], ":user.property/check-F44tqsqr": false } },
      { uuid: "cl2", props: { ":block/tags": ["Checklist"], ":user.property/check-F44tqsqr": true } },
      { uuid: "x", props: { ":logseq.property/created-by-ref": "user" } },
    ]);
    const blocks = await scanChildren(sdk, "parent", baseConfig);
    expect(blocks).toHaveLength(5);
    const stats = aggregate(blocks, baseConfig);
    expect(stats).toMatchObject({ total: 4, completed: 2, percent: 50, counts: { Done: 2, Todo: 2 } });
  });

  it("respects depth=1 (direct children only)", async () => {
    const sdk = treeSdk("parent", [
      {
        uuid: "c1",
        props: { ":block/tags": ["Task"], status: "Done" },
        children: [{ uuid: "grandchild", props: { ":block/tags": ["Task"], status: "Todo" } }],
      },
    ]);
    const blocks = await scanChildren(sdk, "parent", { ...baseConfig, depth: 1 });
    expect(blocks.map((b) => b.uuid)).toEqual(["c1"]);
  });

  it("recurses through descendants when depth allows", async () => {
    const sdk = treeSdk("parent", [
      { uuid: "c1", props: { ":block/tags": ["Task"] }, children: [{ uuid: "grandchild", props: { ":block/tags": ["Task"] } }] },
    ]);
    const blocks = await scanChildren(sdk, "parent", { ...baseConfig, depth: 5 });
    expect(blocks.map((b) => b.uuid).sort()).toEqual(["c1", "grandchild"]);
  });

  it("fetches properties exactly once per block", async () => {
    const sdk = treeSdk("parent", [
      { uuid: "c1", props: {}, children: [{ uuid: "g1", props: {} }] },
      { uuid: "c2", props: {} },
    ]);
    await scanChildren(sdk, "parent", baseConfig);
    expect(sdk.getBlockProperties).toHaveBeenCalledTimes(3);
  });
});

describe("scanPage", () => {
  it("walks the page tree with the same depth rules", async () => {
    const sdk = treeSdk("parent", [
      { uuid: "top", props: { ":block/tags": ["Task"], status: "Done" }, children: [{ uuid: "nested", props: {} }] },
    ]);
    expect((await scanPage(sdk, "Page", baseConfig)).map((b) => b.uuid)).toEqual(["top", "nested"]);
    expect((await scanPage(sdk, "Page", { ...baseConfig, depth: 1 })).map((b) => b.uuid)).toEqual(["top"]);
    (sdk.getPageBlocksTree as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect(await scanPage(sdk, "Nope", baseConfig)).toEqual([]);
  });
});

describe("filterByTags", () => {
  const blocks = [
    { uuid: "1", tags: ["Task"], properties: {} },
    { uuid: "2", tags: ["other"], properties: {} },
    { uuid: "3", tags: [], properties: {} },
  ];
  it("keeps everything in inclusive mode", () => {
    expect(filterByTags(blocks, { ...baseConfig, strict: false })).toHaveLength(3);
  });
  it("keeps only in-scope tags (case-insensitive) in strict mode", () => {
    expect(filterByTags(blocks, { ...baseConfig, strict: true, tags: ["task"] }).map((b) => b.uuid)).toEqual(["1"]);
  });
});

// ─── Query mode ───────────────────────────────────────────────────────

const queryConfig: ProgressBarConfig = {
  ...DEFAULTS,
  tags: ["Task"],
  propertyMappings: { Task: "status" },
  completeValues: { status: ["Done"] },
};

// Entity roughly matching what DB.datascriptQuery returns for `(pull ?b [*])`.
const entity = (uuid: string, status: string) => ({
  "block/uuid": uuid,
  "block/tags": [{ "block/title": "Task" }],
  "logseq.property/status": { "block/title": status },
});
const asRows = (entities: unknown[]) => entities.map((e) => [e]);

const isResolver = (q: string) => q.includes(":logseq.property/query") && q.includes(":block/title ?q");

function querySdk(opts: { queryBlockTitle: string | null; entities?: unknown[]; onData?: () => unknown }): SdkPort {
  return {
    datascriptQuery: vi.fn(async (q: string) => {
      if (isResolver(q)) return opts.queryBlockTitle;
      if (opts.onData) return opts.onData();
      return asRows(opts.entities ?? []);
    }),
    getBlock: vi.fn(async () =>
      opts.queryBlockTitle ? { uuid: "query-uuid", "logseq.property/query": { "block/title": opts.queryBlockTitle } } : null
    ),
    getBlockProperties: vi.fn(async () => ({})),
    getPageBlocksTree: vi.fn(async () => []),
  };
}

describe("countQueryStatuses — unified query pipeline", () => {
  it("handles a DSL query block", async () => {
    const sdk = querySdk({ queryBlockTitle: '(task "Todo" "Done")', entities: [entity("b1", "Done"), entity("b2", "Done"), entity("b3", "Todo")] });
    const stats = await countQueryStatuses(sdk, "query-uuid", queryConfig);
    expect(stats).toMatchObject({ total: 3, completed: 2, percent: 67, counts: { Done: 2, Todo: 1 } });
  });

  it("handles the user's custom datalog map query", async () => {
    const map = `{:query [:find (pull ?b [*])
               :where
               [?b :logseq.property/status ?s]
               (or [?s :db/ident :logseq.property/status.todo]
                   [?s :db/ident :logseq.property/status.doing]
                   [?s :db/ident :logseq.property/status.done])]}`;
    const sdk = querySdk({ queryBlockTitle: map, entities: [entity("b1", "Done"), entity("b2", "Doing"), entity("b3", "Doing"), entity("b4", "Todo")] });
    const stats = await countQueryStatuses(sdk, "query-uuid", queryConfig);
    expect(stats).toMatchObject({ total: 4, completed: 1, counts: { Done: 1, Doing: 2, Todo: 1 } });
    const dataQuery = (sdk.datascriptQuery as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string).find((q) => !isResolver(q));
    expect(dataQuery).toContain("{:logseq.property/status [:block/title]}");
  });

  it("handles a bare datalog vector query", async () => {
    const sdk = querySdk({ queryBlockTitle: "[:find (pull ?b [*]) :where [?b :logseq.property/status ?s]]", entities: [entity("b1", "Done"), entity("b2", "Todo")] });
    const stats = await countQueryStatuses(sdk, "query-uuid", queryConfig);
    expect(stats).toMatchObject({ total: 2, completed: 1 });
  });

  it("re-routes Logseq's compiled `(task ?b #{…})` datalog through the DSL generator", async () => {
    const compiled = `[:find (pull ?b [*]) :in $ % :where (task ?b #{"Done" "Todo"})]`;
    const sdk = querySdk({ queryBlockTitle: compiled, entities: [entity("b1", "Done")] });
    const stats = await countQueryStatuses(sdk, "query-uuid", queryConfig);
    expect(stats).toMatchObject({ total: 1, completed: 1 });
    const dataQuery = (sdk.datascriptQuery as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string).find((q) => !isResolver(q));
    expect(dataQuery).not.toContain(":in $ %");
    expect(dataQuery).toContain('[?s :block/title "Done"]');
  });

  it("resolves [[uuid]] tag refs in DSL to titles through the DB", async () => {
    const tagUuid = "11111111-2222-3333-4444-555555555555";
    const sdk = querySdk({ queryBlockTitle: `(and (task "Done") (tags [[${tagUuid}]] [[Plain]]))`, entities: [entity("b1", "Done")] });
    (sdk.datascriptQuery as ReturnType<typeof vi.fn>).mockImplementation(async (q: string) => {
      if (isResolver(q)) return `(and (task "Done") (tags [[${tagUuid}]] [[Plain]]))`;
      if (q.includes(`#uuid "${tagUuid}"`)) return "Project";
      return asRows([entity("b1", "Done")]);
    });
    await countQueryStatuses(sdk, "query-uuid", queryConfig);
    const dataQuery = (sdk.datascriptQuery as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string).find((q) => q.includes(":find (pull"));
    expect(dataQuery).toContain('[?tag :block/title "Project"]');
    expect(dataQuery).toContain('[?tag :block/title "Plain"]');
  });

  it("returns null when the block has no :logseq.property/query (fall-through to children mode)", async () => {
    expect(await countQueryStatuses(querySdk({ queryBlockTitle: null }), "missing-uuid", queryConfig)).toBeNull();
  });

  it("falls back to getBlock when the datascript resolver returns nothing", async () => {
    const sdk = querySdk({ queryBlockTitle: '(task "Done")', entities: [entity("b1", "Done")] });
    (sdk.datascriptQuery as ReturnType<typeof vi.fn>).mockImplementation(async (q: string) =>
      isResolver(q) ? null : asRows([entity("b1", "Done")])
    );
    const stats = await countQueryStatuses(sdk, "query-uuid", queryConfig);
    expect(stats).toMatchObject({ total: 1 });
    expect(sdk.getBlock).toHaveBeenCalledWith("query-uuid");
  });

  it("picks the :logseq.property/query DSL, not the block's own '{{renderer …}}' title (regression)", async () => {
    const sdk = querySdk({ queryBlockTitle: '(task "Todo" "Done")', entities: [entity("b1", "Done"), entity("b2", "Todo")] });
    const stats = await countQueryStatuses(sdk, "query-uuid", queryConfig);
    expect(stats).toMatchObject({ total: 2, counts: { Done: 1, Todo: 1 } });
  });

  it("returns empty stats for an unknown query form or an unparsable map", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await countQueryStatuses(querySdk({ queryBlockTitle: "{:not-a-query 1}" }), "q", queryConfig)).toMatchObject({ total: 0 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns empty stats (and does not throw) on datascript runtime error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sdk = querySdk({ queryBlockTitle: '(task "Done")', onData: () => { throw new Error("boom"); } });
    const stats = await countQueryStatuses(sdk, "query-uuid", queryConfig);
    expect(stats).toMatchObject({ total: 0 });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
