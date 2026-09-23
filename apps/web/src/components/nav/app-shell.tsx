import {
  BellRing,
  Building,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Landmark,
  LayoutDashboard,
  Package,
  Receipt,
  ScrollText,
  Sparkles,
  TrendingUp,
  User,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { canViewHrAlerts, hasRoleAnyScope, isSysAdmin, ROLE_LABELS } from "@enginious-hr/domain";
import type { CurrentSession } from "@/lib/auth/session";
import { signOut } from "@/lib/actions/auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
import { SidebarNav, type NavGroup } from "./sidebar-nav";
import { CommandPalette } from "./command-palette";

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
        { href: "/", label: "Dashboard", icon: LayoutDashboard },
        { href: "/profile", label: "My Profile", icon: User },
      ],
    },
    {
      label: "People",
      links: [
        { href: "/employees", label: "Employees", icon: Users },
        { href: "/attendance", label: "Attendance", icon: CalendarCheck },
        { href: "/leave", label: "Leave", icon: CalendarDays },
        { href: "/reimbursements", label: "Reimbursements", icon: Receipt },
        { href: "/performance", label: "Performance", icon: TrendingUp },
      ],
    },
    {
      label: "Workflow",
      links: [
        { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
        ...(showAlertsLink ? [{ href: "/alerts", label: "Alerts", icon: BellRing }] : []),
        { href: "/letters", label: "Letters", icon: FileText },
        { href: "/payroll", label: "Payroll", icon: Wallet },
      ],
    },
    {
      label: "Organisation",
      links: [
        ...(showAssetsLink ? [{ href: "/assets", label: "Assets", icon: Package }] : []),
        { href: "/policies", label: "Policies", icon: BookOpen },
        { href: "/holidays", label: "Holidays", icon: Landmark },
        ...(showAdminLink ? [{ href: "/admin/companies", label: "Companies", icon: Building }] : []),
      ],
    },
    ...(showInsightsLinks
      ? [
          {
            label: "Insights",
            links: [
              { href: "/ai-suggestions", label: "AI Suggestions", icon: Sparkles },
              { href: "/audit-log", label: "Audit Log", icon: ScrollText },
            ],
          },
        ]
      : []),
    ...(showAdminLink
      ? [
          {
            label: "System",
            links: [{ href: "/admin/users", label: "Users & Roles", icon: UserCog }],
          },
        ]
      : []),
  ];

  const signOutSlot = (
    <form action={signOut}>
      <Button variant="ghost" size="sm" type="submit" className="justify-start text-muted-foreground hover:text-destructive">
        Sign out
      </Button>
    </form>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <SidebarNav groups={groups} fullName={session.fullName ?? session.email ?? "Signed in"} email={session.email} roleLabels={roleLabels} signOutSlot={signOutSlot} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 hidden items-center gap-4 border-b border-border bg-card/95 px-6 py-2.5 backdrop-blur md:flex">
          <CommandPalette groups={groups} />
          <div className="ml-auto flex items-center gap-1.5">
            {showAlertsLink ? (
              <Link href="/alerts" aria-label="Alerts" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9 w-9 px-0")}>
                <BellRing className="h-4 w-4" aria-hidden />
              </Link>
            ) : null}
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-4 py-8 md:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
