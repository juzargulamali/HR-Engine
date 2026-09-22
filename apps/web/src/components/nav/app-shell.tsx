import Image from "next/image";
import Link from "next/link";
import { canViewHrAlerts, hasRoleAnyScope, isSysAdmin, ROLE_LABELS } from "@enginious-hr/domain";
import type { CurrentSession } from "@/lib/auth/session";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarNav, type NavGroup } from "./sidebar-nav";

export function AppShell({ session, children }: { session: CurrentSession; children: React.ReactNode }) {
  const roleLabels = [...new Set(session.grants.map((g) => ROLE_LABELS[g.role]))];
  const showAdminLink = isSysAdmin(session.grants);
  const showInsightsLinks = hasRoleAnyScope(session.grants, "hr_admin") || hasRoleAnyScope(session.grants, "sys_admin");
  const showAlertsLink = canViewHrAlerts(session.grants);
  const showAssetsLink = hasRoleAnyScope(session.grants, "hr_admin") || hasRoleAnyScope(session.grants, "finance");

  const groups: NavGroup[] = [
    {
      label: "Overview",
      links: [
        { href: "/", label: "Dashboard" },
        { href: "/profile", label: "My Profile" },
      ],
    },
    {
      label: "People",
      links: [
        { href: "/employees", label: "Employees" },
        ...(showAlertsLink ? [{ href: "/alerts", label: "Alerts" }] : []),
        { href: "/leave", label: "Leave" },
        { href: "/reimbursements", label: "Reimbursements" },
        { href: "/timesheets", label: "Timesheets" },
        { href: "/performance", label: "Performance" },
        { href: "/approvals", label: "Approvals" },
      ],
    },
    {
      label: "Operations",
      links: [
        { href: "/letters", label: "Letters" },
        { href: "/payroll", label: "Payroll" },
        ...(showAssetsLink ? [{ href: "/assets", label: "Assets" }] : []),
        { href: "/policies", label: "Policies" },
        { href: "/holidays", label: "Holidays" },
      ],
    },
    ...(showInsightsLinks
      ? [
          {
            label: "Insights",
            links: [
              { href: "/ai-suggestions", label: "AI Suggestions" },
              { href: "/audit-log", label: "Audit Log" },
            ],
          },
        ]
      : []),
    ...(showAdminLink
      ? [
          {
            label: "System",
            links: [
              { href: "/admin/companies", label: "Companies" },
              { href: "/admin/users", label: "Users & Roles" },
            ],
          },
        ]
      : []),
  ];

  const userSummary = (
    <div className="text-right">
      <div className="text-sm font-medium">{session.fullName ?? session.email}</div>
      <div className="mt-0.5 flex justify-end gap-1">
        {roleLabels.length > 0 ? (
          roleLabels.map((label) => (
            <Badge key={label} variant="brand" className="text-[10px]">
              {label}
            </Badge>
          ))
        ) : (
          <Badge variant="outline" className="text-[10px]">
            No role assigned yet
          </Badge>
        )}
      </div>
    </div>
  );

  const signOutButton = (
    <form action={signOut}>
      <Button variant="outline" size="sm" type="submit">
        Sign out
      </Button>
    </form>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <SidebarNav groups={groups} userSummary={userSummary} signOutButton={signOutButton} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="hidden items-center justify-between gap-4 border-b border-border bg-card px-8 py-3 md:flex">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/brand/enginious-icon.png" alt="Enginious" width={28} height={28} priority />
            <div className="leading-tight">
              <div className="font-heading text-sm font-bold tracking-tight">ENGINIOUS</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">HR Engine</div>
            </div>
          </Link>

          <div className="ml-auto flex items-center gap-3">
            {userSummary}
            {signOutButton}
          </div>
        </header>

        <main className="flex-1 px-4 py-8 md:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
