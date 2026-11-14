import { describe, expect, it } from "vitest";
import { listAddress, safeListHref } from "./list-memory";

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

describe("listAddress", () => {
  it("remembers the filters but never an open task or version, so Back lands on the list", () => {
    expect(listAddress("/projects/work", "show=review&q=logo&task=t1&version=v1")).toBe("/projects/work?show=review&q=logo");
    expect(listAddress("/projects/work", "task=t1")).toBe("/projects/work");
    expect(listAddress("/projects/P/work", "")).toBe("/projects/P/work");
  });
});
