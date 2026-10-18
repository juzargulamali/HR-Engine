import { describe, expect, it } from "vitest";
import type { RoleGrant } from "@enginious-hr/domain";
import { activeModuleId, breadcrumbFor, buildNavModules, navGroupsFromModules, type NavModuleData } from "./nav-groups";
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

/** Every real href reachable through the module navigation (module rows and sub-links, not "coming soon" placeholders). */
function hrefsOf(modules: NavModuleData[]): string[] {
  return modules.flatMap((m) => [...(m.comingSoon || !m.href ? [] : [m.href]), ...m.sections.flatMap((s) => s.links.filter((l) => !l.comingSoon && l.href).map((l) => l.href))]);
}
/** Every icon key used anywhere in the navigation, including modules. */
function iconKeysOf(modules: NavModuleData[]): string[] {
  return modules.flatMap((m) => [m.iconKey, ...m.sections.flatMap((s) => s.links.map((l) => l.iconKey))]);
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

describe("buildNavModules", () => {
  it.each(GRANT_SCENARIOS)("returns only plain, function-free data for $name", ({ grants }) => {
    assertNoFunctions(buildNavModules(grants));
  });

  it.each(GRANT_SCENARIOS)("round-trips through JSON without losing data for $name — proof it's RSC-serializable", ({ grants }) => {
    const modules = buildNavModules(grants);
    expect(JSON.parse(JSON.stringify(modules))).toEqual(modules);
  });

  it.each(GRANT_SCENARIOS)("every iconKey resolves to a real icon component for $name", ({ grants }) => {
    for (const key of iconKeysOf(buildNavModules(grants, { crmGrants: [{ companyId: "company-1", capabilities: ["founder"] }] }))) {
      expect(NAV_ICONS[key as keyof typeof NAV_ICONS], `no icon registered for iconKey "${key}"`).toBeDefined();
    }
  });

  it("never includes a raw component under an 'icon' key — the exact shape of the original bug", () => {
    const modules = buildNavModules([grant("hr_admin"), grant("sys_admin", null)]);
    for (const m of modules) {
      expect(m).not.toHaveProperty("icon");
      for (const s of m.sections) for (const link of s.links) expect(link).not.toHaveProperty("icon");
    }
  });

  it("hides sys_admin-only links (Companies, Users & Roles) from an ordinary employee", () => {
    const hrefs = hrefsOf(buildNavModules([grant("line_manager")]));
    expect(hrefs).not.toContain("/admin/companies");
    expect(hrefs).not.toContain("/admin/users");
  });

  it("shows sys_admin-only links to a sys_admin", () => {
    const hrefs = hrefsOf(buildNavModules([grant("sys_admin", null)]));
    expect(hrefs).toContain("/admin/companies");
    expect(hrefs).toContain("/admin/users");
  });

  it("always includes the base links every signed-in user gets, regardless of role", () => {
    expect(hrefsOf(buildNavModules([]))).toEqual(expect.arrayContaining(["/", "/profile", "/employees", "/attendance", "/leave", "/attendance-clock", "/performance"]));
  });

  it("hides Payroll from a plain employee with no other role", () => {
    expect(hrefsOf(buildNavModules([grant("employee")]))).not.toContain("/payroll");
  });

  it("hides Approvals from an employee who holds no approval-capable role", () => {
    expect(hrefsOf(buildNavModules([grant("employee")]))).not.toContain("/approvals");
  });

  it("shows Approvals to a plain employee who has something waiting on their own decision (e.g. a project lead)", () => {
    const hrefs = hrefsOf(buildNavModules([grant("employee")], { hasPendingApprovals: true }));
    expect(hrefs).toContain("/approvals");
    expect(hrefs).not.toContain("/payroll");
  });

  it("still hides Approvals from a plain employee when nothing is waiting", () => {
    expect(hrefsOf(buildNavModules([grant("employee")], { hasPendingApprovals: false }))).not.toContain("/approvals");
  });

  it("shows Approvals but hides Payroll for a Line Manager", () => {
    const hrefs = hrefsOf(buildNavModules([grant("line_manager")]));
    expect(hrefs).toContain("/approvals");
    expect(hrefs).not.toContain("/payroll");
  });

  it("hides Payroll and Approvals from a Sys Admin who holds no other role", () => {
    const hrefs = hrefsOf(buildNavModules([grant("sys_admin", null)]));
    expect(hrefs).not.toContain("/payroll");
    expect(hrefs).not.toContain("/approvals");
    // ...but its own admin-only links are untouched by this change.
    expect(hrefs).toContain("/admin/companies");
    expect(hrefs).toContain("/admin/users");
    expect(hrefs).toContain("/audit-log");
  });

  it.each([
    { name: "hr_admin", role: "hr_admin" as const },
    { name: "finance", role: "finance" as const },
    { name: "ceo", role: "ceo" as const },
    { name: "cto", role: "cto" as const },
  ])("keeps both Approvals and Payroll visible for $name, unchanged", ({ role }) => {
    const hrefs = hrefsOf(buildNavModules([grant(role)]));
    expect(hrefs).toContain("/approvals");
    expect(hrefs).toContain("/payroll");
  });

  it("keeps every link the old navigation offered, for every role (nothing was lost in the move to modules)", () => {
    const OLD_HREFS_BY_ROLE: Record<string, string[]> = {
      employee: ["/", "/profile", "/attendance-clock", "/employees", "/attendance", "/leave", "/reimbursements", "/performance", "/letters", "/policies", "/holidays"],
      hr_admin: ["/approvals", "/alerts", "/payroll", "/assets", "/ai-suggestions", "/audit-log"],
      sys_admin: ["/admin/companies", "/admin/users", "/ai-suggestions", "/audit-log"],
    };
    expect(hrefsOf(buildNavModules([grant("employee")]))).toEqual(expect.arrayContaining(OLD_HREFS_BY_ROLE.employee!));
    expect(hrefsOf(buildNavModules([grant("hr_admin")]))).toEqual(expect.arrayContaining([...OLD_HREFS_BY_ROLE.employee!, ...OLD_HREFS_BY_ROLE.hr_admin!]));
    expect(hrefsOf(buildNavModules([grant("sys_admin", null)]))).toEqual(expect.arrayContaining(OLD_HREFS_BY_ROLE.sys_admin!));
  });
});

describe("ENGINIOUS OS modules", () => {
  it("lists the approved modules in order, for everyone", () => {
    const labels = buildNavModules([grant("employee")]).map((m) => m.label);
    expect(labels).toEqual(["My Day", "People & HR", "Projects & Tasks", "Inventory", "Vendors & Purchasing", "KPIs & Performance"]);
  });

  it("marks every unbuilt module as coming soon: no link, no sub-links, no data", () => {
    const soon = buildNavModules([grant("employee")]).filter((m) => m.comingSoon);
    expect(soon.map((m) => m.label)).toEqual(["Projects & Tasks", "Inventory", "Vendors & Purchasing"]);
    for (const m of soon) {
      expect(m.href).toBe("");
      expect(m.sections).toEqual([]);
    }
  });

  it("keeps the existing HR performance reviews reachable and names them as HR, separate from the coming-soon KPIs", () => {
    const kpis = buildNavModules([grant("employee")]).find((m) => m.id === "kpis")!;
    const links = kpis.sections.flatMap((s) => s.links);
    expect(links.find((l) => l.href === "/performance")?.label).toBe("Performance reviews (HR)");
    expect(links.find((l) => l.label === "KPIs")).toMatchObject({ comingSoon: true, href: "" });
  });

  it("puts Sales & CRM after My Day (and Approvals) only for people with a Sales grant, whatever their HR roles", () => {
    const grants = [{ companyId: "company-1", capabilities: [] as never[] }];
    const withAccess = buildNavModules([], { crmGrants: grants });
    expect(withAccess.map((m) => m.id)).toContain("sales");
    expect(withAccess.find((m) => m.id === "sales")?.href).toBe("/sales");
    for (const hr of [grant("hr_admin"), grant("ceo"), grant("sys_admin"), grant("finance")]) {
      expect(hrefsOf(buildNavModules([hr]))).not.toContain("/sales");
      expect(buildNavModules([hr], { crmGrants: [] }).map((m) => m.id)).not.toContain("sales");
    }
  });

  it("shows Sales Settings only to people who can manage them, and Access only to those who can manage access", () => {
    const plain = hrefsOf(buildNavModules([], { crmGrants: [{ companyId: "c1", capabilities: [] }] }));
    expect(plain).toEqual(expect.arrayContaining(["/sales", "/sales/opportunities", "/sales/pipeline", "/sales/follow-ups", "/sales/proposals", "/sales/clients", "/sales/reports"]));
    expect(plain).not.toContain("/sales/settings");
    expect(plain).not.toContain("/sales/access");
    const settingsOnly = hrefsOf(buildNavModules([], { crmGrants: [{ companyId: "c1", capabilities: ["manage_settings"] }] }));
    expect(settingsOnly).toContain("/sales/settings");
    expect(settingsOnly).not.toContain("/sales/access");
    const founder = hrefsOf(buildNavModules([], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] }));
    expect(founder).toEqual(expect.arrayContaining(["/sales/settings", "/sales/access"]));
  });

  it("does not let a Sales grant change any HR link", () => {
    const hr = (m: NavModuleData[]) => hrefsOf(m.filter((x) => x.id !== "sales"));
    const base = buildNavModules([grant("employee")]);
    const withCrm = buildNavModules([grant("employee")], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] });
    expect(hr(withCrm)).toEqual(hr(base));
  });

  it("never carries a function across the server/client boundary", () => {
    assertNoFunctions(buildNavModules([grant("hr_admin")], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] }));
  });

  it("search lists only real, permitted pages (never a coming-soon module)", () => {
    const groups = navGroupsFromModules(buildNavModules([grant("employee")]));
    const labels = groups.flatMap((g) => g.links.map((l) => l.label));
    expect(labels).not.toContain("Inventory");
    expect(labels).not.toContain("KPIs");
    expect(labels).toContain("Leave");
  });
});

describe("active module and breadcrumb", () => {
  const modules = buildNavModules([grant("hr_admin")], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] });
  it.each([
    ["/", "my-day"],
    ["/approvals", "approvals"],
    ["/sales", "sales"],
    ["/sales/opportunities/abc", "sales"],
    ["/employees/123", "people"],
    ["/attendance", "people"],
    ["/attendance-clock", "people"],
    ["/leave/new", "people"],
    ["/performance/goals", "kpis"],
  ])("%s belongs to %s", (path, id) => {
    expect(activeModuleId(path, modules)).toBe(id);
  });
  it("a page that is not in the navigation belongs to no module", () => {
    expect(activeModuleId("/account/security", modules)).toBeNull();
  });
  it("names the module and the most specific page", () => {
    expect(breadcrumbFor("/sales/opportunities/abc", modules)).toEqual({ module: "Sales & CRM", page: "Opportunities" });
    expect(breadcrumbFor("/attendance-clock", modules)).toEqual({ module: "People & HR", page: "My Attendance Clock" });
    expect(breadcrumbFor("/attendance", modules)).toEqual({ module: "People & HR", page: "Attendance" });
    expect(breadcrumbFor("/", modules)).toEqual({ module: "My Day", page: null });
    expect(breadcrumbFor("/sales", modules)).toEqual({ module: "Sales & CRM", page: null });
  });
});
