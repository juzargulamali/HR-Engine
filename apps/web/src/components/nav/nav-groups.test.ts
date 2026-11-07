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
  { name: "plain employee (reporting manager)", grants: [grant("line_manager")] },
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

  it("hides sys_admin-only links (Companies, People & Access) from an ordinary employee", () => {
    const hrefs = hrefsOf(buildNavModules([grant("line_manager")]));
    expect(hrefs).not.toContain("/admin/companies");
    expect(hrefs).not.toContain("/people-access");
  });

  it("shows sys_admin-only links to a sys_admin, and the old Users & Roles address is no longer offered", () => {
    const hrefs = hrefsOf(buildNavModules([grant("sys_admin", null)]));
    expect(hrefs).toContain("/admin/companies");
    expect(hrefs).toContain("/people-access");
    expect(hrefs).not.toContain("/admin/users");
  });

  it("offers People & Access to anyone who can manage something in it, and to no one else", () => {
    const has = (grants: Parameters<typeof buildNavModules>[0], o: Parameters<typeof buildNavModules>[1] = {}) => hrefsOf(buildNavModules(grants, o)).includes("/people-access");
    expect(has([grant("sys_admin", null)])).toBe(true);
    expect(has([grant("hr_admin")])).toBe(true);
    expect(has([grant("employee")], { crmGrants: [{ companyId: "c1", capabilities: ["manage_access"] }] })).toBe(true);
    expect(has([grant("employee")], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] })).toBe(true);
    expect(has([grant("employee")], { projects: { grants: [{ companyId: "c1", capabilities: ["manage_access"] }] } })).toBe(true);
    expect(has([grant("employee")], { inventory: { grants: [{ companyId: "c1", capabilities: ["manage_access"] }] } })).toBe(true);
    expect(has([grant("employee")], { budget: { any: false, manageAccess: true } })).toBe(true);
    // a title, or any other right in a module, is not enough
    expect(has([grant("ceo"), grant("finance"), grant("cto")])).toBe(false);
    expect(has([grant("employee")], { crmGrants: [{ companyId: "c1", capabilities: ["manage_settings", "assign_owner"] }] })).toBe(false);
    expect(has([grant("employee")], { projects: { grants: [{ companyId: "c1", capabilities: ["assign_pm"] }] } })).toBe(false);
    expect(has([grant("employee")], { inventory: { grants: [{ companyId: "c1", capabilities: ["manage_catalogue", "warehouse"] }] } })).toBe(false);
    expect(has([grant("employee")], { budget: { any: true, finance: true } })).toBe(false);
  });

  it("no longer carries any of the four old access addresses", () => {
    const all = hrefsOf(buildNavModules([grant("sys_admin", null), grant("hr_admin")], {
      crmGrants: [{ companyId: "c1", capabilities: ["founder"] }],
      projects: { grants: [{ companyId: "c1", capabilities: ["founder"] }] },
      inventory: { grants: [{ companyId: "c1", capabilities: ["founder"] }] },
      budget: { any: true, manageAccess: true },
    }));
    for (const gone of ["/admin/users", "/sales/access", "/projects/access", "/inventory/access"]) expect(all).not.toContain(gone);
    expect(all.filter((h) => h === "/people-access")).toHaveLength(1);
  });

  it("always includes the base links every signed-in user gets, regardless of role", () => {
    expect(hrefsOf(buildNavModules([]))).toEqual(
      expect.arrayContaining(["/", "/profile", "/attendance", "/leave", "/attendance-clock", "/reimbursements", "/letters", "/performance", "/holidays", "/policies"]),
    );
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

  it("shows Approvals but hides Payroll for a Reporting Manager", () => {
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
    expect(hrefs).toContain("/people-access");
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
      // "/employees" is no longer offered to someone with no reports and no company-level role (the page showed them only their own row).
      employee: ["/", "/profile", "/attendance-clock", "/attendance", "/leave", "/reimbursements", "/performance", "/letters", "/policies", "/holidays"],
      hr_admin: ["/approvals", "/alerts", "/payroll", "/assets", "/ai-suggestions", "/audit-log", "/employees"],
      // Users & Roles moved into People & Access; the other sys_admin links are unchanged.
      sys_admin: ["/admin/companies", "/people-access", "/ai-suggestions", "/audit-log"],
    };
    expect(hrefsOf(buildNavModules([grant("employee")]))).toEqual(expect.arrayContaining(OLD_HREFS_BY_ROLE.employee!));
    // An HR Admin keeps every old address; /attendance and /letters are the company register and letters desk for them (labelled so), not "My" pages.
    expect(hrefsOf(buildNavModules([grant("hr_admin")]))).toEqual(expect.arrayContaining([...OLD_HREFS_BY_ROLE.employee!, ...OLD_HREFS_BY_ROLE.hr_admin!]));
    expect(hrefsOf(buildNavModules([grant("sys_admin", null)]))).toEqual(expect.arrayContaining(OLD_HREFS_BY_ROLE.sys_admin!));
  });
});

describe("ENGINIOUS OS modules", () => {
  it("shows an ordinary employee only My Day, Me and Company information: no placeholder, no HR module", () => {
    const mods = buildNavModules([grant("employee")]);
    expect(mods.map((m) => m.label)).toEqual(["My Day", "Me", "Company information"]);
    expect(mods.some((m) => m.comingSoon)).toBe(false);
    // Nothing in the menu is a row without a working link.
    for (const m of mods) {
      expect(m.href).not.toBe("");
      for (const l of m.sections.flatMap((x) => x.links)) {
        expect(l.comingSoon).toBeUndefined();
        expect(l.href).not.toBe("");
      }
    }
  });

  it("has no Vendors & Purchasing, KPIs or Inventory 'coming soon' row for anyone", () => {
    const everyone: Parameters<typeof buildNavModules>[] = [
      [[]],
      [[grant("employee")]],
      [[grant("sys_admin", null)], { inventory: { grants: [], isEmployee: false } }],
      [[grant("ceo"), grant("hr_admin")], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }], inventory: { grants: [{ companyId: "c1", capabilities: ["founder"] }] }, budget: { any: true, finance: true } }],
    ];
    for (const args of everyone) {
      const mods = buildNavModules(...args);
      expect(mods.map((m) => m.label)).not.toEqual(expect.arrayContaining(["Vendors & Purchasing"]));
      expect(mods.map((m) => m.id)).not.toContain("vendors");
      expect(mods.map((m) => m.id)).not.toContain("kpis");
      expect(mods.some((m) => m.comingSoon)).toBe(false);
      expect(JSON.stringify(mods)).not.toContain("Coming soon");
      expect(JSON.stringify(mods)).not.toContain('"KPIs"');
    }
  });

  it("Me holds the eight personal pages, labelled as the person's own, and needs no grant", () => {
    const me = buildNavModules([], { inventory: { grants: [], isEmployee: true } }).find((m) => m.id === "me")!;
    expect(me.sections.flatMap((s) => s.links.map((l) => `${l.label} ${l.href}`))).toEqual([
      "My Profile /profile",
      "My Attendance Clock /attendance-clock",
      "My Attendance /attendance",
      "My Leave /leave",
      "My Reimbursements /reimbursements",
      "My Letters /letters",
      "My Equipment /inventory/mine",
      "My Performance /performance",
    ]);
    // Without a linked employee record there is no equipment link (the other seven need nothing).
    const noRecord = buildNavModules([], { inventory: { grants: [], isEmployee: false } }).find((m) => m.id === "me")!;
    expect(noRecord.sections[0]!.links.map((l) => l.label)).not.toContain("My Equipment");
    expect(noRecord.sections[0]!.links).toHaveLength(7);
  });

  it("Company information holds Holidays and Policies for everyone", () => {
    for (const grants of [[], [grant("employee")], [grant("hr_admin")], [grant("ceo")]]) {
      const c = buildNavModules(grants).find((m) => m.id === "company")!;
      expect(c.label).toBe("Company information");
      expect(c.sections.flatMap((s) => s.links.map((l) => l.href))).toEqual(["/holidays", "/policies"]);
    }
  });

  it("the three misleading labels are gone: no 'Employees', 'Attendance' or 'Performance reviews (HR)' for someone who sees only their own record", () => {
    const labels = (grants: RoleGrant[]) => buildNavModules(grants).flatMap((m) => m.sections.flatMap((s) => s.links.map((l) => l.label)));
    const own = labels([grant("employee")]);
    expect(own).not.toContain("Employees");
    expect(own).not.toContain("Attendance");
    expect(own).not.toContain("Performance reviews (HR)");
    expect(own).toEqual(expect.arrayContaining(["My Attendance", "My Performance"]));
    expect(own).not.toContain("People & HR");
  });

  describe("People & HR is offered only to people who hold something company-level", () => {
    const peopleLabels = (grants: RoleGrant[], o: Parameters<typeof buildNavModules>[1] = {}) => {
      const m = buildNavModules(grants, o).find((x) => x.id === "people");
      return m ? m.sections.flatMap((s) => s.links.map((l) => l.label)) : null;
    };
    it.each([
      ["a plain employee", [grant("employee")], {}],
      ["no roles", [], {}],
      ["a CRM founder (access only is not a People & HR job on its own, but People & Access is)", [grant("employee")], { crmGrants: [{ companyId: "c1", capabilities: ["manage_settings"] as never[] }] }],
    ])("is absent for %s", (_n, grants, o) => {
      expect(peopleLabels(grants as RoleGrant[], o)).toBeNull();
    });
    it("is offered with the Employees directory to a manager (role or any direct report), HR, Finance, CEO, CTO and a Sys Admin", () => {
      for (const g of [[grant("line_manager")], [grant("hr_admin")], [grant("finance")], [grant("ceo")], [grant("cto")], [grant("sys_admin", null)]]) {
        expect(peopleLabels(g)).toContain("Employees");
      }
      expect(peopleLabels([grant("employee")], { hasDirectReports: true })).toEqual(["Employees"]);
      expect(peopleLabels([grant("employee")], { hasDirectReports: false })).toBeNull();
    });
    it("gives a person who only manages access People & Access and nothing else", () => {
      expect(peopleLabels([grant("employee")], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] })).toEqual(["People & Access"]);
      const mod = buildNavModules([grant("employee")], { budget: { any: false, manageAccess: true } }).find((m) => m.id === "people")!;
      expect(mod.href).toBe("/people-access");
    });
    it("for HR, /attendance and /letters are the company register and the letters desk, labelled so and not duplicated under Me", () => {
      const mods = buildNavModules([grant("hr_admin")]);
      const all = mods.flatMap((m) => m.sections.flatMap((s) => s.links.map((l) => `${m.id}:${l.label}:${l.href}`)));
      expect(all).toContain("people:Attendance register:/attendance");
      expect(all).toContain("people:Letters:/letters");
      expect(all.filter((x) => x.endsWith(":/attendance"))).toHaveLength(1);
      expect(all.filter((x) => x.endsWith(":/letters"))).toHaveLength(1);
      expect(all).not.toContain("me:My Attendance:/attendance");
    });
    it("never shows the same address twice in the whole menu, whatever the combination of responsibilities", () => {
      const combos: [RoleGrant[], Parameters<typeof buildNavModules>[1]][] = [
        [[grant("employee")], {}],
        [[grant("hr_admin"), grant("finance"), grant("sys_admin", null)], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }], projects: { grants: [{ companyId: "c1", capabilities: ["founder"] }] }, inventory: { grants: [{ companyId: "c1", capabilities: ["founder"] }], isEmployee: true }, budget: { any: true, manageAccess: true } }],
        [[grant("line_manager")], { projects: { grants: [{ companyId: "c1", capabilities: [] }], managesProjects: true }, inventory: { grants: [], managesProjects: true, isEmployee: true }, hasDirectReports: true }],
        [[grant("ceo")], { inventory: { grants: [{ companyId: "c1", capabilities: ["warehouse"] }], isEmployee: false } }],
      ];
      for (const [g, o] of combos) {
        const mods = buildNavModules(g, o);
        const links = mods.flatMap((m) => m.sections.flatMap((x) => x.links.map((l) => l.href)));
        expect(links.filter((h, i) => links.indexOf(h) !== i), `duplicate link in ${JSON.stringify(mods.map((m) => m.id))}`).toEqual([]);
        expect(new Set(mods.map((m) => m.id)).size).toBe(mods.length);
      }
    });
    it("merges several responsibilities into one sidebar: Me and People & HR once each", () => {
      const mods = buildNavModules([grant("line_manager"), grant("finance")], { projects: { grants: [{ companyId: "c1", capabilities: [] }] }, crmGrants: [{ companyId: "c1", capabilities: [] }], budget: { any: true } });
      expect(mods.map((m) => m.id)).toEqual(["my-day", "approvals", "sales", "me", "people", "projects", "finance", "company"]);
    });
  });

  it("puts Sales & CRM after My Day (and Approvals) only for people with a Sales grant, whatever their HR roles", () => {
    const grants = [{ companyId: "company-1", capabilities: [] as never[] }];
    const withAccess = buildNavModules([], { crmGrants: grants });
    expect(withAccess.map((m) => m.id)).toContain("sales");
    expect(withAccess.find((m) => m.id === "sales")?.href).toBe("/sales/follow-ups");
    for (const hr of [grant("hr_admin"), grant("ceo"), grant("sys_admin"), grant("finance")]) {
      expect(hrefsOf(buildNavModules([hr]))).not.toContain("/sales");
      expect(buildNavModules([hr], { crmGrants: [] }).map((m) => m.id)).not.toContain("sales");
    }
  });

  it("shows Sales Settings only to people who can manage them, and People & Access only to those who can manage access", () => {
    const plain = hrefsOf(buildNavModules([], { crmGrants: [{ companyId: "c1", capabilities: [] }] }));
    expect(plain).toEqual(expect.arrayContaining(["/sales/follow-ups", "/sales/opportunities", "/sales/reports", "/sales/clients", "/sales/proposals"]));
    expect(plain).not.toContain("/sales/settings");
    expect(plain).not.toContain("/people-access");
    const settingsOnly = hrefsOf(buildNavModules([], { crmGrants: [{ companyId: "c1", capabilities: ["manage_settings"] }] }));
    expect(settingsOnly).toContain("/sales/settings");
    expect(settingsOnly).not.toContain("/people-access");
    const founder = hrefsOf(buildNavModules([], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] }));
    expect(founder).toEqual(expect.arrayContaining(["/sales/settings", "/people-access"]));
    expect(founder).not.toContain("/sales/access");
  });

  it("does not let a Sales grant change any HR link", () => {
    const hr = (m: NavModuleData[]) => hrefsOf(m.filter((x) => x.id !== "sales"));
    const base = buildNavModules([grant("employee")]);
    const withCrm = buildNavModules([grant("employee")], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] });
    // The one difference is the new People & Access entry, offered because a founder manages Sales access; no HR page appears or disappears.
    expect(hr(withCrm).filter((h) => h !== "/people-access")).toEqual(hr(base));
  });

  it("never carries a function across the server/client boundary", () => {
    assertNoFunctions(buildNavModules([grant("hr_admin")], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] }));
  });

  it("search lists only real, permitted pages", () => {
    const groups = navGroupsFromModules(buildNavModules([grant("employee")]));
    const labels = groups.flatMap((g) => g.links.map((l) => l.label));
    expect(labels).not.toContain("Inventory");
    expect(labels).not.toContain("KPIs");
    expect(labels).not.toContain("Payroll");
    expect(labels).toContain("My Leave");
    expect(groups.map((g) => g.label)).toEqual(["My Day", "Me", "Company information"]);
  });
});

describe("active module and breadcrumb", () => {
  const modules = buildNavModules([grant("hr_admin")], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] });
  it.each([
    ["/", "my-day"],
    ["/approvals", "approvals"],
    ["/sales/follow-ups", "sales"],
    ["/sales/clients", "sales"],
    ["/sales/opportunities/abc", "sales"],
    ["/employees/123", "people"],
    ["/attendance", "people"],
    ["/attendance-clock", "me"],
    ["/leave/new", "me"],
    ["/performance/goals", "me"],
    ["/holidays", "company"],
    ["/policies/abc", "company"],
  ])("%s belongs to %s", (path, id) => {
    expect(activeModuleId(path, modules)).toBe(id);
  });
  it("a page that is not in the navigation belongs to no module", () => {
    expect(activeModuleId("/account/security", modules)).toBeNull();
  });
  it("names the module and the most specific page", () => {
    expect(breadcrumbFor("/sales/opportunities/abc", modules)).toEqual({ module: "Sales & CRM", page: "Enquiries" });
    expect(breadcrumbFor("/attendance-clock", modules)).toEqual({ module: "Me", page: "My Attendance Clock" });
    expect(breadcrumbFor("/attendance", modules)).toEqual({ module: "People & HR", page: "Attendance register" });
    expect(breadcrumbFor("/leave", modules)).toEqual({ module: "Me", page: "My Leave" });
    expect(breadcrumbFor("/policies", modules)).toEqual({ module: "Company information", page: "Policies" });
    expect(breadcrumbFor("/", modules)).toEqual({ module: "My Day", page: null });
    expect(breadcrumbFor("/sales/follow-ups", modules)).toEqual({ module: "Sales & CRM", page: null });
  });
});

/** What the sidebar actually lists: secondary destinations are left out (they stay reachable by search and from the pages that own them). */
function menuLabels(modules: NavModuleData[], id: string): string[] {
  return (modules.find((m) => m.id === id)?.sections ?? []).flatMap((s) => s.links.filter((l) => !l.secondary && !l.comingSoon).map((l) => l.label));
}

describe("simplified Sales & CRM menu", () => {
  const founder = buildNavModules([], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] });
  const plain = buildNavModules([], { crmGrants: [{ companyId: "c1", capabilities: [] }] });

  it("lists four destinations for an ordinary salesperson, and nothing for settings or access", () => {
    expect(menuLabels(plain, "sales")).toEqual(["Follow-ups", "Enquiries", "Clients & Agencies", "Reports"]);
  });
  it("puts Settings under its own Manage heading, only for those who may use it (access is under People & Access)", () => {
    expect(menuLabels(founder, "sales")).toEqual(["Follow-ups", "Enquiries", "Clients & Agencies", "Reports", "Settings"]);
    const manage = founder.find((m) => m.id === "sales")?.sections.find((s) => s.label === "Manage");
    expect(manage?.links.map((l) => l.href)).toEqual(["/sales/settings"]);
    expect(plain.find((m) => m.id === "sales")?.sections.some((s) => s.label === "Manage")).toBe(false);
  });
  it("keeps contacts, proposals, the pipeline board and the full new-enquiry form out of the menu but findable", () => {
    const secondary = founder.find((m) => m.id === "sales")!.sections.flatMap((s) => s.links.filter((l) => l.secondary).map((l) => l.href));
    expect(secondary).toEqual(expect.arrayContaining(["/sales/clients", "/sales/proposals", "/sales/pipeline", "/sales/opportunities?add=1"]));
    const palette = navGroupsFromModules(founder).find((g) => g.label === "Sales & CRM")!.links.map((l) => l.label);
    expect(palette).toEqual(expect.arrayContaining(["Follow-ups", "Enquiries", "Clients & Agencies", "Reports", "Clients & contacts", "Proposals & quotes", "Pipeline board", "New enquiry", "Settings"]));
  });
});

describe("simplified Projects & Tasks menu", () => {
  const mk = (capabilities: string[] = [], extra: { salesLinked?: boolean; pendingHandovers?: boolean; managesProjects?: boolean } = {}) =>
    buildNavModules([], { projects: { grants: [{ companyId: "c1", capabilities: capabilities as never[] }], ...extra } });

  it("lists My Work, Projects and Calendar for everyone with access", () => {
    expect(menuLabels(mk(), "projects")).toEqual(["My Work", "Projects", "Calendar"]);
  });
  it("opens on My Work for people who only take part, and on the directory for founders, PM assigners and Project Managers", () => {
    expect(mk().find((m) => m.id === "projects")?.href).toBe("/projects/work");
    expect(mk(["founder"]).find((m) => m.id === "projects")?.href).toBe("/projects");
    expect(mk(["assign_pm"]).find((m) => m.id === "projects")?.href).toBe("/projects");
    expect(mk([], { managesProjects: true }).find((m) => m.id === "projects")?.href).toBe("/projects");
    expect(buildNavModules([], { projects: { grants: [], salesLinked: true } }).find((m) => m.id === "projects")?.href).toBe("/projects");
  });
  it("puts Handovers under Manage for those who may use it, and New internal project out of the menu", () => {
    expect(menuLabels(mk(["founder"]), "projects")).toEqual(["My Work", "Projects", "Calendar", "Handovers"]);
    expect(menuLabels(mk([], { pendingHandovers: true }), "projects")).toEqual(["My Work", "Projects", "Calendar", "Handovers"]);
    const secondary = mk(["assign_pm"]).find((m) => m.id === "projects")!.sections.flatMap((s) => s.links.filter((l) => l.secondary).map((l) => l.href));
    expect(secondary).toEqual(["/projects/new"]);
    expect(menuLabels(mk(), "projects")).not.toContain("Handovers");
  });
});

describe("Projects & Tasks navigation", () => {
  const proj = (capabilities: string[] = [], extra: { salesLinked?: boolean; pendingHandovers?: boolean } = {}) =>
    ({ projects: { grants: [{ companyId: "c1", capabilities: capabilities as never[] }], ...extra } });

  it("is absent for everyone without a Projects grant or a Sales link, whatever their HR roles or Sales grants", () => {
    for (const hr of [grant("hr_admin"), grant("ceo"), grant("sys_admin"), grant("finance"), grant("employee")]) {
      expect(buildNavModules([hr]).map((m) => m.id)).not.toContain("projects");
      expect(hrefsOf(buildNavModules([hr], { crmGrants: [{ companyId: "c1", capabilities: ["founder"] }] }))).not.toContain("/projects");
    }
    expect(buildNavModules([], { projects: { grants: [] } }).map((m) => m.id)).not.toContain("projects");
  });

  it("gives a plain grant holder the directory, My Work and the calendar, and nothing administrative", () => {
    const hrefs = hrefsOf(buildNavModules([], proj()));
    expect(hrefs).toEqual(expect.arrayContaining(["/projects", "/projects/work", "/projects/calendar"]));
    for (const h of ["/projects/handovers", "/projects/new", "/projects/access"]) expect(hrefs).not.toContain(h);
  });

  it("shows Handovers and New internal project to people who can assign a PM, and People & Access to those who manage access", () => {
    expect(hrefsOf(buildNavModules([], proj(["assign_pm"])))).toEqual(expect.arrayContaining(["/projects/handovers", "/projects/new"]));
    expect(hrefsOf(buildNavModules([], proj(["assign_pm"])))).not.toContain("/people-access");
    expect(hrefsOf(buildNavModules([], proj(["manage_access"])))).toContain("/people-access");
    expect(hrefsOf(buildNavModules([], proj(["founder"])))).toEqual(expect.arrayContaining(["/projects/handovers", "/projects/new", "/people-access"]));
  });

  it("shows Handovers to a PM who has one waiting for acceptance", () => {
    expect(hrefsOf(buildNavModules([], proj([], { pendingHandovers: true })))).toContain("/projects/handovers");
    expect(hrefsOf(buildNavModules([], proj()))).not.toContain("/projects/handovers");
  });

  it("gives a Sales-linked person with no Projects grant only the directory of their own projects", () => {
    const hrefs = hrefsOf(buildNavModules([], { projects: { grants: [], salesLinked: true } }));
    expect(hrefs).toContain("/projects");
    for (const h of ["/projects/work", "/projects/calendar", "/projects/handovers", "/projects/new", "/projects/access"]) expect(hrefs).not.toContain(h);
  });

  it("adds no HR link for a Projects grant, and its icons resolve", () => {
    const base = hrefsOf(buildNavModules([grant("employee")]));
    const withProj = hrefsOf(buildNavModules([grant("employee")], proj(["founder"])));
    expect(base.every((h) => withProj.includes(h))).toBe(true);
    for (const key of iconKeysOf(buildNavModules([], proj(["founder"])))) expect(NAV_ICONS[key as keyof typeof NAV_ICONS]).toBeDefined();
  });

  it("marks Projects as the active module for its pages", () => {
    const modules = buildNavModules([grant("employee")], proj(["founder"]));
    expect(activeModuleId("/projects/abc/tasks", modules)).toBe("projects");
    expect(activeModuleId("/projects/work", modules)).toBe("projects");
    expect(breadcrumbFor("/projects/work", modules)).toEqual({ module: "Projects & Tasks", page: "My Work" });
  });
});

describe("Inventory navigation", () => {
  const inv = (...caps: string[]) => ({ grants: [{ companyId: "c1", capabilities: caps as never[] }] });
  const sectionLinks = (mods: ReturnType<typeof buildNavModules>) => mods.find((m) => m.id === "inventory")!.sections.flatMap((s) => s.links.map((l) => `${s.label}:${l.label}${l.secondary ? "*" : ""}`));

  it("has no Inventory module (and no placeholder) for people with no Inventory involvement, whatever their HR roles", () => {
    for (const roles of [[grant("employee")], [grant("hr_admin")], [grant("ceo")], [grant("sys_admin")], [grant("finance")]]) {
      for (const isEmployee of [false, true]) {
        expect(buildNavModules(roles, { inventory: { grants: [], managesProjects: false, isEmployee } }).find((m) => m.id === "inventory")).toBeUndefined();
      }
    }
    // a failed lookup behaves the same: nothing for that module, never a placeholder
    expect(buildNavModules([grant("employee")]).find((m) => m.id === "inventory")).toBeUndefined();
  });

  it("puts an employee's own equipment under Me, not in an Inventory module of one link", () => {
    const mods = buildNavModules([grant("employee")], { inventory: { grants: [], isEmployee: true } });
    expect(mods.find((m) => m.id === "inventory")).toBeUndefined();
    expect(mods.find((m) => m.id === "me")!.sections[0]!.links.map((l) => l.href)).toContain("/inventory/mine");
    expect(activeModuleId("/inventory/mine", mods)).toBe("me");
  });

  it("shows Today, Stock and History to a warehouse operator, with Requests, My equipment, Scan and who holds what kept out of the menu", () => {
    const links = sectionLinks(buildNavModules([grant("employee")], { inventory: inv("warehouse") }));
    expect(links).toEqual(["Inventory:Today", "Inventory:Stock", "Inventory:History", "Inventory:Requests*", "Inventory:My equipment*", "Inventory:Scan a label*", "Inventory:Equipment held by people*"]);
    // With a linked employee record the same page is in Me instead (never listed twice).
    const linked = buildNavModules([grant("employee")], { inventory: { ...inv("warehouse"), isEmployee: true } });
    expect(sectionLinks(linked)).not.toContain("Inventory:My equipment*");
    expect(hrefsOf(linked).filter((h) => h === "/inventory/mine")).toHaveLength(1);
  });

  it("offers 'Equipment held by people' (kept out of the menu, inside Stock) only to HR custody access, founders and warehouse operators", () => {
    const held = (mods: ReturnType<typeof buildNavModules>) => sectionLinks(mods).filter((l) => l.includes("Equipment held by"));
    expect(held(buildNavModules([], { inventory: inv("view_employee_custody") }))).toEqual(["Inventory:Equipment held by people*"]);
    expect(held(buildNavModules([], { inventory: inv("founder") }))).toEqual(["Inventory:Equipment held by people*"]);
    expect(held(buildNavModules([], { inventory: inv("warehouse") }))).toEqual(["Inventory:Equipment held by people*"]);
    // Nothing for stock readers, catalogue managers, department heads, project managers or plain employees: whatever their HR roles.
    for (const caps of [["view_stock"], ["manage_catalogue"], ["request_for_employees"], ["view_costs"], []]) {
      expect(held(buildNavModules([grant("hr_admin")], { inventory: inv(...caps) }))).toEqual([]);
    }
    expect(held(buildNavModules([grant("hr_admin")], { inventory: { grants: [], managesProjects: true, isEmployee: true } }))).toEqual([]);
    expect(buildNavModules([grant("ceo")], { inventory: { grants: [], isEmployee: true } }).find((m) => m.id === "inventory")).toBeUndefined();
    // It is a real destination: found by search and it lights up Inventory, but it is not a menu row.
    const mods = buildNavModules([], { inventory: inv("view_employee_custody") });
    const link = mods.find((m) => m.id === "inventory")!.sections.flatMap((s) => s.links).find((l) => l.href === "/inventory/stock?view=people");
    expect(link?.secondary).toBe(true);
    expect(activeModuleId("/inventory/stock", mods)).toBe("inventory");
  });

  it("gives a Project Manager Stock (the catalogue) and Requests but neither Today nor History, and a plain Inventory grant no History", () => {
    expect(sectionLinks(buildNavModules([], { inventory: { grants: [], managesProjects: true, isEmployee: true } }))).toEqual([
      "Inventory:Stock", "Inventory:Requests", "Inventory:Scan a label*",
    ]);
    expect(sectionLinks(buildNavModules([], { inventory: inv() }))).not.toContain("Inventory:History");
  });

  it("shows Setup under Manage only to the people who can use it (access is under People & Access)", () => {
    expect(sectionLinks(buildNavModules([], { inventory: inv("warehouse") }))).not.toContain("Manage:Setup");
    expect(sectionLinks(buildNavModules([], { inventory: inv("manage_catalogue") }))).toContain("Manage:Setup");
    expect(sectionLinks(buildNavModules([], { inventory: inv("manage_access") }))).not.toContain("Manage:Access");
    expect(hrefsOf(buildNavModules([], { inventory: inv("manage_access") }))).toContain("/people-access");
    expect(hrefsOf(buildNavModules([], { inventory: inv("manage_catalogue") }))).not.toContain("/people-access");
    const founder = sectionLinks(buildNavModules([], { inventory: inv("founder") }));
    expect(founder).toEqual(expect.arrayContaining(["Manage:Setup", "Inventory:History"]));
    expect(founder).not.toContain("Manage:Access");
  });

  it("opens the module on the page that suits the person", () => {
    const entry = (o: Parameters<typeof buildNavModules>[1]) => buildNavModules([], o).find((m) => m.id === "inventory")!.href;
    expect(entry({ inventory: inv("warehouse") })).toBe("/inventory");
    expect(entry({ inventory: { grants: [], managesProjects: true } })).toBe("/inventory/requests");
    expect(entry({ inventory: { grants: [], managesProjects: true, isEmployee: true } })).toBe("/inventory/requests");
  });

  describe("Finance (Project Budget & Expenses)", () => {
    it("carries the waiting number only when there is one; zero or unknown adds nothing", () => {
      const mod = (waiting?: number) => buildNavModules([grant("employee")], { budget: { any: true, finance: true, ...(waiting === undefined ? {} : { waiting }) } }).find((m) => m.id === "finance")!;
      expect(mod(4).waiting).toBe(4);
      expect(mod(0).waiting).toBeUndefined();
      expect(mod().waiting).toBeUndefined();
    });
    it("is offered only to people holding their own budget access, never from an HR role", () => {
      const hrRoles = [grant("hr_admin"), grant("finance"), grant("ceo"), grant("sys_admin")];
      expect(buildNavModules(hrRoles).find((m) => m.id === "finance")).toBeUndefined();
      expect(buildNavModules(hrRoles, { budget: { any: false } }).find((m) => m.id === "finance")).toBeUndefined();
      const mod = buildNavModules([grant("employee")], { budget: { any: true, finance: true } }).find((m) => m.id === "finance")!;
      expect(mod.href).toBe("/finance/project-budgets");
      expect(mod.sections.flatMap((x) => x.links.map((l) => l.label))).toEqual(["Project budgets"]);
    });
    it("lights up for its own pages and appears in search", () => {
      const mods = buildNavModules([grant("employee")], { budget: { any: true } });
      expect(activeModuleId("/finance/project-budgets/abc", mods)).toBe("finance");
      expect(breadcrumbFor("/finance/project-budgets", mods)).toEqual({ module: "Finance", page: null });
      expect(navGroupsFromModules(mods).find((g) => g.label === "Finance")?.links.map((l) => l.href)).toEqual(["/finance/project-budgets"]);
    });
  });
});
