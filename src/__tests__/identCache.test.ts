import { describe, it, expect, beforeEach } from "vitest";
import {
  _seedForTest,
  _clearForTest,
  lookup,
  lookupType,
  isClassProperty,
  getAllClassProps,
  clear,
  buildIndexes,
} from "../identCache";

describe("identCache", () => {
  beforeEach(() => {
    _clearForTest();
  });

  describe("lookup / seed / clear", () => {
    it("returns [] for unseeded names", () => {
      expect(lookup("check")).toEqual([]);
    });

    it("returns seeded idents (lowercased key)", () => {
      _seedForTest({ byShortName: { check: [":user.property/check-pgUd_nnQ"] } });
      expect(lookup("check")).toEqual([":user.property/check-pgUd_nnQ"]);
      expect(lookup("CHECK")).toEqual([":user.property/check-pgUd_nnQ"]);
    });

    it("clear() empties the cache", () => {
      _seedForTest({ byShortName: { check: [":user.property/check-pgUd_nnQ"] } });
      clear();
      expect(lookup("check")).toEqual([]);
    });
  });

  describe("lookupType", () => {
    it("returns null when ident is unknown", () => {
      expect(lookupType(":user.property/check-pgUd_nnQ")).toBeNull();
    });

    it("returns the type when seeded (colon-agnostic)", () => {
      _seedForTest({
        typeByIdent: { ":user.property/check-pgUd_nnQ": "checkbox" },
      });
      expect(lookupType(":user.property/check-pgUd_nnQ")).toBe("checkbox");
      expect(lookupType("user.property/check-pgUd_nnQ")).toBe("checkbox");
    });
  });

  describe("isClassProperty + getAllClassProps", () => {
    it("returns false when tag is unknown", () => {
      expect(isClassProperty("Tido", ":user.property/check-pgUd_nnQ")).toBe(false);
    });

    it("returns true when tag declares the property as a class-property", () => {
      _seedForTest({
        classPropsByTag: { Tido: [":user.property/check-pgUd_nnQ"] },
      });
      expect(isClassProperty("Tido", ":user.property/check-pgUd_nnQ")).toBe(true);
      expect(isClassProperty("tido", "user.property/check-pgUd_nnQ")).toBe(true);
    });

    it("getAllClassProps copies the cache (returns string arrays)", () => {
      _seedForTest({
        classPropsByTag: {
          Tido: [":user.property/check-pgUd_nnQ"],
          Task: [":logseq.property/status"],
        },
      });
      const all = getAllClassProps();
      expect(all.tido).toEqual(["user.property/check-pgUd_nnQ"]);
      expect(all.task).toEqual(["logseq.property/status"]);
    });
  });

  describe("buildIndexes", () => {
    it("returns empty maps for non-array input", () => {
      const { titleIndex, tailIndex, typeByIdent, classPropsByTag } =
        buildIndexes(null, null);
      expect(titleIndex.size).toBe(0);
      expect(tailIndex.size).toBe(0);
      expect(typeByIdent.size).toBe(0);
      expect(classPropsByTag.size).toBe(0);
    });

    it("indexes a user property by both title and stripped tail", () => {
      const propRows = [[":user.property/check-pgUd_nnQ", "check", "checkbox"]];
      const { titleIndex, tailIndex } = buildIndexes(propRows, null);
      expect(titleIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
      expect(tailIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
      // The full tail is also indexed so identical lookups by raw tail work.
      expect(tailIndex.get("check-pgud_nnq")).toEqual([
        ":user.property/check-pgUd_nnQ",
      ]);
    });

    it("captures property type (colon-prefixed keyword strings)", () => {
      const propRows = [[":user.property/check-pgUd_nnQ", "check", ":checkbox"]];
      const { typeByIdent } = buildIndexes(propRows, null);
      expect(typeByIdent.get("user.property/check-pgUd_nnQ")).toBe("checkbox");
    });

    it("indexes a built-in property by tail (no title)", () => {
      const propRows = [[":logseq.property/status", "", "default"]];
      const { titleIndex, tailIndex } = buildIndexes(propRows, null);
      expect(titleIndex.size).toBe(0);
      expect(tailIndex.get("status")).toEqual([":logseq.property/status"]);
    });

    it("preserves multiple idents for the same friendly name", () => {
      const propRows = [
        [":user.property/check-pgUd_nnQ", "check", "checkbox"],
        [":logseq.property/check", "", "checkbox"],
      ];
      const { titleIndex, tailIndex } = buildIndexes(propRows, null);
      expect(titleIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
      expect(tailIndex.get("check")?.sort()).toEqual(
        [":logseq.property/check", ":user.property/check-pgUd_nnQ"].sort()
      );
    });

    it("indexes class-property memberships by tag title (lowercased)", () => {
      const classRows = [
        [":user.property/check-pgUd_nnQ", "Tido"],
        [":logseq.property/status", "Task"],
      ];
      const { classPropsByTag } = buildIndexes(null, classRows);
      expect(classPropsByTag.get("tido")).toEqual(
        new Set(["user.property/check-pgUd_nnQ"])
      );
      expect(classPropsByTag.get("task")).toEqual(
        new Set(["logseq.property/status"])
      );
    });

    it("supports a tag declaring multiple class-properties", () => {
      const classRows = [
        [":user.property/check-pgUd_nnQ", "Tido"],
        [":user.property/priority-XYZ123", "Tido"],
      ];
      const { classPropsByTag } = buildIndexes(null, classRows);
      expect(classPropsByTag.get("tido")?.size).toBe(2);
    });

    it("ignores malformed class rows", () => {
      const classRows = [[null, "Tido"], [":user.property/x", ""], "garbage"];
      const { classPropsByTag } = buildIndexes(null, classRows);
      expect(classPropsByTag.size).toBe(0);
    });

    it("normalizes string idents missing the leading colon", () => {
      const propRows = [["user.property/check-pgUd_nnQ", "check", "checkbox"]];
      const { titleIndex } = buildIndexes(propRows, null);
      expect(titleIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
    });

    it("trims whitespace from title", () => {
      const propRows = [
        [":user.property/check-pgUd_nnQ", "  check  ", "checkbox"],
      ];
      const { titleIndex } = buildIndexes(propRows, null);
      expect(titleIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
    });
  });
});
