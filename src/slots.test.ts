import { describe, it, expect } from "vitest";
import { createSlotRegistry } from "./slots";

describe("slot registry", () => {
  it("tracks one entry per slot and replaces it on re-mount", () => {
    const slots = createSlotRegistry();
    slots.track("s1", [":progress-bar"], "u1");
    slots.track("s1", [":progress-bar", "depth: 1"], "u1");
    slots.track("s2", [":progress-bar"], "u2");
    expect(slots.size).toBe(2);
    expect(slots.entries().map((e) => e.args)).toEqual([[":progress-bar", "depth: 1"], [":progress-bar"]]);
  });

  it("only the latest render of a slot is current", () => {
    const slots = createSlotRegistry();
    slots.track("s1", [], "u1");
    const g1 = slots.begin("s1");
    const g2 = slots.begin("s1");
    expect(slots.isCurrent("s1", g1)).toBe(false);
    expect(slots.isCurrent("s1", g2)).toBe(true);
  });

  it("a forgotten or cleared slot is never current", () => {
    const slots = createSlotRegistry();
    slots.track("s1", [], "u1");
    const g = slots.begin("s1");
    slots.forget("s1");
    expect(slots.isCurrent("s1", g)).toBe(false);
    expect(slots.size).toBe(0);
    slots.track("s2", [], "u2");
    const g2 = slots.begin("s2");
    slots.clear();
    expect(slots.isCurrent("s2", g2)).toBe(false);
    expect(slots.entries()).toEqual([]);
  });
});
