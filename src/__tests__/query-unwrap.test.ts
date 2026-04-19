import { describe, it, expect } from "vitest";
import { extractDatalogVector, QueryParseError } from "../query";

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
