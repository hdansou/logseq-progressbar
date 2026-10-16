import { describe, it, expect, beforeEach } from "vitest";
import { resolveConfig, readGlobalConfig, parseDepth, parseDisplayFormat, DEFAULTS, SETTINGS_SCHEMA } from "./settings";
import { _seedForTest, _clearForTest } from "./identCache";

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

  describe("resolvedIdents wiring", () => {
    beforeEach(() => _clearForTest());

    it("_property override pulls fresh idents from the cache", () => {
      _seedForTest({ byShortName: { state: [":user.property/state-AbCdEfGh"] } });
      const global = { ...DEFAULTS, tags: ["Project"] };
      const result = resolveConfig(global, { _property: "state" });
      expect(result.propertyMappings).toEqual({ Project: "state" });
      expect(result.resolvedIdents?.state).toEqual([
        ":user.property/state-AbCdEfGh",
      ]);
    });

    it("_property override carries through property type", () => {
      _seedForTest({
        byShortName: { check: [":user.property/check-pgUd_nnQ"] },
        typeByIdent: { ":user.property/check-pgUd_nnQ": "checkbox" },
      });
      const global = { ...DEFAULTS, tags: ["Project"] };
      const result = resolveConfig(global, { _property: "check" });
      expect(result.propertyTypes?.check).toBe("checkbox");
    });

    it("_property override is a no-op for resolvedIdents when cache misses", () => {
      const global = { ...DEFAULTS, tags: ["Project"] };
      const result = resolveConfig(global, { _property: "state" });
      // Field absent or empty — both signal aggregator to use regex.
      expect(result.resolvedIdents?.state ?? []).toEqual([]);
    });
  });
});

describe("readGlobalConfig — coercion of the raw settings record", () => {
  beforeEach(() => _clearForTest());

  it("returns DEFAULTS for an empty record", () => {
    const c = readGlobalConfig({});
    expect(c).toMatchObject({ ...DEFAULTS, resolvedIdents: {}, propertyTypes: {}, tagClassProps: {} });
  });

  it("splits and trims tagsInScope; blank falls back", () => {
    expect(readGlobalConfig({ tagsInScope: " Task , Bug,,Feature " }).tags).toEqual(["Task", "Bug", "Feature"]);
    expect(readGlobalConfig({ tagsInScope: "   " }).tags).toEqual(DEFAULTS.tags);
    expect(readGlobalConfig({ tagsInScope: 42 }).tags).toEqual(DEFAULTS.tags);
  });

  it("parses JSON mappings and drops entries of the wrong shape", () => {
    const c = readGlobalConfig({
      propertyMappings: '{"Task": "status", "Bad": 3, " Tido ": "check", "": "x"}',
      completeValues: '{"status": ["Done", "Canceled"], "state": "Completed", "x": [1]}',
    });
    expect(c.propertyMappings).toEqual({ Task: "status", Tido: "check" });
    expect(c.completeValues).toEqual({ status: ["Done", "Canceled"] });
  });

  it("falls back to defaults when JSON is invalid or not an object", () => {
    for (const bad of ["not json", "[1,2]", '"str"', "null", 7, undefined]) {
      const c = readGlobalConfig({ propertyMappings: bad, completeValues: bad });
      expect(c.propertyMappings).toEqual(DEFAULTS.propertyMappings);
      expect(c.completeValues).toEqual(DEFAULTS.completeValues);
    }
  });

  it("coerces depth: all / blank / 0 / negative / junk → unlimited, positive ints kept", () => {
    expect(readGlobalConfig({ defaultDepth: "all" }).depth).toBe(Infinity);
    expect(readGlobalConfig({ defaultDepth: "" }).depth).toBe(Infinity);
    expect(readGlobalConfig({ defaultDepth: "0" }).depth).toBe(Infinity);
    expect(readGlobalConfig({ defaultDepth: "-1" }).depth).toBe(Infinity);
    expect(readGlobalConfig({ defaultDepth: "abc" }).depth).toBe(Infinity);
    expect(readGlobalConfig({ defaultDepth: " 2 " }).depth).toBe(2);
    expect(readGlobalConfig({ defaultDepth: 3 }).depth).toBe(3);
    expect(readGlobalConfig({ defaultDepth: 0 }).depth).toBe(Infinity);
  });

  it("validates enum settings and keeps barWidth as a trimmed string", () => {
    expect(readGlobalConfig({ displayFormat: "BOTH" }).displayFormat).toBe("both");
    expect(readGlobalConfig({ displayFormat: "pie" }).displayFormat).toBe("percent");
    expect(readGlobalConfig({ barWidth: " compact " }).barWidth).toBe("compact");
    expect(readGlobalConfig({ barWidth: "" }).barWidth).toBe("full");
    expect(readGlobalConfig({ barWidth: 300 }).barWidth).toBe("full");
  });

  it("coerces booleans, including stringified ones from hand-edited files", () => {
    expect(readGlobalConfig({ strictTagFilter: true, showOnEmpty: "true" })).toMatchObject({ strict: true, showOnEmpty: true });
    expect(readGlobalConfig({ strictTagFilter: "false", showOnEmpty: "yes" })).toMatchObject({ strict: false, showOnEmpty: false });
  });

  it("snapshots resolved idents, types and class-properties from the cache", () => {
    _seedForTest({
      byShortName: { check: [":user.property/check-pgUd_nnQ"] },
      typeByIdent: { ":user.property/check-pgUd_nnQ": "checkbox" },
      classPropsByTag: { Tido: [":user.property/check-pgUd_nnQ"] },
    });
    const c = readGlobalConfig({});
    expect(c.resolvedIdents).toEqual({ check: [":user.property/check-pgUd_nnQ"] });
    expect(c.propertyTypes).toEqual({ check: "checkbox" });
    expect(c.tagClassProps).toEqual({ tido: ["user.property/check-pgUd_nnQ"] });
  });
});

describe("parseDepth / parseDisplayFormat", () => {
  it("are shared by settings and renderer args", () => {
    expect(parseDepth("4")).toBe(4);
    expect(parseDepth(2.7)).toBe(2);
    expect(parseDepth(null)).toBe(Infinity);
    expect(parseDisplayFormat(" Fraction ")).toBe("fraction");
    expect(parseDisplayFormat(1)).toBeNull();
  });
});

describe("SETTINGS_SCHEMA", () => {
  it("has no dead entries: every key is read by readGlobalConfig or the adapter", () => {
    const keys = SETTINGS_SCHEMA.filter((s) => s.type !== "heading").map((s) => s.key);
    expect(keys).toEqual([
      "tagsInScope", "propertyMappings", "completeValues", "defaultDepth", "strictTagFilter",
      "displayFormat", "barWidth", "showOnEmpty", "colorOverrides", "debug",
    ]);
    expect(keys).not.toContain("autoDetect");
  });
});
