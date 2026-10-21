import { describe, expect, it } from "vitest";
import { addToPendingList, labelPayload, normaliseTypedCode, parseInventoryScan } from "../src/inventoryCodes";

describe("parseInventoryScan", () => {
  it("reads a bare unit code and a bin label code", () => {
    expect(parseInventoryScan("UAE-E-00042")).toEqual({ ok: true, kind: "unit", code: "UAE-E-00042", companyCode: "UAE" });
    expect(parseInventoryScan("pol-s-00007")).toEqual({ ok: true, kind: "stock", code: "POL-S-00007", companyCode: "POL" });
  });
  it("forgives typing: spaces, look-alike dashes, lower case", () => {
    expect(normaliseTypedCode(" uae – e – 00042 ")).toBe("UAE-E-00042");
    expect(parseInventoryScan(" uae – e – 00042 ")).toMatchObject({ ok: true, code: "UAE-E-00042" });
  });
  it("reads the label address, with the code in the query or the path", () => {
    expect(parseInventoryScan("https://os.example.com/inventory/scan?c=UAE-E-00042")).toMatchObject({ ok: true, kind: "unit", code: "UAE-E-00042" });
    expect(parseInventoryScan("https://os.example.com/inventory/scan/UAE-S-00010")).toMatchObject({ ok: true, kind: "stock" });
  });
  it("says it is not an Inventory code for anything else, and never guesses", () => {
    for (const bad of ["https://example.com/x", "5901234123457", "hello", "UAE-X-00042", "UAE-E-42", "UAE-E-00042-extra"]) {
      expect(parseInventoryScan(bad)).toEqual({ ok: false, problem: "not_inventory" });
    }
    expect(parseInventoryScan("   ")).toEqual({ ok: false, problem: "empty" });
    expect(parseInventoryScan(null)).toEqual({ ok: false, problem: "empty" });
    expect(parseInventoryScan("A".repeat(600))).toEqual({ ok: false, problem: "too_long" });
  });
});

describe("labelPayload", () => {
  it("is an address ending in the code and carries nothing else", () => {
    const p = labelPayload("https://os.example.com/", "uae-e-00042");
    expect(p).toBe("https://os.example.com/inventory/scan?c=UAE-E-00042");
    expect(parseInventoryScan(p)).toMatchObject({ ok: true, code: "UAE-E-00042" });
  });
  it("refuses something that is not a code (a name, a price, a person)", () => {
    expect(() => labelPayload("https://os.example.com", "Laptop 1200 AED")).toThrow();
  });
});

describe("addToPendingList", () => {
  it("never lists the same code twice", () => {
    const scan = parseInventoryScan("UAE-E-00042");
    if (!scan.ok) throw new Error("setup");
    const first = addToPendingList([], scan);
    expect(first).toEqual({ list: [{ code: "UAE-E-00042", kind: "unit" }], added: true });
    const second = addToPendingList(first.list, scan);
    expect(second.added).toBe(false);
    expect(second.list).toHaveLength(1);
  });
});
