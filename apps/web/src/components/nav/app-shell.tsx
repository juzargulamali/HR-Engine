import { canViewHrAlerts, roleLabelsFor } from "@enginious-hr/domain";
import type { CrmGrant, InvGrant, ProjGrant } from "@enginious-hr/domain";
import type { CurrentSession } from "@/lib/auth/session";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { DesktopSidebar } from "./sidebar-nav";
import { ShellChrome } from "./shell-chrome";
import { buildNavModules } from "./nav-groups";

/**
 * The ENGINIOUS OS shell: module sidebar (desktop), header with breadcrumb / search / attendance status, mobile menu and
 * bottom bar. Everything it offers is filtered by the person's real HR roles and Sales grants; it grants nothing itself.
 */
export function AppShell({
  session,
  clockOpenSince = null,
  clockLoadFailed = false,
  hasPendingApprovals = false,
  crmGrants = [],
  projects,
  inventory,
  budget,
  hasDirectReports = false,
  sidebarCollapsed = false,
  children,
}: {
  session: CurrentSession;
  /** Start of this employee's open attendance session, or null when there is none. */
  clockOpenSince?: string | null;
  /** The attendance status could not be read: the header says it is unknown instead of "not clocked in". */
  clockLoadFailed?: boolean;
  hasPendingApprovals?: boolean;
  crmGrants?: readonly CrmGrant[];
  /** Projects access (own grants, Sales link, waiting handover). Absent means none: the module is then not shown. */
  projects?: { grants: readonly ProjGrant[]; salesLinked?: boolean; pendingHandovers?: boolean; managesProjects?: boolean };
  inventory?: { grants: readonly InvGrant[]; managesProjects?: boolean; isEmployee?: boolean };
  /** Project Budget & Expenses access (own grants). Absent means none: no Finance entry. */
  budget?: { any: boolean; finance?: boolean; manageAccess?: boolean; waiting?: number };
  /** The person has direct reports: offers "People & HR" to a manager who does not hold the Reporting Manager role. */
  hasDirectReports?: boolean;
  /** The desktop sidebar was left collapsed (read from a cookie by the layout), so it is drawn that way from the first paint. */
  sidebarCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const roleLabels = roleLabelsFor(session.grants);
  const showAlertsLink = canViewHrAlerts(session.grants);
  const modules = buildNavModules(session.grants, { hasPendingApprovals, crmGrants, projects, inventory, budget, hasDirectReports });
  const fullName = session.fullName ?? session.email ?? "Signed in";

  const signOutSlot = (
    <form action={signOut}>
      <Button variant="ghost" size="sm" type="submit" className="justify-start text-muted-foreground hover:text-destructive">
        Sign out
      </Button>
    </form>
  );

  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <DesktopSidebar modules={modules} fullName={fullName} email={session.email} roleLabels={roleLabels} signOutSlot={signOutSlot} defaultCollapsed={sidebarCollapsed} />

      <div className="flex min-w-0 flex-1 flex-col">
        <ShellChrome
          modules={modules}
          showAlertsLink={showAlertsLink}
          isEmployee={Boolean(session.employeeId)}
          clockOpenSince={clockOpenSince}
          clockLoadFailed={clockLoadFailed}
          serverNowIso={new Date().toISOString()}
          fullName={fullName}
          email={session.email}
          roleLabels={roleLabels}
          signOutSlot={signOutSlot}
        />
        {/* The bottom padding keeps the last line of every page clear of the mobile bottom bar. */}
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 pb-28 pt-6 outline-none sm:px-6 lg:px-8 lg:pb-12">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
