import { describe, expect, it } from "vitest";
import { FOREIGN_PLACE, itemOwnedByNote, ownedByNote, placeOf, transitRoute, type PlaceCtx } from "./places";

const UAE = "c-uae", KSA = "c-ksa";
const names: Record<string, string> = { [UAE]: "Enginious UAE", [KSA]: "Enginious KSA" };
const ctx = (companyCount = 1): PlaceCtx => ({
  locations: [{ id: "dxb", name: "Dubai warehouse", company_id: UAE }, { id: "ruh", name: "Riyadh warehouse", company_id: KSA }],
  companyName: (id) => names[id] ?? "Unknown", companyCount,
});

describe("placeOf", () => {
  it("names the place alone when the person works with one company and the place is the owner's", () => {
    expect(placeOf(ctx(1), "dxb", UAE)).toEqual({ label: "Dubai warehouse", operatingCompanyId: UAE, unreadable: false });
  });
  it("adds the company when the person works with several (there can be a Dubai under each)", () => {
    expect(placeOf(ctx(2), "dxb", UAE).label).toBe("Dubai warehouse · Enginious UAE");
  });
  it("adds the company when the place is run by another company than the owner, even for a one-company reader", () => {
    expect(placeOf(ctx(1), "ruh", UAE)).toEqual({ label: "Riyadh warehouse · Enginious KSA", operatingCompanyId: KSA, unreadable: false });
  });
  it("says a place the person cannot read is another company's warehouse, never an empty place", () => {
    expect(placeOf(ctx(1), "unknown-loc", UAE)).toEqual({ label: FOREIGN_PLACE, operatingCompanyId: null, unreadable: true });
  });
  it("has no place without a location", () => {
    expect(placeOf(ctx(), null, UAE)).toEqual({ label: null, operatingCompanyId: null, unreadable: false });
  });
});

describe("ownedByNote: ownership is shown only where it differs from who runs the place", () => {
  it("says nothing when the owner runs the warehouse the unit is in", () => {
    expect(ownedByNote(ctx(), UAE, placeOf(ctx(), "dxb", UAE))).toBeNull();
  });
  it("says Owned by <owner> when another company runs the warehouse", () => {
    expect(ownedByNote(ctx(), UAE, placeOf(ctx(), "ruh", UAE))).toBe("Owned by Enginious UAE");
  });
  it("says it for a place the person cannot read (by definition another company's)", () => {
    expect(ownedByNote(ctx(), UAE, placeOf(ctx(), "elsewhere", UAE))).toBe("Owned by Enginious UAE");
  });
  it("says nothing without a place, and never names an owner it does not know", () => {
    expect(ownedByNote(ctx(), UAE, null)).toBeNull();
    expect(ownedByNote(ctx(), UAE, placeOf(ctx(), null, UAE))).toBeNull();
    expect(ownedByNote({ companyName: () => "Unknown" }, "c-x", { operatingCompanyId: KSA, unreadable: false })).toBe("Owned by another company");
  });
});

describe("itemOwnedByNote (an item listed under a chosen warehouse)", () => {
  it("is empty without a warehouse or when the warehouse belongs to the owner", () => {
    expect(itemOwnedByNote(ctx(), UAE, null)).toBeNull();
    expect(itemOwnedByNote(ctx(), UAE, UAE)).toBeNull();
  });
  it("names the owner when the chosen warehouse is run by another company", () => {
    expect(itemOwnedByNote(ctx(), UAE, KSA)).toBe("Owned by Enginious UAE");
  });
});

describe("transitRoute", () => {
  it("reads from, to, and never leaves a place blank", () => {
    expect(transitRoute("Dubai warehouse", "Riyadh warehouse · Enginious KSA")).toBe("Dubai warehouse to Riyadh warehouse · Enginious KSA");
    expect(transitRoute("Dubai warehouse", null)).toBe(`Dubai warehouse to ${FOREIGN_PLACE}`);
  });
});
