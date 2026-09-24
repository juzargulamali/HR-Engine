import { canViewHrAlerts, hasRoleAnyScope, isSysAdmin } from "@enginious-hr/domain";
import type { RoleGrant } from "@enginious-hr/domain";

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
  | "users";

export interface NavLinkData {
  href: string;
  label: string;
  iconKey: NavIconKey;
}

export interface NavGroupData {
  label: string;
  links: NavLinkData[];
}

/**
 * Pure function, no React/JSX — every permission gate here mirrors the
 * exact same checks AppShell used before this was extracted (isSysAdmin,
 * hasRoleAnyScope, canViewHrAlerts). Kept separate from AppShell so it can
 * be unit tested directly without rendering anything.
 */
export function buildNavGroups(grants: readonly RoleGrant[]): NavGroupData[] {
  const showAdminLink = isSysAdmin(grants);
  const showInsightsLinks = hasRoleAnyScope(grants, "hr_admin") || hasRoleAnyScope(grants, "sys_admin");
  const showAlertsLink = canViewHrAlerts(grants);
  const showAssetsLink = hasRoleAnyScope(grants, "hr_admin") || hasRoleAnyScope(grants, "finance");

  // Approvals routes through resolve_approver()/resolve_approver_for_company()
  // to one of: the employee's line manager, or role:hr_admin/finance/ceo
  // (cto is a full peer of ceo — see isCLevel's own comment). sys_admin and a
  // plain employee hold none of these, so the link would only ever show an
  // empty "nothing waiting on you" page for them — hidden rather than shown
  // and immediately empty. Purely a UI affordance, same caveat as every
  // other check here: RLS on the approvals table is the real enforcement.
  const showApprovalsLink = (["line_manager", "hr_admin", "finance", "ceo", "cto"] as const).some((role) =>
    hasRoleAnyScope(grants, role),
  );
  // Payroll is an HR/Finance/C-level workflow — sys_admin has no business
  // reason to run payroll, and neither does a plain employee or a line
  // manager acting only as an approver.
  const showPayrollLink = (["hr_admin", "finance", "ceo", "cto"] as const).some((role) => hasRoleAnyScope(grants, role));

  const groups: NavGroupData[] = [
    {
      label: "Overview",
      links: [
        { href: "/", label: "Dashboard", iconKey: "dashboard" },
        { href: "/profile", label: "My Profile", iconKey: "profile" },
      ],
    },
    {
      label: "People",
      links: [
        { href: "/employees", label: "Employees", iconKey: "employees" },
        { href: "/attendance", label: "Attendance", iconKey: "attendance" },
        { href: "/leave", label: "Leave", iconKey: "leave" },
        { href: "/reimbursements", label: "Reimbursements", iconKey: "reimbursements" },
        { href: "/performance", label: "Performance", iconKey: "performance" },
      ],
    },
    {
      label: "Workflow",
      links: [
        ...(showApprovalsLink ? [{ href: "/approvals", label: "Approvals", iconKey: "approvals" as const }] : []),
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
    groups.push({
      label: "Insights",
      links: [
        { href: "/ai-suggestions", label: "AI Suggestions", iconKey: "ai" },
        { href: "/audit-log", label: "Audit Log", iconKey: "audit" },
      ],
    });
  }

  if (showAdminLink) {
    groups.push({
      label: "System",
      links: [{ href: "/admin/users", label: "Users & Roles", iconKey: "users" }],
    });
  }

  return groups;
}
