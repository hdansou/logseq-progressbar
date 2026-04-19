import { describe, it, expect } from "vitest";
import { classifyQuery } from "../query";

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
