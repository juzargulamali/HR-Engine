import { redirect } from "next/navigation";
import type { CrmCapability, CrmGrant } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { loadMyPendingApprovalCount } from "@/lib/approvals/pending";
import { isNotInstalled } from "@/lib/projects/errors";
import { logServerError } from "@/lib/log";
import { Alert } from "@/components/ui/alert";
import { LoadError } from "@/components/workspace/states";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/nav/app-shell";
import { OsScope } from "@/components/os/scope";
import { loadInventoryNavAccess } from "@/lib/inventory/context";
import { loadBudgetNavAccess, loadBudgetWaitingCount } from "@/lib/budget/data";
import { loadProjectsNavAccess } from "@/lib/projects/context";
import { loadDirectReportsNav } from "@/lib/nav/direct-reports";
import { getLauncherState } from "@/lib/jarvis/launcher";
import { JarvisLauncher } from "@/components/jarvis/jarvis-launcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();

  // Belt-and-braces: proxy.ts (this app's equivalent of Next middleware,
  // see PUBLIC_PATHS there) already redirects a signed-out request to
  // /login before it reaches here. This only fires if that ever changes.
  if (!session) redirect("/login");

  // Drives the header's attendance status (clocked in since when, or not). A failure here must never break the whole authenticated
  // shell, but it is not "not clocked in" either: the header then says the status is unknown and offers a retry.
  let clockOpenSince: string | null = null;
  let clockLoadFailed = false;
  if (session.employeeId) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("attendance_sessions")
        .select("clock_in_at")
        .eq("employee_id", session.employeeId)
        .eq("status", "open")
        .maybeSingle();
      if (error) {
        logServerError({ route: "layout", operation: "read my open attendance session" }, error);
        clockLoadFailed = true;
      } else {
        clockOpenSince = data?.clock_in_at ?? null;
      }
    } catch (error) {
      logServerError({ route: "layout", operation: "read my open attendance session" }, error);
      clockLoadFailed = true;
    }
  }

  // An ordinary employee who is a project lead has no approval-capable role,
  // so the menu would hide Approvals from exactly the person who has a request
  // waiting. Show it whenever something is waiting on THIS user's own decision
  // (by name, or a Recovery Leave queue step they may decide: the same rule as the Approvals page).
  // When the count could not be read the link stays visible (the page itself says what it could not load),
  // and the layout says that part of the menu could not be loaded.
  let hasPendingApprovals = false;
  let menuLoadFailed = false;
  try {
    const supabase = await createClient();
    hasPendingApprovals = (await loadMyPendingApprovalCount(supabase, session)) > 0;
  } catch (error) {
    logServerError({ route: "layout", operation: "count my pending approvals" }, error);
    hasPendingApprovals = true;
    menuLoadFailed = true;
  }

  // Sales & CRM is shown only to people holding a CRM grant (its own table, not an HR role); the grants themselves (company +
  // capabilities) decide which Sales pages appear. Degrades to "no access" on any failure — including the CRM tables not
  // existing yet — so the HR shell can never be broken by it.
  let crmGrants: CrmGrant[] = [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("crm_company_grants").select("company_id, capabilities").eq("user_id", session.userId).is("revoked_at", null);
    if (!error) crmGrants = (data ?? []).map((g) => ({ companyId: g.company_id, capabilities: g.capabilities as CrmCapability[] }));
    else if (!isNotInstalled(error)) menuLoadFailed = true;
  } catch {
    crmGrants = [];
    menuLoadFailed = true;
  }

  // Projects & Tasks: its own company grants, a Sales link, or a handover waiting on this person. Degrades to "no access" on any failure.
  const projects = await loadProjectsNavAccess(session.userId);
  // Inventory: its own company grants, a running project, or an employee record. A failed read shows no entry and the notice below.
  const inventory = await loadInventoryNavAccess(session.userId);
  // Project Budget & Expenses: the person's own Finance / view grants only. Degrades to no entry on any failure, including the module not being installed yet.
  const budget = await loadBudgetNavAccess(session.userId);
  // Direct reports decide whether a manager without the Reporting Manager role is offered "People & HR". Unknown keeps the entry.
  const directReports = await loadDirectReportsNav(await createClient(), session.employeeId);
  if (projects.loadFailed || inventory.loadFailed || budget.loadFailed || directReports.loadFailed) menuLoadFailed = true;
  // The Finance entry's "waiting for your decision" number: one small function (not the whole inbox), asked only of people who can decide. A failed read shows no number
  // (never 0) and the same banner as any other menu part that could not load.
  let budgetWaiting: number | undefined;
  if (budget.any && budget.canDecide) {
    const waiting = await loadBudgetWaitingCount();
    if (waiting.state === "ok") budgetWaiting = waiting.count;
    else if (waiting.state === "error") menuLoadFailed = true;
  }

  // JARVIS (the assistant): the launcher is drawn only when the server says this person may use it (switch on, on the pilot list, a Sales grant, a provider and a secret
  // configured). Any failure means no launcher and nothing else changes. Hiding it is a convenience: every JARVIS call checks the same things again on the server.
  const jarvis = await getLauncherState(session.userId);

  return (
    <>
    <AppShell session={session} clockOpenSince={clockOpenSince} clockLoadFailed={clockLoadFailed} hasPendingApprovals={hasPendingApprovals} crmGrants={crmGrants} projects={projects} inventory={inventory} budget={{ ...budget, ...(budgetWaiting ? { waiting: budgetWaiting } : {}) }} hasDirectReports={directReports.hasDirectReports}>
      <OsScope>
        {session.loadFailed || menuLoadFailed ? (
          <div className="mb-4 space-y-3">
            {session.loadFailed ? <LoadError what="your account" note="This is a problem loading the information, not a missing role or employee record." /> : null}
            {menuLoadFailed ? <Alert variant="warning" role="status">Some menu items could not be loaded, so an entry you have access to may be missing. Reload the page.</Alert> : null}
          </div>
        ) : null}
        {children}
      </OsScope>
    </AppShell>
    {jarvis.available ? <JarvisLauncher companies={jarvis.companies} writes={jarvis.writes} maxInputChars={jarvis.maxInputChars} enabledActionIds={jarvis.enabledActionIds} /> : null}
    </>
  );
}
