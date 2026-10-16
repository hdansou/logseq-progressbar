import { describe, it, expect } from "vitest";
import { renderBar, renderEmpty, renderError, cssWidth, PLUGIN_CSS } from "./renderer";
import type { BarSegment, StatusCounts, ProgressBarConfig } from "./types";
import { DEFAULTS } from "./settings";

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

describe("cssWidth — the only way a width reaches style=\"\"", () => {
  it("maps the two named modes", () => {
    expect(cssWidth("full")).toBe("100%");
    expect(cssWidth("compact")).toBe("200px");
    expect(cssWidth(" Compact ")).toBe("200px");
  });
  it("accepts plain CSS lengths and percentages", () => {
    for (const v of ["200px", "12.5em", "50%", "3rem", "40ch", "30vw"]) expect(cssWidth(v)).toBe(v);
  });
  it("rejects anything that could escape the declaration", () => {
    for (const v of ["200px;color:red", "100%}", "calc(100% - 1px)", "url(x)", "", undefined, 42, "px"]) {
      expect(cssWidth(v)).toBe("100%");
    }
  });
});

describe("escaping of graph-derived text", () => {
  const seg: BarSegment[] = [{ label: '<b onmouseover="x">&"\'', count: 1, percent: 100, color: "#000", isComplete: true }];
  const one: StatusCounts = { counts: { x: 1 }, total: 1, completed: 1, percent: 100 };

  it("escapes status labels in data attributes and the tooltip", () => {
    const html = renderBar(seg, one, DEFAULTS, "pb-1");
    expect(html).not.toContain("<b ");
    expect(html).toContain("&lt;b onmouseover=&quot;x&quot;&gt;&amp;&quot;&#39;");
    expect(html).toContain("&#10;");
  });

  it("escapes the instance id, error and empty messages", () => {
    expect(renderError('<script>"', 'x"y')).toBe('<div class="pb-error" data-id="x&quot;y">&lt;script&gt;&quot;</div>');
    expect(renderEmpty("<i>", "id", "300px")).toContain("&lt;i&gt;");
    expect(renderEmpty("m", "id", "300px")).toContain("width:300px");
    expect(renderEmpty("m", "id")).toContain("width:100%");
  });

  it("falls back to full width for an unsafe barWidth", () => {
    const html = renderBar(seg, one, { ...DEFAULTS, barWidth: "1px;background:url(x)" }, "pb-1");
    expect(html).toContain('style="width:100%"');
  });
});

describe("PLUGIN_CSS", () => {
  it("has no dead rules left over from earlier versions", () => {
    expect(PLUGIN_CSS).not.toContain("pb-full-width");
    expect(PLUGIN_CSS).toContain(".pb-wrapper");
    expect(PLUGIN_CSS).toContain(".pb-error");
  });
});
