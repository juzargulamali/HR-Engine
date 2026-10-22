import { describe, expect, it } from "vitest";
import { dayStartIso, lineFrom, lineTo, movementFromTo, movementQuantity, movementWhat, movementZone, nextDay, type LineLike, type MovementLike, type Resolver } from "./movement-view";

const r: Resolver = {
  location: (id) => (id === "l1" ? "Dubai warehouse" : id === "l2" ? "Riyadh warehouse" : "Unknown location"),
  bin: (id) => (id === "b1" ? "A1" : null),
  employee: (id) => (id === "e1" ? "Sara Ali" : "An employee"),
  project: (id) => (id === "p1" ? "P-7 Mall" : "A project"),
};
const line = (over: Partial<LineLike> = {}): LineLike => ({
  item_id: "i1", unit_id: null, qty: 1, from_kind: "warehouse", to_kind: "employee", from_location_id: "l1", to_location_id: null, from_bin_id: null, to_bin_id: null,
  from_employee_id: null, to_employee_id: "e1", from_project_id: null, to_project_id: null, ...over,
});
const name = (id: string) => ({ i1: "Laptop X1", i2: "XLR cable" })[id] ?? "Item";

describe("lineFrom / lineTo", () => {
  it("names the shelf, the bin, the employee and the project", () => {
    expect(lineFrom(line({ from_bin_id: "b1" }), r)).toBe("Dubai warehouse, bin A1");
    expect(lineTo(line(), r)).toBe("Employee: Sara Ali");
    expect(lineTo(line({ to_kind: "project", to_employee_id: null, to_project_id: "p1" }), r)).toBe("Project: P-7 Mall");
  });
  it("says plain words for places outside the shelves", () => {
    expect(lineFrom(line({ from_kind: "external" }), r)).toBe("Outside (new stock)");
    expect(lineTo(line({ to_kind: "consumed" }), r)).toBe("Used up");
    expect(lineTo(line({ to_kind: "transit" }), r)).toBe("On the way");
    expect(lineFrom(line({ from_kind: "repair" }), r)).toBe("At the repairer");
  });
  it("never invents a name it does not have", () => {
    expect(lineTo(line({ to_employee_id: "zzz" }), r)).toBe("Employee: An employee");
  });
});

describe("movementFromTo", () => {
  const m = (lines: LineLike[]): MovementLike => ({ kind: "issue_employee", occurred_at: "2026-11-03T05:30:00Z", from_location_id: "l1", to_location_id: null, project_id: null, employee_id: "e1", lines });
  it("shows the place when every line agrees and 'Several places' when they do not", () => {
    expect(movementFromTo(m([line(), line()]), r)).toEqual({ from: "Dubai warehouse", to: "Employee: Sara Ali" });
    expect(movementFromTo(m([line(), line({ from_location_id: "l2" })]), r).from).toBe("Several places");
    expect(movementFromTo(m([]), r)).toEqual({ from: "—", to: "—" });
  });
});

describe("how much and what", () => {
  const lines = [line({ unit_id: "u1" }), line({ unit_id: "u2" }), line({ item_id: "i2", qty: "20.500" }), line({ item_id: "i2", qty: 4 })];
  it("counts units one each and adds counted stock per item", () => {
    expect(movementQuantity({ lines }, name, (id) => (id === "i2" ? "m" : "each"))).toBe("2 individual items, 24.5 m XLR cable");
    expect(movementQuantity({ lines: [] }, name)).toBe("—");
  });
  it("names what moved and shortens a long list", () => {
    expect(movementWhat({ lines }, name)).toBe("Laptop X1 ×2, XLR cable");
    const many = ["a", "b", "c", "d", "e"].map((id) => line({ item_id: id }));
    expect(movementWhat({ lines: many }, () => "X", 3)).toMatch(/and 2 more$/);
  });
});

describe("time zones", () => {
  const zones: Record<string, string> = { l1: "Asia/Dubai", l2: "Europe/Warsaw" };
  it("uses the place where it happened: where it left for sending, where it arrived for receiving", () => {
    expect(movementZone({ kind: "issue_employee", from_location_id: "l1", to_location_id: null }, (id) => zones[id] ?? null, "UTC")).toBe("Asia/Dubai");
    expect(movementZone({ kind: "transfer_receive", from_location_id: "l1", to_location_id: "l2" }, (id) => zones[id] ?? null, "UTC")).toBe("Europe/Warsaw");
    expect(movementZone({ kind: "transfer_dispatch", from_location_id: "l1", to_location_id: "l2" }, (id) => zones[id] ?? null, "UTC")).toBe("Asia/Dubai");
    expect(movementZone({ kind: "condition_check", from_location_id: null, to_location_id: null }, () => null, "Asia/Dubai")).toBe("Asia/Dubai");
  });
  it("turns a typed day into the instants a day starts and ends in a place", () => {
    expect(dayStartIso("2026-11-05", "Asia/Dubai")).toBe("2026-11-04T20:00:00.000Z");
    expect(dayStartIso("2026-11-05", "Europe/Warsaw")).toBe("2026-11-04T23:00:00.000Z");
    expect(dayStartIso("nope", "Asia/Dubai")).toBeNull();
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("x")).toBeNull();
  });
});
