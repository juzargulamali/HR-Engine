import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/nav/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();

  // Belt-and-braces: proxy.ts (this app's equivalent of Next middleware,
  // see PUBLIC_PATHS there) already redirects a signed-out request to
  // /login before it reaches here. This only fires if that ever changes.
  if (!session) redirect("/login");

  // Drives the mobile ClockFab's badge (clocked in vs. not) — a failure
  // here should never break the whole authenticated shell, so it degrades
  // to "not clocked in" rather than throwing.
  let clockedIn = false;
  if (session.employeeId) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("attendance_sessions")
        .select("id")
        .eq("employee_id", session.employeeId)
        .eq("status", "open")
        .maybeSingle();
      clockedIn = !!data;
    } catch {
      clockedIn = false;
    }
  }

  // An ordinary employee who is a project lead has no approval-capable role,
  // so the menu would hide Approvals from exactly the person who has a request
  // waiting. Show it whenever something is waiting on THIS user's own decision.
  // Degrades to "none waiting" on any failure, like the clock badge above.
  let hasPendingApprovals = false;
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("approver_id", session.userId)
      .eq("decision", "pending");
    hasPendingApprovals = (count ?? 0) > 0;
  } catch {
    hasPendingApprovals = false;
  }

  // Sales & CRM is shown only to people holding a CRM grant (its own table, not an HR role). Degrades to "no access" on
  // any failure — including the CRM tables not existing yet — so the HR shell can never be broken by it.
  let hasCrmAccess = false;
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("crm_company_grants")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.userId)
      .is("revoked_at", null);
    hasCrmAccess = !error && (count ?? 0) > 0;
  } catch {
    hasCrmAccess = false;
  }

  return (
    <AppShell session={session} clockedIn={clockedIn} hasPendingApprovals={hasPendingApprovals} hasCrmAccess={hasCrmAccess}>
      {children}
    </AppShell>
  );
}
