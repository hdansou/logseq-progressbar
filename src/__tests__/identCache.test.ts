import { describe, it, expect, beforeEach } from "vitest";
import {
  _seedForTest,
  _clearForTest,
  lookup,
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
      _seedForTest({ check: [":user.property/check-pgUd_nnQ"] });
      expect(lookup("check")).toEqual([":user.property/check-pgUd_nnQ"]);
      expect(lookup("CHECK")).toEqual([":user.property/check-pgUd_nnQ"]);
    });

    it("clear() empties the cache", () => {
      _seedForTest({ check: [":user.property/check-pgUd_nnQ"] });
      clear();
      expect(lookup("check")).toEqual([]);
    });
  });

  describe("buildIndexes", () => {
    it("returns empty maps for non-array input", () => {
      const { titleIndex, tailIndex } = buildIndexes(null);
      expect(titleIndex.size).toBe(0);
      expect(tailIndex.size).toBe(0);
    });

    it("indexes a user property by both title and stripped tail", () => {
      const rows = [[":user.property/check-pgUd_nnQ", "check"]];
      const { titleIndex, tailIndex } = buildIndexes(rows);
      expect(titleIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
      expect(tailIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
      // The full tail is also indexed so identical lookups by raw tail work.
      expect(tailIndex.get("check-pgud_nnq")).toEqual([
        ":user.property/check-pgUd_nnQ",
      ]);
    });

    it("indexes a built-in property by tail (no title)", () => {
      const rows = [[":logseq.property/status", ""]];
      const { titleIndex, tailIndex } = buildIndexes(rows);
      expect(titleIndex.size).toBe(0);
      expect(tailIndex.get("status")).toEqual([":logseq.property/status"]);
    });

    it("dedupes when title and tail collapse to same key", () => {
      const rows = [[":user.property/check-pgUd_nnQ", "check"]];
      const { titleIndex, tailIndex } = buildIndexes(rows);
      expect(titleIndex.get("check")?.length).toBe(1);
      expect(tailIndex.get("check")?.length).toBe(1);
    });

    it("preserves multiple idents for the same friendly name", () => {
      const rows = [
        [":user.property/check-pgUd_nnQ", "check"],
        [":logseq.property/check", ""],
      ];
      const { titleIndex, tailIndex } = buildIndexes(rows);
      // Title only matches the user property
      expect(titleIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
      // Tail matches both (the user property's stripped tail is also "check")
      expect(tailIndex.get("check")?.sort()).toEqual(
        [":logseq.property/check", ":user.property/check-pgUd_nnQ"].sort()
      );
    });

    it("does NOT strip suffix from short hyphenated names like 'next-action'", () => {
      // Suffix-strip regex requires 6-12 alphanumeric+_ chars after `-`.
      // "action" is 6 chars — this is the conservative trade-off documented
      // in identCache. Real property names hit by this should be looked up
      // by exact title, which IS indexed.
      const rows = [[":user.property/next-action", "next-action"]];
      const { titleIndex } = buildIndexes(rows);
      expect(titleIndex.get("next-action")).toEqual([
        ":user.property/next-action",
      ]);
    });

    it("normalizes string idents missing the leading colon", () => {
      const rows = [["user.property/check-pgUd_nnQ", "check"]];
      const { titleIndex } = buildIndexes(rows);
      expect(titleIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
    });

    it("ignores rows with no ident", () => {
      const rows = [[null, "check"], [42, "x"], [[], "y"]];
      const { titleIndex, tailIndex } = buildIndexes(rows);
      expect(titleIndex.size).toBe(0);
      expect(tailIndex.size).toBe(0);
    });

    it("trims whitespace from title", () => {
      const rows = [[":user.property/check-pgUd_nnQ", "  check  "]];
      const { titleIndex } = buildIndexes(rows);
      expect(titleIndex.get("check")).toEqual([":user.property/check-pgUd_nnQ"]);
    });
  });
});
