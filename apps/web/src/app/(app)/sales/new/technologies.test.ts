import { describe, expect, it } from "vitest";
import { parseTechnologyRows, serialiseTechnologies } from "./technologies";

describe("parseTechnologyRows", () => {
  it("returns nothing for no rows or only empty rows", () => {
    expect(parseTechnologyRows([])).toEqual({ items: [], error: null });
    expect(parseTechnologyRows([{ name: "  ", qty: "" }])).toEqual({ items: [], error: null });
  });

  it("trims names and parses quantities", () => {
    expect(parseTechnologyRows([{ name: " LED wall ", qty: "3" }, { name: "Kiosk", qty: "" }]).items).toEqual([
      { name: "LED wall", qty: 3 },
      { name: "Kiosk", qty: 1 },
    ]);
  });

  it("reports a quantity without a name", () => {
    const r = parseTechnologyRows([{ name: "", qty: "2" }]);
    expect(r.items).toEqual([]);
    expect(r.error).toMatch(/name/);
  });

  it("flags bad quantities and keeps them invalid for the server", () => {
    for (const qty of ["0", "-1", "1.5", "abc"]) {
      const r = parseTechnologyRows([{ name: "Hologram", qty }]);
      expect(r.error).toMatch(/Hologram/);
      expect(r.items).toEqual([{ name: "Hologram", qty: 0 }]);
    }
  });
});

describe("serialiseTechnologies", () => {
  it("produces the JSON the action parses", () => {
    expect(JSON.parse(serialiseTechnologies([{ name: "Projector", qty: "2" }, { name: "", qty: "" }]))).toEqual([{ name: "Projector", qty: 2 }]);
    expect(serialiseTechnologies([])).toBe("[]");
  });

  it("ignores the untouched default row (no name, quantity 1) so a form with no technologies saves", () => {
    expect(parseTechnologyRows([{ name: "", qty: "1" }])).toEqual({ items: [], error: null });
    expect(parseTechnologyRows([{ name: "Projector", qty: "2" }, { name: "", qty: "1" }]).error).toBeNull();
  });
});
