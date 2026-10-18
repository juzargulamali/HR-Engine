import { redirect } from "next/navigation";
import type { CrmCapability, CrmGrant } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/nav/app-shell";
import { loadProjectsNavAccess } from "@/lib/projects/context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();

  // Belt-and-braces: proxy.ts (this app's equivalent of Next middleware,
  // see PUBLIC_PATHS there) already redirects a signed-out request to
  // /login before it reaches here. This only fires if that ever changes.
  if (!session) redirect("/login");

  // Drives the header's attendance status (clocked in since when, or not) — a failure here should never break the whole
  // authenticated shell, so it degrades to "not clocked in" rather than throwing.
  let clockOpenSince: string | null = null;
  if (session.employeeId) {
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("attendance_sessions")
        .select("clock_in_at")
        .eq("employee_id", session.employeeId)
        .eq("status", "open")
        .maybeSingle();
      clockOpenSince = data?.clock_in_at ?? null;
    } catch {
      clockOpenSince = null;
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

  // Sales & CRM is shown only to people holding a CRM grant (its own table, not an HR role); the grants themselves (company +
  // capabilities) decide which Sales pages appear. Degrades to "no access" on any failure — including the CRM tables not
  // existing yet — so the HR shell can never be broken by it.
  let crmGrants: CrmGrant[] = [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("crm_company_grants").select("company_id, capabilities").eq("user_id", session.userId).is("revoked_at", null);
    if (!error) crmGrants = (data ?? []).map((g) => ({ companyId: g.company_id, capabilities: g.capabilities as CrmCapability[] }));
  } catch {
    crmGrants = [];
  }

  // Projects & Tasks: its own company grants, a Sales link, or a handover waiting on this person. Degrades to "no access" on any failure.
  const projects = await loadProjectsNavAccess(session.userId);

  return (
    <AppShell session={session} clockOpenSince={clockOpenSince} hasPendingApprovals={hasPendingApprovals} crmGrants={crmGrants} projects={projects}>
      {children}
    </AppShell>
  );
}
