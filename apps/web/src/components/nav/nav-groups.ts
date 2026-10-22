import { canViewHrAlerts, canViewStock, hasCrmCapability, hasInvCapability, hasProjCapability, hasRoleAnyScope, isAnyCrmFounder, isSysAdmin } from "@enginious-hr/domain";
import type { CrmGrant, InvGrant, ProjGrant, RoleGrant } from "@enginious-hr/domain";

/**
 * String keys only — never a component reference. This data crosses from
 * a Server Component (AppShell) into Client Components (SidebarNav,
 * CommandPalette) as props, and React Server Components can only
 * serialize plain data (or already-rendered elements) across that
 * boundary, never a bare function/component reference. See nav-icons.ts,
 * which resolves these keys back to actual lucide-react components inside
 * the client components themselves — never here.
 */
export type NavIconKey =
  | "dashboard"
  | "profile"
  | "clock"
  | "employees"
  | "attendance"
  | "leave"
  | "reimbursements"
  | "performance"
  | "approvals"
  | "alerts"
  | "letters"
  | "payroll"
  | "assets"
  | "policies"
  | "holidays"
  | "companies"
  | "ai"
  | "audit"
  | "users"
  | "sales"
  | "projects"
  | "inventory"
  | "vendors"
  | "kpis"
  | "people"
  | "soon";

export interface NavLinkData {
  href: string;
  label: string;
  iconKey: NavIconKey;
  /** A module that is planned but not built yet: shown muted with the words "Coming soon", never a working link. */
  comingSoon?: boolean;
  /**
   * A real destination that is deliberately kept out of the sidebar so the menu stays short (shared contacts, a proposals search,
   * the full new-enquiry form…). It is still found by search (the command palette), still lights up its module and still works as
   * a bookmark; the pages that own the workflow link to it where it is needed.
   */
  secondary?: boolean;
}

export interface NavGroupData {
  label: string;
  links: NavLinkData[];
}

export type NavModuleId = "my-day" | "approvals" | "sales" | "people" | "projects" | "inventory" | "vendors" | "kpis";

export interface NavModuleData {
  id: NavModuleId;
  label: string;
  iconKey: NavIconKey;
  /** Where the module's own row goes. Empty for a module that is not built yet. */
  href: string;
  comingSoon?: boolean;
  /** Sub-navigation, shown while the module is open. Same permission checks as before, just grouped under the module. */
  sections: NavGroupData[];
}

export interface NavOptions {
  hasPendingApprovals?: boolean;
  /** The person's own Sales (CRM) grants, from crm_company_grants — never HR roles. Empty/undefined means no Sales access. */
  crmGrants?: readonly CrmGrant[];
  /**
   * Projects & Tasks access: the person's own grants from proj_company_grants (never HR roles or Sales grants), whether they are
   * linked to a project as a Sales relationship, and whether a handover is waiting on them. No access means no module.
   */
  projects?: { grants: readonly ProjGrant[]; salesLinked?: boolean; pendingHandovers?: boolean; managesProjects?: boolean };
  /**
   * Inventory access: the person's own grants from inv_company_grants (never HR roles, Sales or Projects grants), whether they run a
   * project (a Project Manager or department head prepares equipment requests without a stock grant), and whether they are an
   * employee with a linked record (every employee can see the equipment assigned to them). No access of any kind means "Coming soon".
   */
  inventory?: { grants: readonly InvGrant[]; managesProjects?: boolean; isEmployee?: boolean };
}

/**
 * Pure function, no React/JSX — every permission gate here mirrors the exact checks AppShell used before the move to the
 * ENGINIOUS OS module navigation (isSysAdmin, hasRoleAnyScope, canViewHrAlerts). Kept separate from AppShell so it can be
 * unit tested directly without rendering anything. Navigation only shapes what is offered: RLS and the page's own checks
 * remain the real enforcement.
 */
export function buildNavModules(grants: readonly RoleGrant[], options: NavOptions = {}): NavModuleData[] {
  const crmGrants = options.crmGrants ?? [];
  const hasCrmAccess = crmGrants.length > 0;
  const showAdminLink = isSysAdmin(grants);
  const showInsightsLinks = hasRoleAnyScope(grants, "hr_admin") || hasRoleAnyScope(grants, "sys_admin");
  const showAlertsLink = canViewHrAlerts(grants);
  const showAssetsLink = hasRoleAnyScope(grants, "hr_admin") || hasRoleAnyScope(grants, "finance");

  // Approvals routes through resolve_approver()/resolve_approver_for_company()
  // to one of: the employee's line manager, or role:hr_admin/finance/ceo
  // (cto is a full peer of ceo — see isCLevel's own comment). sys_admin and a
  // plain employee hold none of these, so the link would only ever show an
  // empty "nothing waiting on you" page for them — hidden rather than shown
  // and immediately empty. ...plus anyone who currently HAS something waiting
  // on their own decision: a project lead is an ordinary employee with no
  // approval-capable role, yet the lead's step of a Recovery Leave request
  // lands in their own Approvals.
  const showApprovalsLink =
    options.hasPendingApprovals === true ||
    (["line_manager", "hr_admin", "finance", "ceo", "cto"] as const).some((role) => hasRoleAnyScope(grants, role));
  // Payroll is an HR/Finance/C-level workflow — sys_admin has no business
  // reason to run payroll, and neither does a plain employee or a line
  // manager acting only as an approver.
  const showPayrollLink = (["hr_admin", "finance", "ceo", "cto"] as const).some((role) => hasRoleAnyScope(grants, role));

  const modules: NavModuleData[] = [{ id: "my-day", label: "My Day", iconKey: "dashboard", href: "/", sections: [] }];

  if (showApprovalsLink) {
    modules.push({ id: "approvals", label: "Approvals", iconKey: "approvals", href: "/approvals", sections: [] });
  }

  // Sales & CRM has its own company-scoped access (crm_company_grants), independent of HR roles: shown only to people
  // granted it. Settings and Access appear only to those who can use them (the same rule the Sales pages apply).
  if (hasCrmAccess) {
    const manageSettings = crmGrants.some((g) => hasCrmCapability([g], g.companyId, "manage_settings"));
    const manageAccess = crmGrants.some((g) => hasCrmCapability([g], g.companyId, "manage_access"));
    const manage: NavLinkData[] = [
      ...(manageSettings || isAnyCrmFounder(crmGrants) ? [{ href: "/sales/settings", label: "Settings", iconKey: "sales" as const }] : []),
      ...(manageAccess ? [{ href: "/sales/access", label: "Access", iconKey: "sales" as const }] : []),
    ];
    modules.push({
      id: "sales",
      label: "Sales & CRM",
      iconKey: "sales",
      href: "/sales/follow-ups",
      sections: [
        {
          label: "Sales & CRM",
          links: [
            { href: "/sales/follow-ups", label: "Follow-ups", iconKey: "sales" },
            { href: "/sales/opportunities", label: "Enquiries", iconKey: "sales" },
            { href: "/sales/reports", label: "Reports", iconKey: "sales" },
            // Reachable from Enquiries and by search; not in the menu.
            { href: "/sales/opportunities?add=1", label: "New enquiry", iconKey: "sales", secondary: true },
            { href: "/sales/clients", label: "Clients & contacts", iconKey: "sales", secondary: true },
            { href: "/sales/proposals", label: "Proposals & quotes", iconKey: "sales", secondary: true },
            { href: "/sales/pipeline", label: "Pipeline board", iconKey: "sales", secondary: true },
          ],
        },
        // Specialist settings live under their own heading, shown only to the people who can use them.
        ...(manage.length > 0 ? [{ label: "Manage", links: manage }] : []),
      ],
    });
  }

  const peopleSections: NavGroupData[] = [
    {
      label: "Me",
      links: [
        { href: "/profile", label: "My Profile", iconKey: "profile" },
        { href: "/attendance-clock", label: "My Attendance Clock", iconKey: "clock" },
      ],
    },
    {
      label: "People",
      links: [
        { href: "/employees", label: "Employees", iconKey: "employees" },
        { href: "/attendance", label: "Attendance", iconKey: "attendance" },
        { href: "/leave", label: "Leave", iconKey: "leave" },
        { href: "/reimbursements", label: "Reimbursements", iconKey: "reimbursements" },
      ],
    },
    {
      label: "Workflow",
      links: [
        ...(showAlertsLink ? [{ href: "/alerts", label: "Alerts", iconKey: "alerts" as const }] : []),
        { href: "/letters", label: "Letters", iconKey: "letters" },
        ...(showPayrollLink ? [{ href: "/payroll", label: "Payroll", iconKey: "payroll" as const }] : []),
      ],
    },
    {
      label: "Organisation",
      links: [
        ...(showAssetsLink ? [{ href: "/assets", label: "Assets", iconKey: "assets" as const }] : []),
        { href: "/policies", label: "Policies", iconKey: "policies" },
        { href: "/holidays", label: "Holidays", iconKey: "holidays" },
        ...(showAdminLink ? [{ href: "/admin/companies", label: "Companies", iconKey: "companies" as const }] : []),
      ],
    },
  ];
  if (showInsightsLinks) {
    peopleSections.push({
      label: "Insights",
      links: [
        { href: "/ai-suggestions", label: "AI Suggestions", iconKey: "ai" },
        { href: "/audit-log", label: "Audit Log", iconKey: "audit" },
      ],
    });
  }
  if (showAdminLink) {
    peopleSections.push({ label: "System", links: [{ href: "/admin/users", label: "Users & Roles", iconKey: "users" }] });
  }
  modules.push({ id: "people", label: "People & HR", iconKey: "people", href: "/employees", sections: peopleSections });

  // Projects & Tasks has its own company-scoped access (proj_company_grants), independent of HR roles and Sales grants: shown only
  // to people granted it, or linked to a project as Sales (who see their own projects and nothing else). Handovers, new internal
  // projects and Access appear only to those who can use them (the same rule the pages and the database apply).
  const proj = options.projects;
  const projGrants = proj?.grants ?? [];
  if (projGrants.length > 0 || proj?.salesLinked) {
    const anyCap = (cap: Parameters<typeof hasProjCapability>[2]) => projGrants.some((g) => hasProjCapability([g], g.companyId, cap));
    const leads = anyCap("founder") || anyCap("assign_pm") || proj?.managesProjects === true;
    // People who only take part in projects land on their own work; founders, PM assigners and Project Managers land on the directory.
    // Either way the other one is one click away.
    const entry = projGrants.length > 0 && !leads ? "/projects/work" : "/projects";
    const mainLinks: NavLinkData[] =
      projGrants.length > 0
        ? [
            { href: "/projects/work", label: "My Work", iconKey: "projects" },
            { href: "/projects", label: "Projects", iconKey: "projects" },
            { href: "/projects/calendar", label: "Calendar", iconKey: "projects" },
          ]
        : [{ href: "/projects", label: "Projects", iconKey: "projects" }];
    if (projGrants.length > 0 && anyCap("assign_pm")) mainLinks.push({ href: "/projects/new", label: "New internal project", iconKey: "projects", secondary: true });
    const manage: NavLinkData[] = [];
    if (projGrants.length > 0) {
      if (anyCap("assign_pm") || proj?.pendingHandovers) manage.push({ href: "/projects/handovers", label: "Handovers", iconKey: "projects" });
      if (anyCap("manage_access")) manage.push({ href: "/projects/access", label: "Access", iconKey: "projects" });
    }
    modules.push({
      id: "projects",
      label: "Projects & Tasks",
      iconKey: "projects",
      href: entry,
      sections: [{ label: "Projects & Tasks", links: mainLinks }, ...(manage.length > 0 ? [{ label: "Manage", links: manage }] : [])],
    });
  }

  // Inventory has its own company-scoped access (inv_company_grants), independent of HR roles, Sales and Projects grants. Three working
  // sections (Inventory, Requests, Movements) for people with a grant; Project Managers and department heads see the catalogue and their
  // requests; every employee sees the equipment assigned to them. Setup and Access appear only to those who can use them.
  const inv = options.inventory;
  const invGrants = inv?.grants ?? [];
  const invGrantee = invGrants.length > 0;
  const invAnyCap = (cap: Parameters<typeof hasInvCapability>[2]) => invGrants.some((g) => hasInvCapability([g], g.companyId, cap));
  const invStock = invGrants.some((g) => canViewStock([g], g.companyId));
  const invPlanner = invGrantee || inv?.managesProjects === true;
  if (invPlanner || inv?.isEmployee === true) {
    const mainLinks: NavLinkData[] = invPlanner
      ? [
          { href: "/inventory", label: "Inventory", iconKey: "inventory" },
          { href: "/inventory/requests", label: "Requests", iconKey: "inventory" },
          ...(invStock || invAnyCap("founder") ? [{ href: "/inventory/movements", label: "Movements", iconKey: "inventory" as const }] : []),
          { href: "/inventory/mine", label: "My equipment", iconKey: "inventory", secondary: true },
          { href: "/inventory/scan", label: "Scan a label", iconKey: "inventory", secondary: true },
          // Which company equipment each employee holds: for HR custody access, founders and warehouse operators (the page and the database check again).
          ...(invAnyCap("view_employee_custody") || invAnyCap("founder") || invAnyCap("warehouse")
            ? [{ href: "/inventory/employees", label: "Equipment held by employees", iconKey: "inventory" as const, secondary: true }]
            : []),
        ]
      : [{ href: "/inventory/mine", label: "My equipment", iconKey: "inventory" }];
    const manage: NavLinkData[] = [];
    if (invAnyCap("manage_catalogue") || invAnyCap("founder")) manage.push({ href: "/inventory/manage", label: "Setup", iconKey: "inventory" });
    if (invAnyCap("manage_access")) manage.push({ href: "/inventory/access", label: "Access", iconKey: "inventory" });
    modules.push({
      id: "inventory",
      label: "Inventory",
      iconKey: "inventory",
      href: invPlanner ? (invGrantee ? "/inventory" : "/inventory/requests") : "/inventory/mine",
      sections: [{ label: "Inventory", links: mainLinks }, ...(manage.length > 0 ? [{ label: "Manage", links: manage }] : [])],
    });
  }

  // Modules that are planned but not built: visible to everyone so the roadmap is honest, never links, never any data.
  modules.push(
    ...(invPlanner || inv?.isEmployee === true ? [] : [{ id: "inventory" as const, label: "Inventory", iconKey: "inventory" as const, href: "", comingSoon: true, sections: [] }]),
    { id: "vendors", label: "Vendors & Purchasing", iconKey: "vendors", href: "", comingSoon: true, sections: [] },
    // The existing HR appraisals and goals stay reachable (and are called what they are); the future KPI module is marked.
    {
      id: "kpis",
      label: "KPIs & Performance",
      iconKey: "kpis",
      href: "/performance",
      sections: [
        {
          label: "KPIs & Performance",
          links: [
            { href: "/performance", label: "Performance reviews (HR)", iconKey: "performance" },
            { href: "", label: "KPIs", iconKey: "soon", comingSoon: true },
          ],
        },
      ],
    },
  );

  return modules;
}

/** Every real (non-"coming soon") link a person can reach through the module navigation, grouped by module, for search. */
export function navGroupsFromModules(modules: readonly NavModuleData[]): NavGroupData[] {
  return modules
    .filter((m) => !m.comingSoon)
    .map((m) => ({
      label: m.label,
      links: m.sections.length > 0 ? m.sections.flatMap((s) => s.links.filter((l) => !l.comingSoon)) : [{ href: m.href, label: m.label, iconKey: m.iconKey }],
    }));
}

/** True when `pathname` belongs to this link (exact for "/", prefix otherwise). */
export function isLinkActive(pathname: string, href: string): boolean {
  if (!href) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Which module owns `pathname`. The most specific link wins, so "/attendance-clock" is not swallowed by "/attendance", and
 * a Sales page never lights up People & HR.
 */
export function activeModuleId(pathname: string, modules: readonly NavModuleData[]): NavModuleId | null {
  let best: { id: NavModuleId; len: number } | null = null;
  for (const m of modules) {
    if (m.comingSoon) continue;
    const hrefs = [m.href, ...m.sections.flatMap((s) => s.links.filter((l) => !l.comingSoon).map((l) => l.href))];
    for (const h of hrefs) {
      if (isLinkActive(pathname, h) && (best === null || h.length > best.len)) best = { id: m.id, len: h.length };
    }
  }
  return best?.id ?? null;
}

/** "Module / Page" for the header. The page part is omitted on a module's own landing page and on pages that are not in the navigation. */
export function breadcrumbFor(pathname: string, modules: readonly NavModuleData[]): { module: string | null; page: string | null } {
  const id = activeModuleId(pathname, modules);
  const m = modules.find((x) => x.id === id);
  if (!m) return { module: null, page: null };
  let best: NavLinkData | null = null;
  for (const s of m.sections) {
    for (const l of s.links) {
      if (!l.comingSoon && isLinkActive(pathname, l.href) && (best === null || l.href.length > best.href.length)) best = l;
    }
  }
  const page = best && best.href !== m.href ? best.label : null;
  return { module: m.label, page };
}
