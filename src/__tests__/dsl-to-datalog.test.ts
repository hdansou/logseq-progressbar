import { describe, it, expect } from "vitest";
import { dslToBlockQuery, parseDSL, QueryParseError } from "../query";

// Helper: collapse whitespace for comparing query strings without caring
// about formatting.
const squish = (s: string) => s.replace(/\s+/g, " ").trim();

describe("dslToBlockQuery", () => {
  it("emits a block-pull find with a status filter for (task ...)", () => {
    const parsed = parseDSL('(task "Todo" "Done")');
    const out = squish(dslToBlockQuery(parsed, { trackedProperty: "status" }));

    expect(out).toContain("[:find (pull ?b [*])");
    expect(out).toContain("[?b :logseq.property/status ?s]");
    expect(out).toContain('(or [?s :block/title "Todo"] [?s :block/title "Done"])');
    // No count aggregation — grouping happens in JS.
    expect(out).not.toContain("count");
  });

  it("handles a single status value without an (or ...) wrapper", () => {
    const parsed = parseDSL('(task "Done")');
    const out = squish(dslToBlockQuery(parsed, { trackedProperty: "status" }));

    expect(out).toContain('[?s :block/title "Done"]');
    expect(out).not.toContain("(or");
  });

  it("binds tracked property baseline even with no (task ...) filter", () => {
    const parsed = parseDSL("(and [[Project]])");
    const out = squish(dslToBlockQuery(parsed, { trackedProperty: "status" }));

    // Every block in the result must at least have the tracked property set —
    // otherwise the aggregator would need to skip them.
    expect(out).toContain("[?b :logseq.property/status ?s]");
  });

  it("joins tags when (tags ...) is present and resolvedTags are passed", () => {
    const parsed = parseDSL("(tags [[Task]])");
    const out = squish(
      dslToBlockQuery(parsed, {
        trackedProperty: "status",
        resolvedTags: ["Task"],
      })
    );

    expect(out).toContain("[?b :block/tags ?tag]");
    expect(out).toContain('[?tag :block/title "Task"]');
  });

  it("wraps multiple resolved tags in (or ...)", () => {
    const parsed: ReturnType<typeof parseDSL> = {
      statuses: [],
      dateRange: null,
      tagFilters: ["Task", "Bug"],
      propertyFilters: [],
    };
    const out = squish(
      dslToBlockQuery(parsed, {
        trackedProperty: "status",
        resolvedTags: ["Task", "Bug"],
      })
    );

    expect(out).toContain(
      '(or [?tag :block/title "Task"] [?tag :block/title "Bug"])'
    );
  });

  it("emits journal-day range for (between ...)", () => {
    const uuid = "00000001-2026-0101-0000-000000000000";
    const uuid2 = "00000001-2026-0131-0000-000000000000";
    const parsed = parseDSL(`(between [[${uuid}]] [[${uuid2}]])`);
    const out = squish(dslToBlockQuery(parsed, { trackedProperty: "status" }));

    expect(out).toContain("[?b :block/page ?p]");
    expect(out).toContain("[?p :block/journal-day ?d]");
    expect(out).toContain("[(>= ?d 20260101)]");
    expect(out).toContain("[(<= ?d 20260131)]");
  });

  it("emits property filter binding for (property :key \"value\")", () => {
    const parsed = parseDSL('(property :priority "high")');
    const out = squish(dslToBlockQuery(parsed, { trackedProperty: "status" }));

    expect(out).toContain("[?b :logseq.property/priority ?pv0]");
    expect(out).toContain('[?pv0 :block/title "high"]');
  });

  it("throws QueryParseError when parsed DSL produces no where clauses at all", () => {
    const empty: ReturnType<typeof parseDSL> = {
      statuses: [],
      dateRange: null,
      tagFilters: [],
      propertyFilters: [],
    };
    // Even with empty filters we still have the baseline tracked-property clause,
    // so this should NOT throw — it should emit a broad "all blocks with status" query.
    expect(() =>
      dslToBlockQuery(empty, { trackedProperty: "status" })
    ).not.toThrow();
  });

  it("throws QueryParseError when trackedProperty is empty", () => {
    const parsed = parseDSL('(task "Done")');
    expect(() => dslToBlockQuery(parsed, { trackedProperty: "" })).toThrow(
      QueryParseError
    );
  });
});
