import { describe, it, expect } from "vitest";
import { aggregate, formatLabel } from "./aggregator";
import { DEFAULTS } from "./settings";
import type { ProgressBarConfig, StatusCounts } from "./types";

const baseConfig: ProgressBarConfig = {
  ...DEFAULTS,
  tags: ["Task"],
  propertyMappings: { Task: "status" },
  completeValues: { status: ["Done"] },
};

function makeBlock(status: string | null, tags: string[] = ["Task"]) {
  return {
    uuid: Math.random().toString(36),
    tags,
    properties: status != null ? { status } : {},
  };
}

describe("aggregate", () => {
  it("counts all done", () => {
    const blocks = [makeBlock("Done"), makeBlock("Done"), makeBlock("Done")];
    const result = aggregate(blocks, baseConfig);
    expect(result.total).toBe(3);
    expect(result.completed).toBe(3);
    expect(result.percent).toBe(100);
    expect(result.counts).toEqual({ Done: 3 });
  });

  it("counts mixed statuses", () => {
    const blocks = [
      makeBlock("Done"),
      makeBlock("Done"),
      makeBlock("Doing"),
      makeBlock("Todo"),
      makeBlock("Todo"),
      makeBlock("Todo"),
    ];
    const result = aggregate(blocks, baseConfig);
    expect(result.total).toBe(6);
    expect(result.completed).toBe(2);
    expect(result.percent).toBe(33);
    expect(result.counts).toEqual({ Done: 2, Doing: 1, Todo: 3 });
  });

  it("returns zero for empty blocks", () => {
    const result = aggregate([], baseConfig);
    expect(result.total).toBe(0);
    expect(result.completed).toBe(0);
    expect(result.percent).toBe(0);
    expect(result.counts).toEqual({});
  });

  it("excludes blocks with no property value", () => {
    const blocks = [makeBlock("Done"), makeBlock(null), makeBlock("Todo")];
    const result = aggregate(blocks, baseConfig);
    expect(result.total).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.percent).toBe(50);
  });

  it("supports custom property values", () => {
    const config: ProgressBarConfig = {
      ...baseConfig,
      tags: ["Project"],
      propertyMappings: { Project: "state" },
      completeValues: { state: ["Completed"] },
    };
    const blocks = [
      { uuid: "1", tags: ["Project"], properties: { state: "Completed" } },
      { uuid: "2", tags: ["Project"], properties: { state: "Now" } },
      { uuid: "3", tags: ["Project"], properties: { state: "Later" } },
    ];
    const result = aggregate(blocks, config);
    expect(result.total).toBe(3);
    expect(result.completed).toBe(1);
    expect(result.percent).toBe(33);
  });

  it("supports multiple complete values", () => {
    const config: ProgressBarConfig = {
      ...baseConfig,
      completeValues: { status: ["Done", "Canceled"] },
    };
    const blocks = [
      makeBlock("Done"),
      makeBlock("Canceled"),
      makeBlock("Todo"),
    ];
    const result = aggregate(blocks, config);
    expect(result.completed).toBe(2);
    expect(result.percent).toBe(67);
  });

  it("handles single block", () => {
    const result = aggregate([makeBlock("Todo")], baseConfig);
    expect(result.total).toBe(1);
    expect(result.completed).toBe(0);
    expect(result.percent).toBe(0);
  });

  describe("checkbox property values", () => {
    const checklistConfig: ProgressBarConfig = {
      ...DEFAULTS,
      tags: ["Checklist"],
      propertyMappings: { Checklist: "check" },
      completeValues: {},
    };

    function makeChecklist(value: boolean | null) {
      return {
        uuid: Math.random().toString(36),
        tags: ["Checklist"],
        properties: value === null ? {} : { check: value },
      };
    }

    it("counts `true` in the Done bucket and as completed", () => {
      const blocks = [makeChecklist(true), makeChecklist(true)];
      const result = aggregate(blocks, checklistConfig);
      expect(result.total).toBe(2);
      expect(result.completed).toBe(2);
      expect(result.percent).toBe(100);
      expect(result.counts).toEqual({ Done: 2 });
    });

    it("counts `false` in the Todo bucket and not as completed", () => {
      const blocks = [makeChecklist(false), makeChecklist(false)];
      const result = aggregate(blocks, checklistConfig);
      expect(result.total).toBe(2);
      expect(result.completed).toBe(0);
      expect(result.percent).toBe(0);
      expect(result.counts).toEqual({ Todo: 2 });
    });

    it("mixes true/false correctly", () => {
      const blocks = [
        makeChecklist(true),
        makeChecklist(false),
        makeChecklist(true),
        makeChecklist(false),
      ];
      const result = aggregate(blocks, checklistConfig);
      expect(result.total).toBe(4);
      expect(result.completed).toBe(2);
      expect(result.percent).toBe(50);
      expect(result.counts).toEqual({ Done: 2, Todo: 2 });
    });

    it("does not silently filter `false` (regression: !value treated false as null)", () => {
      const result = aggregate([makeChecklist(false)], checklistConfig);
      expect(result.total).toBe(1);
    });

    it("still excludes blocks where the checkbox property is unset", () => {
      const blocks = [makeChecklist(true), makeChecklist(null), makeChecklist(false)];
      const result = aggregate(blocks, checklistConfig);
      expect(result.total).toBe(2);
      expect(result.completed).toBe(1);
    });

    it("aggregates checkbox children alongside enum-status children under one bar", () => {
      const mixedConfig: ProgressBarConfig = {
        ...DEFAULTS,
        tags: ["Task", "Checklist"],
        propertyMappings: { Task: "status", Checklist: "check" },
        completeValues: { status: ["Done"] },
      };
      const blocks = [
        { uuid: "1", tags: ["Task"], properties: { status: "Done" } },
        { uuid: "2", tags: ["Task"], properties: { status: "Todo" } },
        { uuid: "3", tags: ["Checklist"], properties: { check: true } },
        { uuid: "4", tags: ["Checklist"], properties: { check: false } },
      ];
      const result = aggregate(blocks, mixedConfig);
      expect(result.total).toBe(4);
      expect(result.completed).toBe(2);
      expect(result.percent).toBe(50);
      expect(result.counts).toEqual({ Done: 2, Todo: 2 });
    });

    it("resolves checkbox property via logseq.property/ prefix", () => {
      const blocks = [
        {
          uuid: "1",
          tags: ["Checklist"],
          properties: { "logseq.property/check": true },
        },
        {
          uuid: "2",
          tags: ["Checklist"],
          properties: { "logseq.property/check": false },
        },
      ];
      const result = aggregate(blocks, checklistConfig);
      expect(result.total).toBe(2);
      expect(result.completed).toBe(1);
      expect(result.counts).toEqual({ Done: 1, Todo: 1 });
    });

    it("resolves user-defined property with hash-suffixed ident (user.property/check-XXXX)", () => {
      // Real-graph shape: Logseq generates random suffixes on user-defined
      // property idents. Matcher must accept `/<name>-<suffix>` as a hit.
      const blocks = [
        {
          uuid: "1",
          tags: ["Checklist"],
          properties: { "user.property/check-F44tqsqr": true },
        },
        {
          uuid: "2",
          tags: ["Checklist"],
          properties: { "user.property/check-F44tqsqr": false },
        },
      ];
      const result = aggregate(blocks, checklistConfig);
      expect(result.total).toBe(2);
      expect(result.completed).toBe(1);
      expect(result.counts).toEqual({ Done: 1, Todo: 1 });
    });

    it("hash-suffix matcher does not over-match a longer property name", () => {
      // Looking up `check` must NOT match `check-version-XXXX`.
      const blocks = [
        {
          uuid: "1",
          tags: ["Checklist"],
          properties: { "user.property/check-version-AbCdEfGh": true },
        },
      ];
      const result = aggregate(blocks, checklistConfig);
      expect(result.total).toBe(0); // skipped — no `check` property found
    });

    it("falls back across ALL mapped properties when tags are empty", () => {
      // Real-graph case: tag resolution sometimes returns [] (DB graph
      // SDK shape). Aggregator must still find checkbox values by trying
      // each property in the mapping, not just the first one.
      const config: ProgressBarConfig = {
        ...DEFAULTS,
        tags: ["Task", "Checklist"],
        propertyMappings: { Task: "status", Checklist: "check" },
        completeValues: { status: ["Done"] },
      };
      const blocks = [
        {
          uuid: "1",
          tags: [], // tag resolution failed
          properties: { ":user.property/check-F44tqsqr": true },
        },
        {
          uuid: "2",
          tags: [],
          properties: { ":user.property/check-F44tqsqr": false },
        },
      ];
      const result = aggregate(blocks, config);
      expect(result.total).toBe(2);
      expect(result.completed).toBe(1);
      expect(result.counts).toEqual({ Done: 1, Todo: 1 });
    });

    it("prefers tag-matched property over fallback ones", () => {
      // If a block has a Task tag AND a check property, the Task→status
      // mapping wins. Status is missing → block is excluded; we don't
      // silently fall through to check.
      const config: ProgressBarConfig = {
        ...DEFAULTS,
        tags: ["Task", "Checklist"],
        propertyMappings: { Task: "status", Checklist: "check" },
        completeValues: { status: ["Done"] },
      };
      const blocks = [
        {
          uuid: "1",
          tags: ["Task"],
          properties: { ":user.property/check-F44tqsqr": true },
        },
      ];
      const result = aggregate(blocks, config);
      expect(result.total).toBe(0); // status missing, no fallback when tag matched
    });

    describe("inherited-default path (tag class-property)", () => {
      // Real-graph regression: a #Tido-tagged block whose Tido class declares
      // `check` as a class-property shows ☐ in the UI but doesn't have the
      // value stored. The plugin must default these to false / Todo so the
      // bar matches what the user sees.
      const inheritedConfig: ProgressBarConfig = {
        ...DEFAULTS,
        tags: ["Task", "Checklist"],
        propertyMappings: { Task: "status", Checklist: "check" },
        completeValues: { status: ["Done"] },
        resolvedIdents: { check: [":user.property/check-pgUd_nnQ"] },
        propertyTypes: { check: "checkbox" },
        tagClassProps: { tido: [":user.property/check-pgUd_nnQ"] },
      };

      it("counts a tagged-but-unset checkbox block as Todo", () => {
        const blocks = [
          { uuid: "1", tags: ["Tido"], properties: {} },
          {
            uuid: "2",
            tags: ["Tido"],
            properties: { ":user.property/check-pgUd_nnQ": true },
          },
          {
            uuid: "3",
            tags: [],
            properties: { ":user.property/check-pgUd_nnQ": false },
          },
        ];
        const result = aggregate(blocks, inheritedConfig);
        expect(result.total).toBe(3);
        expect(result.completed).toBe(1);
        expect(result.percent).toBe(33);
        expect(result.counts).toEqual({ Done: 1, Todo: 2 });
      });

      it("does not default-false untagged blocks (no tag => no inheritance)", () => {
        const blocks = [{ uuid: "1", tags: [], properties: {} }];
        const result = aggregate(blocks, inheritedConfig);
        expect(result.total).toBe(0);
      });

      it("does not default-false when the property is NOT checkbox-typed", () => {
        const config: ProgressBarConfig = {
          ...inheritedConfig,
          propertyTypes: { check: "default" },
        };
        const blocks = [{ uuid: "1", tags: ["Tido"], properties: {} }];
        const result = aggregate(blocks, config);
        expect(result.total).toBe(0);
      });

      it("does not default-false when the tag is unknown to the class-prop map", () => {
        const blocks = [{ uuid: "1", tags: ["UnknownTag"], properties: {} }];
        const result = aggregate(blocks, inheritedConfig);
        expect(result.total).toBe(0);
      });

      it("inheritance does not override an explicit value", () => {
        const blocks = [
          {
            uuid: "1",
            tags: ["Tido"],
            properties: { ":user.property/check-pgUd_nnQ": true },
          },
        ];
        const result = aggregate(blocks, inheritedConfig);
        expect(result.total).toBe(1);
        expect(result.completed).toBe(1);
      });

      it("tag matching is case-insensitive", () => {
        const blocks = [{ uuid: "1", tags: ["TIDO"], properties: {} }];
        const result = aggregate(blocks, inheritedConfig);
        expect(result.total).toBe(1);
        expect(result.counts).toEqual({ Todo: 1 });
      });
    });

    describe("resolved-idents path (identCache)", () => {
      it("matches the exact ident from cache, including underscores", () => {
        // Real-graph regression: the random suffix can contain `_`
        // (e.g. `pgUd_nnQ`). The legacy regex used [A-Za-z0-9]+ and missed
        // these. The cache path matches by exact ident so no character
        // class is in play.
        const config: ProgressBarConfig = {
          ...checklistConfig,
          resolvedIdents: { check: [":user.property/check-pgUd_nnQ"] },
        };
        const blocks = [
          {
            uuid: "1",
            tags: ["Checklist"],
            properties: { ":user.property/check-pgUd_nnQ": true },
          },
          {
            uuid: "2",
            tags: ["Checklist"],
            properties: { ":user.property/check-pgUd_nnQ": false },
          },
        ];
        const result = aggregate(blocks, config);
        expect(result.total).toBe(2);
        expect(result.completed).toBe(1);
        expect(result.counts).toEqual({ Done: 1, Todo: 1 });
      });

      it("matches when block key omits the leading colon", () => {
        const config: ProgressBarConfig = {
          ...checklistConfig,
          resolvedIdents: { check: [":user.property/check-pgUd_nnQ"] },
        };
        const blocks = [
          {
            uuid: "1",
            tags: ["Checklist"],
            properties: { "user.property/check-pgUd_nnQ": true },
          },
        ];
        const result = aggregate(blocks, config);
        expect(result.total).toBe(1);
        expect(result.completed).toBe(1);
      });

      it("does NOT over-match when cache resolves to a specific ident", () => {
        // Cache says check → :user.property/check-pgUd_nnQ. A block carrying
        // a *different* property tail (e.g. `check-version-AbCdEfGh`) must
        // be skipped — not silently caught by a regex.
        const config: ProgressBarConfig = {
          ...checklistConfig,
          resolvedIdents: { check: [":user.property/check-pgUd_nnQ"] },
        };
        const blocks = [
          {
            uuid: "1",
            tags: ["Checklist"],
            properties: { ":user.property/check-version-AbCdEfGh": true },
          },
        ];
        const result = aggregate(blocks, config);
        expect(result.total).toBe(0);
      });

      it("tries all idents when cache holds multiple (built-in + user)", () => {
        const config: ProgressBarConfig = {
          ...checklistConfig,
          resolvedIdents: {
            check: [":logseq.property/check", ":user.property/check-pgUd_nnQ"],
          },
        };
        const blocks = [
          {
            uuid: "1",
            tags: ["Checklist"],
            properties: { ":logseq.property/check": true },
          },
          {
            uuid: "2",
            tags: ["Checklist"],
            properties: { ":user.property/check-pgUd_nnQ": false },
          },
        ];
        const result = aggregate(blocks, config);
        expect(result.total).toBe(2);
        expect(result.completed).toBe(1);
      });

      it("falls back to regex when resolvedIdents is undefined", () => {
        // No cache (pre-init / cache-miss). Regex path still picks up
        // user.property/check-F44tqsqr like before.
        const blocks = [
          {
            uuid: "1",
            tags: ["Checklist"],
            properties: { "user.property/check-F44tqsqr": true },
          },
        ];
        const result = aggregate(blocks, checklistConfig);
        expect(result.total).toBe(1);
        expect(result.completed).toBe(1);
      });

      it("regex fallback now accepts underscores in suffix", () => {
        // The bug surfaced by `Check-pgUd_nnQ`. Even without the cache, the
        // widened regex must match underscore-bearing suffixes.
        const blocks = [
          {
            uuid: "1",
            tags: ["Checklist"],
            properties: { ":user.property/check-pgUd_nnQ": true },
          },
        ];
        const result = aggregate(blocks, checklistConfig);
        expect(result.total).toBe(1);
        expect(result.completed).toBe(1);
      });
    });

    it("excludes Tido-tagged children when Tido is not in the mapping", () => {
      // Documents current behavior: untagged-to-mapping blocks fall back to
      // first property ('check' here), and Tido children DO have `check`, so
      // they're actually counted. This locks in the inclusive-fallback rule.
      const blocks = [
        {
          uuid: "1",
          tags: ["Tido"],
          properties: { "user.property/check-F44tqsqr": true },
        },
      ];
      const result = aggregate(blocks, checklistConfig);
      expect(result.total).toBe(1);
      expect(result.completed).toBe(1);
    });
  });
});

describe("formatLabel", () => {
  const stats: StatusCounts = { counts: {}, total: 13, completed: 7, percent: 54 };

  it("formats percent", () => {
    expect(formatLabel(stats, "percent")).toBe("54%");
  });

  it("formats fraction", () => {
    expect(formatLabel(stats, "fraction")).toBe("7/13");
  });

  it("formats both", () => {
    expect(formatLabel(stats, "both")).toBe("7/13 · 54%");
  });

  it("handles zero percent", () => {
    const zero: StatusCounts = { counts: {}, total: 10, completed: 0, percent: 0 };
    expect(formatLabel(zero, "percent")).toBe("0%");
  });

  it("handles 100 percent", () => {
    const full: StatusCounts = { counts: {}, total: 10, completed: 10, percent: 100 };
    expect(formatLabel(full, "percent")).toBe("100%");
  });
});
