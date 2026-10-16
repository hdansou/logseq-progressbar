import { describe, it, expect } from "vitest";
import {
  classifyQuery,
  dslToBlockQuery,
  enrichPull,
  entityToBlockData,
  extractDatalogVector,
  parseDSL,
  QueryParseError,
  rewriteCompiledDsl,
} from "./query";

describe("classifyQuery", () => {
  it("classifies DSL queries by leading '('", () => {
    expect(classifyQuery('(task "Todo" "Done")')).toBe("dsl");
  });

  it("classifies datalog map by leading '{'", () => {
    expect(
      classifyQuery("{:query [:find (pull ?b [*]) :where [?b :logseq.property/status ?s]]}")
    ).toBe("datalog-map");
  });

  it("classifies bare datalog vector by leading '['", () => {
    expect(classifyQuery("[:find (pull ?b [*]) :where [?b :logseq.property/status ?s]]")).toBe(
      "datalog-vec"
    );
  });

  it("tolerates leading whitespace and newlines", () => {
    expect(classifyQuery("  \n  [:find (pull ?b [*])]")).toBe("datalog-vec");
    expect(classifyQuery("\t{:query [...]}")).toBe("datalog-map");
    expect(classifyQuery("\n\n(task \"Todo\")")).toBe("dsl");
  });

  it("returns 'empty' for empty or whitespace-only input", () => {
    expect(classifyQuery("")).toBe("empty");
    expect(classifyQuery("   \n\t  ")).toBe("empty");
  });

  it("returns 'unknown' for anything else", () => {
    expect(classifyQuery("garbage")).toBe("unknown");
    expect(classifyQuery(":find (pull ?b [*])")).toBe("unknown");
  });
});


describe("extractDatalogVector", () => {
  it("unwraps a simple {:query [...]} map", () => {
    const raw =
      "{:query [:find (pull ?b [*]) :where [?b :logseq.property/status ?s]]}";
    expect(extractDatalogVector(raw)).toBe(
      "[:find (pull ?b [*]) :where [?b :logseq.property/status ?s]]"
    );
  });

  it("ignores :inputs and any other keys (YAGNI)", () => {
    const raw =
      "{:query [:find (pull ?b [*]) :where [?b :block/page ?p]] :inputs [:today]}";
    expect(extractDatalogVector(raw)).toBe(
      "[:find (pull ?b [*]) :where [?b :block/page ?p]]"
    );
  });

  it("preserves nested brackets and whitespace byte-for-byte (user's original example)", () => {
    const inner = `[:find (pull ?b [*])
         :where
         [?b :logseq.property/status ?s]
         (or [?s :db/ident :logseq.property/status.todo]
             [?s :db/ident :logseq.property/status.doing]
             [?s :db/ident :logseq.property/status.done])]`;
    const raw = `{:query ${inner}}`;
    expect(extractDatalogVector(raw)).toBe(inner);
  });

  it("handles leading whitespace before the map", () => {
    const raw = "  \n  {:query [:find ?b :where [?b :block/uuid ?u]]}";
    expect(extractDatalogVector(raw)).toBe(
      "[:find ?b :where [?b :block/uuid ?u]]"
    );
  });

  it("throws QueryParseError when :query key is missing", () => {
    expect(() => extractDatalogVector("{:find [:find ?b]}")).toThrow(
      QueryParseError
    );
  });

  it("throws QueryParseError when the :query value is not a vector", () => {
    expect(() => extractDatalogVector("{:query \"oops\"}")).toThrow(
      QueryParseError
    );
  });

  it("throws QueryParseError when brackets are unbalanced", () => {
    expect(() => extractDatalogVector("{:query [:find (pull ?b [*])")).toThrow(
      QueryParseError
    );
  });
});


// Helper: collapse whitespace for comparing query strings without caring
// about formatting.
const squish = (s: string) => s.replace(/\s+/g, " ").trim();

describe("dslToBlockQuery", () => {
  it("emits a block-pull find with a status filter for (task ...)", () => {
    const parsed = parseDSL('(task "Todo" "Done")');
    const out = squish(dslToBlockQuery(parsed, { trackedProperty: "status" }));

    expect(out).toContain("[:find (pull ?b [:block/uuid");
    expect(out).toContain("{:logseq.property/status [:block/title]}");
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


describe("enrichPull", () => {
  it("expands (pull ?b [*]) to include ref-resolution hints for the tracked property", () => {
    const datalog = "[:find (pull ?b [*]) :where [?b :logseq.property/status ?s]]";
    const out = enrichPull(datalog, "status");
    expect(out).toContain(
      "(pull ?b [* {:block/tags [:block/title]} {:logseq.property/status [:block/title]}])"
    );
    // Rest of query is preserved
    expect(out).toContain("[?b :logseq.property/status ?s]");
  });

  it("expands the user's original bug-report query end-to-end", () => {
    const datalog = `[:find (pull ?b [*])
       :where
       [?b :logseq.property/status ?s]
       (or [?s :db/ident :logseq.property/status.todo]
           [?s :db/ident :logseq.property/status.doing]
           [?s :db/ident :logseq.property/status.done])]`;
    const out = enrichPull(datalog, "status");
    expect(out).toContain("{:logseq.property/status [:block/title]}");
    // or-clause preserved
    expect(out).toContain(":logseq.property/status.todo");
    expect(out).toContain(":logseq.property/status.done");
  });

  it("handles arbitrary pull variables (not just ?b)", () => {
    const datalog = "[:find (pull ?task [*]) :where [?task :logseq.property/status ?s]]";
    const out = enrichPull(datalog, "status");
    expect(out).toContain("(pull ?task [*");
    expect(out).toContain("{:logseq.property/status [:block/title]}");
  });

  it("is a no-op if the pull spec does not use [*] wildcard", () => {
    // If the user already wrote an explicit pull spec, leave it alone —
    // we can't safely merge without a real EDN parser (YAGNI).
    const datalog =
      "[:find (pull ?b [:block/uuid :block/title]) :where [?b :logseq.property/status ?s]]";
    const out = enrichPull(datalog, "status");
    expect(out).toBe(datalog);
  });

  it("is a no-op if there is no (pull …) at all", () => {
    const datalog = "[:find ?b :where [?b :logseq.property/status ?s]]";
    const out = enrichPull(datalog, "status");
    expect(out).toBe(datalog);
  });
});


describe("entityToBlockData", () => {
  it("extracts uuid, tag titles, and ref-typed property values", () => {
    const entity = {
      "block/uuid": "11111111-1111-1111-1111-111111111111",
      "block/title": "Ship the thing",
      "block/tags": [
        { "db/id": 42, "block/title": "Task" },
        { "db/id": 43, "block/title": "Urgent" },
      ],
      "logseq.property/status": { "db/id": 99, "block/title": "Done" },
    };

    const bd = entityToBlockData(entity);
    expect(bd).not.toBeNull();
    expect(bd!.uuid).toBe("11111111-1111-1111-1111-111111111111");
    expect(bd!.tags).toEqual(["Task", "Urgent"]);
    // Resolve refs to their :block/title at the adapter boundary so the
    // aggregator keeps working with plain strings — no datascript-shape awareness.
    expect(bd!.properties["logseq.property/status"]).toBe("Done");
  });

  it("preserves plain-string property values", () => {
    const entity = {
      "block/uuid": "22222222-2222-2222-2222-222222222222",
      "logseq.property/status": "Todo",
    };

    const bd = entityToBlockData(entity);
    expect(bd!.properties["logseq.property/status"]).toBe("Todo");
  });

  it("returns tags: [] when the entity has no :block/tags", () => {
    const entity = {
      "block/uuid": "33333333-3333-3333-3333-333333333333",
      "logseq.property/status": "Doing",
    };
    const bd = entityToBlockData(entity);
    expect(bd!.tags).toEqual([]);
  });

  it("returns null when the entity has no uuid", () => {
    const entity = {
      "block/title": "Orphan",
      "logseq.property/status": "Done",
    };
    expect(entityToBlockData(entity)).toBeNull();
  });

  it("returns null for non-object inputs", () => {
    expect(entityToBlockData(null)).toBeNull();
    expect(entityToBlockData(undefined)).toBeNull();
    expect(entityToBlockData("not an entity")).toBeNull();
    expect(entityToBlockData(42)).toBeNull();
  });

  it("accepts de-namespaced key shape (plain 'uuid'/'tags') from Logseq JSON normalization", () => {
    // Real datascriptQuery output after normalize-keyword-for-json strips
    // block/ prefixes from common keys. Status ref arrives as either a nested
    // resolved {block/title} (when pull pattern resolves it) or a stub {id}.
    const entity = {
      uuid: "55555555-5555-5555-5555-555555555555",
      title: "Ship the thing",
      tags: [{ "block/title": "Task" }],
      ":logseq.property/status": { "block/title": "Done" },
    };
    const bd = entityToBlockData(entity);
    expect(bd!.uuid).toBe("55555555-5555-5555-5555-555555555555");
    expect(bd!.tags).toEqual(["Task"]);
    expect(bd!.properties["logseq.property/status"]).toBe("Done");
  });

  it("tolerates leading-colon key shape (':block/uuid') as a fallback", () => {
    // Some Logseq code paths still emit keyword-prefixed keys. Defensive but small.
    const entity = {
      ":block/uuid": "44444444-4444-4444-4444-444444444444",
      ":block/tags": [{ ":block/title": "Bug" }],
      ":logseq.property/status": { ":block/title": "Done" },
    };
    const bd = entityToBlockData(entity);
    expect(bd!.uuid).toBe("44444444-4444-4444-4444-444444444444");
    expect(bd!.tags).toEqual(["Bug"]);
  });
});


describe("rewriteCompiledDsl", () => {
  it("rewrites the user's failing query (compiled (task) form)", () => {
    const datalog = `[:find (pull ?b [* {:block/tags [:block/title]} {:logseq.property/status [:block/title]}])
 :in $ %
 :where
 (task ?b #{"Canceled" "Done" "In Review" "Doing" "Todo" "Backlog"})]`;
    const result = rewriteCompiledDsl(datalog);
    expect(result).not.toBeNull();
    // Round-tripped DSL — order of statuses matches the set order as parsed.
    expect(result).toContain("(task");
    expect(result).toContain('"Done"');
    expect(result).toContain('"Todo"');
    expect(result).toContain('"Canceled"');
  });

  it("tolerates different variable names", () => {
    const datalog = `[:where (task ?block #{"Done"})]`;
    expect(rewriteCompiledDsl(datalog)).toBe('(task "Done")');
  });

  it("tolerates whitespace around the rule call", () => {
    const datalog = `[:where (  task   ?b   #{ "Done"  "Todo" }  )]`;
    const result = rewriteCompiledDsl(datalog);
    expect(result).toContain("(task");
    expect(result).toContain('"Done"');
    expect(result).toContain('"Todo"');
  });

  it("returns null when there is no (task ?v #{...}) rule call", () => {
    const datalog = `[:find (pull ?b [*]) :where [?b :block/title ?t]]`;
    expect(rewriteCompiledDsl(datalog)).toBeNull();
  });

  it("returns null for an empty status set", () => {
    expect(rewriteCompiledDsl(`[:where (task ?b #{})]`)).toBeNull();
  });

  it("returns null for plain DSL (not datalog)", () => {
    expect(rewriteCompiledDsl(`(task "Done" "Todo")`)).toBeNull();
  });
});
