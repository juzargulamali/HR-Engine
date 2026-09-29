import { describe, expect, it } from "vitest";
import type { RoleGrant } from "@enginious-hr/domain";
import { buildNavGroups } from "./nav-groups";
import { NAV_ICONS } from "./nav-icons";

/**
 * Regression coverage for the production outage where AppShell (a Server
 * Component) passed nav data containing raw lucide-react component
 * references (`icon: SomeIcon`) as a prop into SidebarNav/CommandPalette
 * (Client Components). React Server Components can only serialize plain
 * data (or already-rendered elements) across that boundary — a bare
 * function/component reference throws at render time in production, even
 * though `next build`/`tsc` never catch it, because the affected routes are
 * dynamic/authenticated and are never actually rendered during the build's
 * static analysis. The fix moved icons to a string `iconKey` resolved only
 * inside the client components (nav-icons.ts); these tests assert the data
 * AppShell hands to those client components can never regress back into
 * carrying a function value.
 */

function grant(role: RoleGrant["role"], companyId: string | null = "company-1"): RoleGrant {
  return { role, companyId, countryCode: null };
}

/** Recursively asserts no function value appears anywhere in the tree — the exact defect class that broke production. */
function assertNoFunctions(value: unknown, path = "root"): void {
  if (typeof value === "function") {
    throw new Error(`Found a function at ${path} — this cannot cross the Server Component -> Client Component boundary`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoFunctions(item, `${path}[${i}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      assertNoFunctions(v, `${path}.${key}`);
    }
  }
}

const GRANT_SCENARIOS: { name: string; grants: RoleGrant[] }[] = [
  { name: "no roles at all", grants: [] },
  { name: "plain employee (line manager)", grants: [grant("line_manager")] },
  { name: "hr_admin", grants: [grant("hr_admin")] },
  { name: "finance", grants: [grant("finance")] },
  { name: "ceo", grants: [grant("ceo")] },
  { name: "cto", grants: [grant("cto")] },
  { name: "sys_admin", grants: [grant("sys_admin", null)] },
  { name: "hr_admin + sys_admin (every gated group visible)", grants: [grant("hr_admin"), grant("sys_admin", null)] },
];

describe("buildNavGroups", () => {
  it.each(GRANT_SCENARIOS)("returns only plain, function-free data for $name", ({ grants }) => {
    const groups = buildNavGroups(grants);
    assertNoFunctions(groups);
  });

  it.each(GRANT_SCENARIOS)("round-trips through JSON without losing data for $name — proof it's RSC-serializable", ({ grants }) => {
    const groups = buildNavGroups(grants);
    const roundTripped = JSON.parse(JSON.stringify(groups));
    expect(roundTripped).toEqual(groups);
  });

  it.each(GRANT_SCENARIOS)("every iconKey resolves to a real icon component for $name", ({ grants }) => {
    const groups = buildNavGroups(grants);
    for (const group of groups) {
      for (const link of group.links) {
        expect(NAV_ICONS[link.iconKey], `no icon registered for iconKey "${link.iconKey}" (${link.href})`).toBeDefined();
      }
    }
  });

  it("never includes a raw component under an 'icon' key — the exact shape of the original bug", () => {
    const groups = buildNavGroups([grant("hr_admin"), grant("sys_admin", null)]);
    for (const group of groups) {
      for (const link of group.links) {
        expect(link).not.toHaveProperty("icon");
        expect(typeof link.iconKey).toBe("string");
      }
    }
  });

  it("hides sys_admin-only links (Companies, Users & Roles) from an ordinary employee", () => {
    const groups = buildNavGroups([grant("line_manager")]);
    const allHrefs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(allHrefs).not.toContain("/admin/companies");
    expect(allHrefs).not.toContain("/admin/users");
  });

  it("shows sys_admin-only links to a sys_admin", () => {
    const groups = buildNavGroups([grant("sys_admin", null)]);
    const allHrefs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(allHrefs).toContain("/admin/companies");
    expect(allHrefs).toContain("/admin/users");
  });

  it("always includes the base links every signed-in user gets, regardless of role", () => {
    const groups = buildNavGroups([]);
    const allHrefs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(allHrefs).toEqual(expect.arrayContaining(["/", "/profile", "/employees", "/attendance", "/leave"]));
  });

  it("hides Payroll from a plain employee with no other role", () => {
    const groups = buildNavGroups([grant("employee")]);
    const allHrefs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(allHrefs).not.toContain("/payroll");
  });

  it("hides Approvals from an employee who holds no approval-capable role", () => {
    const groups = buildNavGroups([grant("employee")]);
    const allHrefs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(allHrefs).not.toContain("/approvals");
  });

  it("shows Approvals but hides Payroll for a Line Manager", () => {
    const groups = buildNavGroups([grant("line_manager")]);
    const allHrefs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(allHrefs).toContain("/approvals");
    expect(allHrefs).not.toContain("/payroll");
  });

  it("hides Payroll and Approvals from a Sys Admin who holds no other role", () => {
    const groups = buildNavGroups([grant("sys_admin", null)]);
    const allHrefs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(allHrefs).not.toContain("/payroll");
    expect(allHrefs).not.toContain("/approvals");
    // ...but its own admin-only links are untouched by this change.
    expect(allHrefs).toContain("/admin/companies");
    expect(allHrefs).toContain("/admin/users");
    expect(allHrefs).toContain("/audit-log");
  });

  it.each([
    { name: "hr_admin", role: "hr_admin" as const },
    { name: "finance", role: "finance" as const },
    { name: "ceo", role: "ceo" as const },
    { name: "cto", role: "cto" as const },
  ])("keeps both Approvals and Payroll visible for $name, unchanged", ({ role }) => {
    const groups = buildNavGroups([grant(role)]);
    const allHrefs = groups.flatMap((g) => g.links.map((l) => l.href));
    expect(allHrefs).toContain("/approvals");
    expect(allHrefs).toContain("/payroll");
  });
});
