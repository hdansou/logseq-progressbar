import { describe, it, expect } from "vitest";
import { entityToBlockData } from "../query";

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
