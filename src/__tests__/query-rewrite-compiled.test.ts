import { describe, it, expect } from "vitest";
import { rewriteCompiledDsl } from "../query";

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
