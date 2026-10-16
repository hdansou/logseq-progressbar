import { describe, it, expect } from "vitest";
import { getStatusColor, buildSegments, parseColorOverrides, isSafeColor } from "./colors";

describe("getStatusColor", () => {
  it("returns default light color for Done", () => {
    expect(getStatusColor("Done", "light", {})).toBe("#4ade80");
  });

  it("returns default dark color for Done", () => {
    expect(getStatusColor("Done", "dark", {})).toBe("#22c55e");
  });

  it("returns fallback for unknown status", () => {
    expect(getStatusColor("CustomStatus", "light", {})).toBe("#d1d5db");
  });

  it("uses user override when provided", () => {
    const overrides = { done: { light: "#00ff00", dark: "#008800" } };
    expect(getStatusColor("Done", "light", overrides)).toBe("#00ff00");
  });

  it("is case-insensitive", () => {
    expect(getStatusColor("DONE", "light", {})).toBe("#4ade80");
    expect(getStatusColor("doing", "dark", {})).toBe("#3b82f6");
  });
});

describe("buildSegments", () => {
  it("builds sorted segments — completed first", () => {
    const counts = { Done: 3, Todo: 5, Doing: 2 };
    const completeValues = { status: ["Done"] };
    const segments = buildSegments(counts, 10, completeValues, "light", {});

    expect(segments[0].label).toBe("Done");
    expect(segments[0].isComplete).toBe(true);
    expect(segments[0].percent).toBe(30);
  });

  it("calculates percentages correctly", () => {
    const counts = { Done: 5, Todo: 5 };
    const segments = buildSegments(counts, 10, { status: ["Done"] }, "light", {});

    expect(segments[0].percent).toBe(50);
    expect(segments[1].percent).toBe(50);
  });

  it("handles empty counts", () => {
    const segments = buildSegments({}, 0, {}, "light", {});
    expect(segments).toEqual([]);
  });
});

describe("parseColorOverrides", () => {
  it("parses valid JSON", () => {
    const result = parseColorOverrides('{"Done": {"light": "#0f0", "dark": "#080"}}');
    expect(result.Done).toEqual({ light: "#0f0", dark: "#080" });
  });

  it("returns empty object for invalid JSON", () => {
    expect(parseColorOverrides("not json")).toEqual({});
  });

  it("returns empty object for non-string input", () => {
    expect(parseColorOverrides(null)).toEqual({});
    expect(parseColorOverrides(42)).toEqual({});
  });
});

describe("colour validation — the only way a colour reaches style=\"\"", () => {
  it("accepts hex, rgb()/hsl(), var(--x) and keywords", () => {
    for (const v of ["#abc", "#aabbcc", "#aabbccdd", "rgb(1, 2, 3)", "rgba(1,2,3,.5)", "hsl(120 50% 50% / 0.5)", "var(--ls-link-text-color)", "tomato"]) {
      expect(isSafeColor(v), v).toBe(true);
    }
  });
  it("rejects values that could break out of the declaration", () => {
    for (const v of ["#abc;color:red", "red}", "url(x)", "expression(1)", "rgb(1,2,3) !important", "", 7, null]) {
      expect(isSafeColor(v), String(v)).toBe(false);
    }
  });
  it("getStatusColor falls back to the neutral colour for an unsafe override", () => {
    expect(getStatusColor("Done", "light", { done: { light: "#fff;x", dark: "#000" } })).toBe("#d1d5db");
    expect(getStatusColor("Done", "dark", { done: { light: "#fff;x", dark: "#000" } })).toBe("#000");
  });
});

describe("parseColorOverrides — shape validation", () => {
  it("keeps only { light, dark } string pairs", () => {
    const raw = '{"Done": {"light": "#1", "dark": "#2"}, "Todo": "red", "Doing": {"light": "#3"}, "x": null}';
    expect(parseColorOverrides(raw)).toEqual({ Done: { light: "#1", dark: "#2" } });
  });
  it("returns {} for invalid JSON, arrays, non-strings", () => {
    expect(parseColorOverrides("nope")).toEqual({});
    expect(parseColorOverrides("[1]")).toEqual({});
    expect(parseColorOverrides("null")).toEqual({});
    expect(parseColorOverrides(undefined)).toEqual({});
  });
});
