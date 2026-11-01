import { describe, expect, it } from "vitest";
import type { InvGrant } from "@enginious-hr/domain";
import { ALL_WAREHOUSES, pickWorkingLocation, warehouseOptions } from "./working-location";

const C = "c1";
const loc = (id: string, name: string, active = true) => ({ id, name, company_id: C, is_active: active });
const locations = [loc("dxb", "Dubai"), loc("auh", "Abu Dhabi"), loc("old", "Old store", false)];
const grants = (...caps: string[]): InvGrant[] => [{ companyId: C, capabilities: caps as InvGrant["capabilities"] }];
const input = (g: InvGrant[], assigned: string[]) => ({ grants: g, locations, assignedLocationIds: assigned, companyName: () => "Enginious" });

describe("which warehouses a person is offered", () => {
  it("an operator is offered the locations they are assigned to, never an inactive one", () => {
    const { options, operable } = warehouseOptions(input(grants("warehouse"), ["auh"]));
    expect(options.map((o) => o.id)).toEqual(["auh"]);
    expect([...operable]).toEqual(["auh"]);
  });
  it("'All locations' and founders are offered every active location", () => {
    expect(warehouseOptions(input(grants("warehouse", "cross_location"), [])).options.map((o) => o.id)).toEqual(["dxb", "auh"]);
    expect(warehouseOptions(input(grants("founder"), [])).options.map((o) => o.id)).toEqual(["dxb", "auh"]);
  });
  it("someone who cannot operate anywhere (a stock reader) can still choose among every active location, and operates none", () => {
    const { options, operable } = warehouseOptions(input(grants("view_stock"), []));
    expect(options.map((o) => o.id)).toEqual(["dxb", "auh"]);
    expect(operable.size).toBe(0);
  });
});

describe("which warehouse is shown first", () => {
  const options = [{ id: "dxb", name: "Dubai", companyId: C, companyName: "E" }, { id: "auh", name: "Abu Dhabi", companyId: C, companyName: "E" }];
  const base = { options, everyLocationId: ["dxb", "auh", "old"], fromUrl: "", remembered: "", assigned: [] as string[], allowAll: true };
  it("the address wins, then the remembered choice, then the person's own warehouse, then the first on offer", () => {
    expect(pickWorkingLocation({ ...base, fromUrl: "auh", remembered: "dxb", assigned: ["dxb"] })).toEqual({ id: "auh", all: false });
    expect(pickWorkingLocation({ ...base, remembered: "auh", assigned: ["dxb"] })).toEqual({ id: "auh", all: false });
    expect(pickWorkingLocation({ ...base, assigned: ["auh"] })).toEqual({ id: "auh", all: false });
    expect(pickWorkingLocation(base)).toEqual({ id: "dxb", all: false });
  });
  it("a value that is not a real location is ignored, never trusted", () => {
    expect(pickWorkingLocation({ ...base, fromUrl: "nonsense", remembered: "also-nonsense", assigned: ["auh"] })).toEqual({ id: "auh", all: false });
  });
  it("'all' is only honoured where the screen offers it, and people who cannot operate start with all", () => {
    expect(pickWorkingLocation({ ...base, fromUrl: ALL_WAREHOUSES })).toEqual({ id: null, all: true });
    expect(pickWorkingLocation({ ...base, fromUrl: ALL_WAREHOUSES, allowAll: false })).toEqual({ id: "dxb", all: false });
    expect(pickWorkingLocation({ ...base, defaultAll: true })).toEqual({ id: null, all: true });
    expect(pickWorkingLocation({ ...base, defaultAll: true, assigned: ["auh"] })).toEqual({ id: "auh", all: false });
  });
  it("nothing to choose from is said plainly, not guessed", () => {
    expect(pickWorkingLocation({ ...base, options: [], everyLocationId: [] })).toEqual({ id: null, all: false });
  });
});
