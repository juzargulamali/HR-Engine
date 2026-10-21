import { describe, expect, it } from "vitest";
import { columnsToParam, compareNullable, firstParam, nextSort, parseColumns, parseRecordId, parseSort, parseView, paramsToRecord, sortToParam, withParams } from "./url-state";

describe("withParams", () => {
  it("sets, replaces and removes parameters and keeps the rest", () => {
    const cur = { q: "orbit", stage: "new", open: "abc" };
    expect(withParams("/sales/opportunities", cur, { open: null })).toBe("/sales/opportunities?q=orbit&stage=new");
    expect(withParams("/sales/opportunities", cur, { stage: "won", view: "board" })).toBe("/sales/opportunities?q=orbit&stage=won&open=abc&view=board");
    expect(withParams("/x", {}, {})).toBe("/x");
  });
  it("treats an empty value as removal and honours drop", () => {
    expect(withParams("/x", { a: "1", b: "2" }, { a: "" })).toBe("/x?b=2");
    expect(withParams("/x", { a: "1", b: "2", c: "3" }, {}, ["b", "c"])).toBe("/x?a=1");
  });
  it("accepts URLSearchParams and arrays (first value wins)", () => {
    expect(withParams("/x", new URLSearchParams("a=1&b=2"), { b: null })).toBe("/x?a=1");
    expect(paramsToRecord({ a: ["1", "2"], b: undefined, c: "" })).toEqual({ a: "1" });
    expect(firstParam({ a: ["1", "2"] }, "a")).toBe("1");
    expect(firstParam(new URLSearchParams("a=z"), "a")).toBe("z");
    expect(firstParam({}, "a")).toBe("");
  });
});

describe("sorting", () => {
  const allowed = ["title", "due", "owner"] as const;
  const fallback = { key: "due", dir: "asc" } as const;
  it("never trusts the URL", () => {
    expect(parseSort("title", allowed, fallback)).toEqual({ key: "title", dir: "asc" });
    expect(parseSort("owner:desc", allowed, fallback)).toEqual({ key: "owner", dir: "desc" });
    expect(parseSort("password:desc", allowed, fallback)).toEqual(fallback);
    expect(parseSort("", allowed, fallback)).toEqual(fallback);
  });
  it("flips direction on the same column and resets on a new one", () => {
    expect(nextSort({ key: "title", dir: "asc" }, "title")).toEqual({ key: "title", dir: "desc" });
    expect(nextSort({ key: "title", dir: "desc" }, "title")).toEqual({ key: "title", dir: "asc" });
    expect(nextSort({ key: "title", dir: "desc" }, "due")).toEqual({ key: "due", dir: "asc" });
    expect(sortToParam({ key: "due", dir: "desc" })).toBe("due:desc");
    expect(sortToParam({ key: "due", dir: "asc" })).toBe("due");
  });
  it("sorts missing values last in both directions", () => {
    const rows = ["b", null, "a", ""];
    expect([...rows].sort((x, y) => compareNullable(x, y, "asc"))).toEqual(["a", "b", null, ""]);
    expect([...rows].sort((x, y) => compareNullable(x, y, "desc"))).toEqual(["b", "a", null, ""]);
    expect(compareNullable("a10", "a9", "asc")).toBeGreaterThan(0);
  });
});

describe("columns", () => {
  const all = ["owner", "value", "dates", "source"] as const;
  const defaults = ["owner", "dates"] as const;
  it("uses the defaults unless a valid choice is made, and orders by the master list", () => {
    expect(parseColumns("", all, defaults)).toEqual(["owner", "dates"]);
    expect(parseColumns("nonsense", all, defaults)).toEqual(["owner", "dates"]);
    expect(parseColumns("source,owner", all, defaults)).toEqual(["owner", "source"]);
  });
  it("stores nothing for the default choice", () => {
    expect(columnsToParam(["dates", "owner"], all, defaults)).toBeNull();
    expect(columnsToParam(["owner", "value"], all, defaults)).toBe("owner,value");
    expect(columnsToParam([], all, defaults)).toBeNull();
  });
});

describe("misc", () => {
  it("accepts only a well-formed id and a known view", () => {
    expect(parseRecordId("3f2c8e1a-1b2c-4d3e-8f4a-5b6c7d8e9f01")).not.toBeNull();
    expect(parseRecordId("../../etc/passwd")).toBeNull();
    expect(parseRecordId("")).toBeNull();
    expect(parseView("board")).toBe("board");
    expect(parseView("grid")).toBe("table");
    expect(parseView("", "board")).toBe("board");
  });
});
