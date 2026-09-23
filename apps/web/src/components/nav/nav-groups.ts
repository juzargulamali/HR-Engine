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
        { href: "/approvals", label: "Approvals", iconKey: "approvals" },
        ...(showAlertsLink ? [{ href: "/alerts", label: "Alerts", iconKey: "alerts" as const }] : []),
        { href: "/letters", label: "Letters", iconKey: "letters" },
        { href: "/payroll", label: "Payroll", iconKey: "payroll" },
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
