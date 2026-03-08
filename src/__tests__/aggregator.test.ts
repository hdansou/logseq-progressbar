import { describe, it, expect } from "vitest";
import { aggregate, formatLabel } from "../aggregator";
import { DEFAULTS } from "../config";
import type { ProgressBarConfig, StatusCounts } from "../types";

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
