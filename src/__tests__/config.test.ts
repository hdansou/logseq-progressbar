import { describe, it, expect } from "vitest";
import { resolveConfig, DEFAULTS } from "../config";

describe("resolveConfig", () => {
  it("returns global config when no overrides", () => {
    const result = resolveConfig(DEFAULTS, {});
    expect(result).toEqual(DEFAULTS);
  });

  it("overrides tags", () => {
    const result = resolveConfig(DEFAULTS, { tags: ["Bug", "Feature"] });
    expect(result.tags).toEqual(["Bug", "Feature"]);
    expect(result.depth).toBe(DEFAULTS.depth); // unchanged
  });

  it("overrides depth", () => {
    const result = resolveConfig(DEFAULTS, { depth: 2 });
    expect(result.depth).toBe(2);
  });

  it("overrides strict mode", () => {
    const result = resolveConfig(DEFAULTS, { strict: true });
    expect(result.strict).toBe(true);
  });

  it("overrides displayFormat", () => {
    const result = resolveConfig(DEFAULTS, { displayFormat: "both" });
    expect(result.displayFormat).toBe("both");
  });

  it("overrides barWidth", () => {
    const result = resolveConfig(DEFAULTS, { barWidth: "300px" });
    expect(result.barWidth).toBe("300px");
  });

  it("sets queryUUID", () => {
    const result = resolveConfig(DEFAULTS, { queryUUID: "abc-123" });
    expect(result.queryUUID).toBe("abc-123");
  });

  it("_property override applies to all tags", () => {
    const global = { ...DEFAULTS, tags: ["Task", "Bug"] };
    const result = resolveConfig(global, { _property: "state" });
    expect(result.propertyMappings).toEqual({ Task: "state", Bug: "state" });
  });

  it("_complete override applies to all properties", () => {
    const global = {
      ...DEFAULTS,
      propertyMappings: { Task: "status" },
    };
    const result = resolveConfig(global, {
      _complete: ["Done", "Canceled"],
    });
    expect(result.completeValues).toEqual({ status: ["Done", "Canceled"] });
  });

  it("partial override preserves other fields", () => {
    const result = resolveConfig(DEFAULTS, { strict: true, depth: 3 });
    expect(result.strict).toBe(true);
    expect(result.depth).toBe(3);
    expect(result.tags).toEqual(DEFAULTS.tags);
    expect(result.displayFormat).toBe(DEFAULTS.displayFormat);
  });
});
