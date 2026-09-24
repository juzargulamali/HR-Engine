import { describe, expect, it } from "vitest";
import { ROLES, ROLE_LABELS, ROLE_PRIORITY_ORDER, isAppRole, roleLabelsFor, sortRolesByPriority } from "../src/roles";

describe("roles", () => {
  it("has a label for every role", () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("recognizes valid role strings and rejects unknown ones", () => {
    expect(isAppRole("hr_admin")).toBe(true);
    expect(isAppRole("superuser")).toBe(false);
  });

  it("ranks every role exactly once in the priority order", () => {
    expect([...ROLE_PRIORITY_ORDER].sort()).toEqual([...ROLES].sort());
  });
});

describe("sortRolesByPriority", () => {
  it("orders a mixed set most-senior first, regardless of input order", () => {
    expect(sortRolesByPriority(["employee", "line_manager"])).toEqual(["line_manager", "employee"]);
    expect(sortRolesByPriority(["line_manager", "employee"])).toEqual(["line_manager", "employee"]);
  });

  it("drops duplicate roles (e.g. the same role held across several scoped grants)", () => {
    expect(sortRolesByPriority(["employee", "employee", "line_manager"])).toEqual(["line_manager", "employee"]);
  });

  it("puts System Administrator ahead of every other role", () => {
    expect(sortRolesByPriority(["employee", "hr_admin", "ceo", "sys_admin", "finance"])[0]).toBe("sys_admin");
  });

  it("returns a single-element list for a single-role user", () => {
    expect(sortRolesByPriority(["employee"])).toEqual(["employee"]);
  });

  it("is stable across repeated calls with the same input", () => {
    const input: (typeof ROLES)[number][] = ["cto", "employee", "hr_admin", "line_manager"];
    expect(sortRolesByPriority(input)).toEqual(sortRolesByPriority([...input]));
  });
});

describe("roleLabelsFor", () => {
  it("shows both labels for a user holding Employee and Line Manager, most senior first", () => {
    expect(roleLabelsFor([{ role: "employee" }, { role: "line_manager" }])).toEqual(["Line Manager", "Employee"]);
  });

  it("shows exactly one label for a single-role user", () => {
    expect(roleLabelsFor([{ role: "employee" }])).toEqual(["Employee"]);
  });

  it("does not change which roles are held — only their display order", () => {
    const grants = [{ role: "employee" as const }, { role: "line_manager" as const }];
    // Same roles either way: this is a presentation concern only, never an
    // authorization one — nothing here can grant or revoke access.
    expect(new Set(roleLabelsFor(grants))).toEqual(new Set(["Employee", "Line Manager"]));
  });
});
