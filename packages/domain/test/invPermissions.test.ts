import { describe, expect, it } from "vitest";
import { canOperateLocation, canSeeCosts, canViewStock, hasInvCapability, type InvGrant } from "../src";

const CO = "c1";
const g = (...capabilities: InvGrant["capabilities"][number][]): InvGrant[] => [{ companyId: CO, capabilities }];

describe("Inventory permission mirrors", () => {
  it("a founder holds every capability, in that company only", () => {
    expect(hasInvCapability(g("founder"), CO, "view_costs")).toBe(true);
    expect(hasInvCapability(g("founder"), "other", "view_costs")).toBe(false);
  });
  it("cost visibility is separate from operational access", () => {
    expect(canSeeCosts(g("warehouse", "manage_catalogue", "view_stock", "confirm_stock", "manage_access"), CO)).toBe(false);
    expect(canSeeCosts(g("view_costs"), CO)).toBe(true);
  });
  it("basic access (no capabilities) sees the catalogue summary only", () => {
    expect(canViewStock(g(), CO)).toBe(false);
    expect(canViewStock(g("view_stock"), CO)).toBe(true);
    expect(canViewStock(g("warehouse"), CO)).toBe(true);
  });
  it("a warehouse operator works at assigned locations; cross_location widens it; a founder works everywhere", () => {
    expect(canOperateLocation(g("warehouse"), CO, "dxb", ["dxb"])).toBe(true);
    expect(canOperateLocation(g("warehouse"), CO, "poz", ["dxb"])).toBe(false);
    expect(canOperateLocation(g("warehouse", "cross_location"), CO, "poz", ["dxb"])).toBe(true);
    expect(canOperateLocation(g("founder"), CO, "poz", [])).toBe(true);
    expect(canOperateLocation(g("view_stock", "manage_catalogue"), CO, "dxb", ["dxb"])).toBe(false);
  });
});
