import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { countQueryStatuses } from "../scanner";
import { DEFAULTS } from "../config";
import type { ProgressBarConfig } from "../types";

const baseConfig: ProgressBarConfig = {
  ...DEFAULTS,
  tags: ["Task"],
  propertyMappings: { Task: "status" },
  completeValues: { status: ["Done"] },
};

// Build an entity roughly matching what DB.datascriptQuery returns for
// `(pull ?b [*])` in Logseq DB graphs (normalized-keyword JSON).
const entity = (uuid: string, status: string) => ({
  "block/uuid": uuid,
  "block/tags": [{ "block/title": "Task" }],
  "logseq.property/status": { "block/title": status },
});

// datascriptQuery returns [[<entity>], [<entity>], ...] for pull queries.
const asRows = (entities: unknown[]) => entities.map((e) => [e]);

type MockDatascript = ReturnType<typeof vi.fn>;

function installLogseqMock(opts: {
  queryBlockTitle: string;
  entities: unknown[];
}) {
  const datascriptQuery: MockDatascript = vi.fn(async (q: string) => {
    // Resolver query targets :logseq.property/query → :block/title directly.
    if (q.includes(":logseq.property/query") && q.includes(":block/title ?q")) {
      return opts.queryBlockTitle;
    }
    // Main data query
    return asRows(opts.entities);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).logseq = {
    DB: { datascriptQuery },
    Editor: {
      getBlock: vi.fn(async () => ({
        uuid: "query-uuid",
        "logseq.property/query": { "block/title": opts.queryBlockTitle },
      })),
    },
  };

  return { datascriptQuery };
}

describe("countQueryStatuses — unified query pipeline", () => {
  const originalLogseq = (globalThis as unknown as { logseq?: unknown }).logseq;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).logseq = originalLogseq;
  });

  it("handles a DSL query block", async () => {
    installLogseqMock({
      queryBlockTitle: '(task "Todo" "Done")',
      entities: [
        entity("b1", "Done"),
        entity("b2", "Done"),
        entity("b3", "Todo"),
      ],
    });

    const stats = await countQueryStatuses("query-uuid", baseConfig);
    expect(stats).not.toBeNull();
    expect(stats!.total).toBe(3);
    expect(stats!.completed).toBe(2);
    expect(stats!.percent).toBe(67);
    expect(stats!.counts).toEqual({ Done: 2, Todo: 1 });
  });

  it("handles the user's custom datalog map query", async () => {
    const map = `{:query [:find (pull ?b [*])
               :where
               [?b :logseq.property/status ?s]
               (or [?s :db/ident :logseq.property/status.todo]
                   [?s :db/ident :logseq.property/status.doing]
                   [?s :db/ident :logseq.property/status.done])]}`;

    installLogseqMock({
      queryBlockTitle: map,
      entities: [
        entity("b1", "Done"),
        entity("b2", "Doing"),
        entity("b3", "Doing"),
        entity("b4", "Todo"),
      ],
    });

    const stats = await countQueryStatuses("query-uuid", baseConfig);
    expect(stats).not.toBeNull();
    expect(stats!.total).toBe(4);
    expect(stats!.completed).toBe(1);
    expect(stats!.counts).toEqual({ Done: 1, Doing: 2, Todo: 1 });
  });

  it("handles a bare datalog vector query", async () => {
    installLogseqMock({
      queryBlockTitle:
        "[:find (pull ?b [*]) :where [?b :logseq.property/status ?s]]",
      entities: [entity("b1", "Done"), entity("b2", "Todo")],
    });

    const stats = await countQueryStatuses("query-uuid", baseConfig);
    expect(stats).not.toBeNull();
    expect(stats!.total).toBe(2);
    expect(stats!.completed).toBe(1);
  });

  it("returns null when the block has no :logseq.property/query (signals fall-through to children mode)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).logseq = {
      DB: { datascriptQuery: vi.fn(async () => null) },
      Editor: { getBlock: vi.fn(async () => null) },
    };

    const stats = await countQueryStatuses("missing-uuid", baseConfig);
    expect(stats).toBeNull();
  });

  it("picks the :logseq.property/query DSL, not the block's own '{{renderer …}}' title (regression)", async () => {
    // Real query-block shape: the block's OWN title is the renderer macro
    // (starts with '{'), and the actual DSL lives behind :logseq.property/query.
    // A loose resolver would grab the block title because it opens with '{'.
    const datascriptQuery = vi.fn(async (q: string) => {
      if (q.includes(":logseq.property/query") && q.includes(":block/title ?q")) {
        return '(task "Todo" "Done")';
      }
      return asRows([entity("b1", "Done"), entity("b2", "Todo")]);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).logseq = {
      DB: { datascriptQuery },
      Editor: { getBlock: vi.fn(async () => null) },
    };

    const stats = await countQueryStatuses("query-uuid", baseConfig);
    expect(stats).not.toBeNull();
    expect(stats!.total).toBe(2);
    expect(stats!.counts).toEqual({ Done: 1, Todo: 1 });
  });

  it("returns empty stats (and does not throw) on datascript runtime error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const datascriptQuery = vi.fn(async (q: string) => {
      if (q.includes(":logseq.property/query")) {
        // Resolver succeeds
        return '(task "Done")';
      }
      // Main data query blows up
      throw new Error("boom");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).logseq = {
      DB: { datascriptQuery },
      Editor: { getBlock: vi.fn(async () => null) },
    };

    const stats = await countQueryStatuses("query-uuid", baseConfig);
    expect(stats).not.toBeNull();
    expect(stats!.total).toBe(0);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
