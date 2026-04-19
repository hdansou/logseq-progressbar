import { describe, it, expect } from "vitest";
import { enrichPull } from "../query";

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
