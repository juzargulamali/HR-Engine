import { describe, expect, it } from "vitest";
import { safeListHref } from "./list-memory";

describe("safeListHref", () => {
  it("returns the remembered address of the same list, with its filters", () => {
    expect(safeListHref("/sales/opportunities?stage=qualified&view=board", "/sales/opportunities")).toBe("/sales/opportunities?stage=qualified&view=board");
    expect(safeListHref("/sales/opportunities", "/sales/opportunities")).toBe("/sales/opportunities");
  });
  it("falls back to the plain list when nothing was remembered", () => {
    expect(safeListHref(null, "/employees")).toBe("/employees");
    expect(safeListHref("", "/employees")).toBe("/employees");
  });
  it("never follows an address that is not on this list", () => {
    expect(safeListHref("https://example.com/employees", "/employees")).toBe("/employees");
    expect(safeListHref("//example.com/employees?x=1", "/employees")).toBe("/employees");
    expect(safeListHref("/employeesevil?x=1", "/employees")).toBe("/employees");
    expect(safeListHref("/payroll?x=1", "/employees")).toBe("/employees");
  });
});
