import { describe, expect, it } from "vitest";
import { pageSlice, pageWindow, pagingSentence } from "./paging";

describe("paging over a list that was read in full", () => {
  it("names the slice and the whole, and never drops the rows after the first page", () => {
    const rows = Array.from({ length: 240 }, (_, i) => i + 1);
    const first = pageWindow(rows.length, undefined);
    expect(pagingSentence(first, "account", "accounts")).toBe("Showing 1-100 of 240 accounts");
    expect(pageSlice(rows, first)).toHaveLength(100);
    const last = pageWindow(rows.length, "3");
    expect(pagingSentence(last, "account", "accounts")).toBe("Showing 201-240 of 240 accounts");
    expect(pageSlice(rows, last)).toEqual(rows.slice(200));
    // every row is on exactly one page
    expect([1, 2, 3].flatMap((p) => pageSlice(rows, pageWindow(rows.length, String(p))))).toEqual(rows);
  });
  it("a list that fits says how many there are, with no 'Showing'", () => {
    expect(pagingSentence(pageWindow(3, undefined), "account", "accounts")).toBe("3 accounts");
    expect(pagingSentence(pageWindow(1, undefined), "account", "accounts")).toBe("1 account");
    expect(pagingSentence(pageWindow(100, undefined), "account", "accounts")).toBe("100 accounts");
  });
  it("says when filters narrowed the list", () => {
    expect(pagingSentence(pageWindow(140, "2"), "account", "accounts", 900)).toBe("Showing 101-140 of 140 accounts matching, of 900 in all");
    expect(pagingSentence(pageWindow(12, undefined), "account", "accounts", 900)).toBe("12 accounts matching, of 900 in all");
    expect(pagingSentence(pageWindow(900, undefined), "account", "accounts", 900)).toBe("Showing 1-100 of 900 accounts");
  });
  it("an address is never trusted: nonsense is page 1 and a page past the end is the last page", () => {
    expect(pageWindow(240, "abc").page).toBe(1);
    expect(pageWindow(240, "0").page).toBe(1);
    expect(pageWindow(240, "-2").page).toBe(1);
    expect(pageWindow(240, ["2", "3"]).page).toBe(1);
    expect(pageWindow(240, "99")).toMatchObject({ page: 3, pages: 3, from: 201, to: 240 });
    expect(pageWindow(0, "4")).toEqual({ page: 1, pages: 1, from: 0, to: 0, total: 0 });
    expect(pageSlice([], pageWindow(0, "4"))).toEqual([]);
  });
  it("takes its own page size", () => {
    expect(pagingSentence(pageWindow(120, "2", 50), "organisation", "organisations")).toBe("Showing 51-100 of 120 organisations");
  });
});
