import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scanChildren } from "../scanner";
import { aggregate } from "../aggregator";
import { DEFAULTS } from "../config";
import type { ProgressBarConfig } from "../types";

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
 * Install a `logseq` global that mimics the DB-graph SDK shape we observed
 * in production: `getBlock(parent, {includeChildren:true})` returns `.children`,
 * and `getBlockProperties(uuid)` returns colon-prefixed keys.
 */
function installSdkMock(parentUUID: string, children: MockChild[]) {
  const byUUID = new Map<string, MockChild>();
  const collect = (cs: MockChild[]) => {
    for (const c of cs) {
      byUUID.set(c.uuid, c);
      if (c.children) collect(c.children);
    }
  };
  collect(children);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).logseq = {
    Editor: {
      getBlock: vi.fn(async (uuid: string, opts?: { includeChildren?: boolean }) => {
        if (uuid === parentUUID) {
          return {
            uuid: parentUUID,
            children: opts?.includeChildren ? children : undefined,
          };
        }
        const c = byUUID.get(uuid);
        if (!c) return null;
        return { uuid: c.uuid, tags: c.props[":block/tags"] };
      }),
      getBlockProperties: vi.fn(async (uuid: string) => {
        const c = byUUID.get(uuid);
        return c ? c.props : {};
      }),
    },
  };
}

describe("scanChildren — DB-graph SDK shapes", () => {
  const originalLogseq = (globalThis as unknown as { logseq?: unknown }).logseq;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).logseq = originalLogseq;
  });

  it("reads tags from `:block/tags` (colon-prefixed) as plain string array", async () => {
    installSdkMock("parent", [
      {
        uuid: "c1",
        props: {
          ":block/tags": ["Checklist"],
          ":user.property/check-F44tqsqr": true,
        },
      },
    ]);

    const blocks = await scanChildren("parent", baseConfig);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tags).toEqual(["Checklist"]);
  });

  it("reads tags from `block/tags` (un-prefixed) for legacy/file-graph shape", async () => {
    installSdkMock("parent", [
      {
        uuid: "c1",
        props: { "block/tags": ["Task"], status: "Done" },
      },
    ]);

    const blocks = await scanChildren("parent", baseConfig);
    expect(blocks[0].tags).toEqual(["Task"]);
  });

  it("reads tags as entity objects with `:block/title`", async () => {
    installSdkMock("parent", [
      {
        uuid: "c1",
        props: {
          ":block/tags": [{ ":block/title": "Tido" }],
          ":user.property/check-F44tqsqr": false,
        },
      },
    ]);

    const blocks = await scanChildren("parent", baseConfig);
    expect(blocks[0].tags).toEqual(["Tido"]);
  });

  it("returns empty tags when no tag key is present", async () => {
    installSdkMock("parent", [
      {
        uuid: "c1",
        props: { ":user.property/check-F44tqsqr": true },
      },
    ]);

    const blocks = await scanChildren("parent", baseConfig);
    expect(blocks[0].tags).toEqual([]);
  });

  it("preserves the colon-prefixed user-property key end-to-end", async () => {
    installSdkMock("parent", [
      {
        uuid: "c1",
        props: {
          ":block/tags": ["Checklist"],
          ":user.property/check-F44tqsqr": true,
        },
      },
    ]);

    const blocks = await scanChildren("parent", baseConfig);
    expect(blocks[0].properties[":user.property/check-F44tqsqr"]).toBe(true);
  });

  it("returns empty array when parent has no children", async () => {
    installSdkMock("parent", []);
    const blocks = await scanChildren("parent", baseConfig);
    expect(blocks).toEqual([]);
  });

  it("integrates with aggregate(): the user's 4-checkbox + 1-untagged scenario", async () => {
    // Mirrors the exact real-graph state from the diagnostic logs.
    installSdkMock("parent", [
      {
        uuid: "tido1",
        props: { ":block/tags": ["Tido"], ":user.property/check-F44tqsqr": false },
      },
      {
        uuid: "tido2",
        props: { ":block/tags": ["Tido"], ":user.property/check-F44tqsqr": true },
      },
      {
        uuid: "cl1",
        props: { ":block/tags": ["Checklist"], ":user.property/check-F44tqsqr": false },
      },
      {
        uuid: "cl2",
        props: { ":block/tags": ["Checklist"], ":user.property/check-F44tqsqr": true },
      },
      {
        // 5th child: no tag, no check property — must be excluded.
        uuid: "x",
        props: { ":logseq.property/created-by-ref": "user" },
      },
    ]);

    const blocks = await scanChildren("parent", baseConfig);
    expect(blocks).toHaveLength(5);

    const stats = aggregate(blocks, baseConfig);
    // Only 4 counted (5th has no recognized property). 2 true, 2 false.
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(2);
    expect(stats.percent).toBe(50);
    expect(stats.counts).toEqual({ Done: 2, Todo: 2 });
  });

  it("respects depth=1 (direct children only)", async () => {
    installSdkMock("parent", [
      {
        uuid: "c1",
        props: { ":block/tags": ["Task"], status: "Done" },
        children: [
          {
            uuid: "grandchild",
            props: { ":block/tags": ["Task"], status: "Todo" },
          },
        ],
      },
    ]);

    const blocks = await scanChildren("parent", { ...baseConfig, depth: 1 });
    expect(blocks.map((b) => b.uuid)).toEqual(["c1"]); // no grandchild
  });

  it("recurses through descendants when depth allows", async () => {
    installSdkMock("parent", [
      {
        uuid: "c1",
        props: { ":block/tags": ["Task"] },
        children: [
          {
            uuid: "grandchild",
            props: { ":block/tags": ["Task"] },
          },
        ],
      },
    ]);

    const blocks = await scanChildren("parent", { ...baseConfig, depth: 5 });
    expect(blocks.map((b) => b.uuid).sort()).toEqual(["c1", "grandchild"]);
  });
});
