import { describe, it, expect } from "vitest";
import { renderBar, renderEmpty } from "../renderer";
import type { BarSegment, StatusCounts, ProgressBarConfig } from "../types";
import { DEFAULTS } from "../config";

describe("renderBar", () => {
  const segments: BarSegment[] = [
    { label: "Done", count: 7, percent: 53.85, color: "#4ade80", isComplete: true },
    { label: "Doing", count: 2, percent: 15.38, color: "#60a5fa", isComplete: false },
    { label: "Todo", count: 4, percent: 30.77, color: "#e2e8f0", isComplete: false },
  ];
  const stats: StatusCounts = { counts: { Done: 7, Doing: 2, Todo: 4 }, total: 13, completed: 7, percent: 54 };

  it("renders HTML with segments", () => {
    const html = renderBar(segments, stats, DEFAULTS, "test-1");
    expect(html).toContain("pb-wrapper");
    expect(html).toContain("pb-bar");
    expect(html).toContain("pb-segment");
    expect(html).toContain("54%");
  });

  it("renders correct number of segments", () => {
    const html = renderBar(segments, stats, DEFAULTS, "test-2");
    const segmentCount = (html.match(/pb-segment/g) || []).length;
    expect(segmentCount).toBe(3);
  });

  it("returns empty string when total is 0 and showOnEmpty is false", () => {
    const emptyStats: StatusCounts = { counts: {}, total: 0, completed: 0, percent: 0 };
    const html = renderBar([], emptyStats, DEFAULTS, "test-3");
    expect(html).toBe("");
  });

  it("renders bar when total is 0 and showOnEmpty is true", () => {
    const config = { ...DEFAULTS, showOnEmpty: true };
    const emptyStats: StatusCounts = { counts: {}, total: 0, completed: 0, percent: 0 };
    const html = renderBar([], emptyStats, config, "test-4");
    expect(html).toContain("pb-wrapper");
    expect(html).toContain("0%");
  });

  it("renders fraction format", () => {
    const config = { ...DEFAULTS, displayFormat: "fraction" as const };
    const html = renderBar(segments, stats, config, "test-5");
    expect(html).toContain("7/13");
  });

  it("renders both format", () => {
    const config = { ...DEFAULTS, displayFormat: "both" as const };
    const html = renderBar(segments, stats, config, "test-6");
    expect(html).toContain("7/13");
    expect(html).toContain("54%");
  });

  it("includes tooltip text", () => {
    const html = renderBar(segments, stats, DEFAULTS, "test-7");
    expect(html).toContain("Done: 7");
    expect(html).toContain("Total: 13");
  });

  it("applies compact width", () => {
    const config = { ...DEFAULTS, barWidth: "200px" };
    const html = renderBar(segments, stats, config, "test-8");
    expect(html).toContain("width:200px");
  });
});

describe("renderEmpty", () => {
  it("renders empty state with message", () => {
    const html = renderEmpty("No items", "test-e1");
    expect(html).toContain("pb-empty");
    expect(html).toContain("No items");
  });
});
