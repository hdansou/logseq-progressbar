import { describe, it, expect } from "vitest";
import { parseRendererArgs, parsePipeList } from "../parser";

describe("parsePipeList", () => {
  it("parses single value", () => {
    expect(parsePipeList("Task")).toEqual(["Task"]);
  });

  it("parses multiple pipe-delimited values", () => {
    expect(parsePipeList("Task|Bug|Feature")).toEqual(["Task", "Bug", "Feature"]);
  });

  it("trims whitespace", () => {
    expect(parsePipeList(" Task | Bug ")).toEqual(["Task", "Bug"]);
  });

  it("filters empty strings", () => {
    expect(parsePipeList("Task||Bug")).toEqual(["Task", "Bug"]);
  });
});

describe("parseRendererArgs", () => {
  it("returns empty overrides for renderer type only", () => {
    const result = parseRendererArgs([":progress-bar"]);
    expect(result).toEqual({});
  });

  it("parses tags", () => {
    const result = parseRendererArgs([":progress-bar", "tags: Task|Bug"]);
    expect(result.tags).toEqual(["Task", "Bug"]);
  });

  it("parses single tag", () => {
    const result = parseRendererArgs([":progress-bar", "tags: Task"]);
    expect(result.tags).toEqual(["Task"]);
  });

  it("parses property override", () => {
    const result = parseRendererArgs([":progress-bar", "property: state"]);
    expect(result._property).toBe("state");
  });

  it("parses complete values", () => {
    const result = parseRendererArgs([":progress-bar", "complete: Done|Canceled"]);
    expect(result._complete).toEqual(["Done", "Canceled"]);
  });

  it("parses numeric depth", () => {
    const result = parseRendererArgs([":progress-bar", "depth: 2"]);
    expect(result.depth).toBe(2);
  });

  it("parses depth all", () => {
    const result = parseRendererArgs([":progress-bar", "depth: all"]);
    expect(result.depth).toBe(Infinity);
  });

  it("parses strict mode", () => {
    const result = parseRendererArgs([":progress-bar", "strict: true"]);
    expect(result.strict).toBe(true);
  });

  it("parses format option", () => {
    const result = parseRendererArgs([":progress-bar", "format: both"]);
    expect(result.displayFormat).toBe("both");
  });

  it("parses width", () => {
    const result = parseRendererArgs([":progress-bar", "width: 200px"]);
    expect(result.barWidth).toBe("200px");
  });

  it("parses query UUID", () => {
    const result = parseRendererArgs([
      ":progress-bar",
      "query: 69acb093-df21-438d-9bae-72decf188ed2",
    ]);
    expect(result.queryUUID).toBe("69acb093-df21-438d-9bae-72decf188ed2");
  });

  it("parses multiple params combined", () => {
    const result = parseRendererArgs([
      ":progress-bar",
      "tags: Task|Bug",
      "property: status",
      "depth: 1",
    ]);
    expect(result.tags).toEqual(["Task", "Bug"]);
    expect(result._property).toBe("status");
    expect(result.depth).toBe(1);
  });

  it("handles whitespace tolerance", () => {
    const result = parseRendererArgs([":progress-bar", "  tags:  Task | Bug  "]);
    expect(result.tags).toEqual(["Task", "Bug"]);
  });

  it("ignores unknown params", () => {
    const result = parseRendererArgs([":progress-bar", "foo: bar", "tags: Task"]);
    expect(result.tags).toEqual(["Task"]);
    expect((result as any).foo).toBeUndefined();
  });
});
