import type { RoleGrant } from "@enginious-hr/domain";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * A QUEUE approval step (approver_id null: the legacy role_queue:% mechanism and the newer queue_roles one, both Recovery Leave) belongs to
 * the viewer only when they hold one of its deciding roles in the beneficiary's own company, and never when the request is their own.
 * Mirrors has_role() / decide_leave_approval()'s authorisation. One function, used by the Approvals page and by every count of
 * "waiting on me", so the two can never disagree.
 */
export function isQueueDecisionEligible({
  roles,
  beneficiaryEmployeeId,
  beneficiaryCompanyId,
  viewerEmployeeId,
  grants,
}: {
  /** The deciding roles of the step: its own queue_roles, or the legacy role named on the workflow step. */
  roles: readonly string[];
  beneficiaryEmployeeId: string;
  beneficiaryCompanyId: string | null | undefined;
  viewerEmployeeId: string | null;
  grants: readonly Pick<RoleGrant, "role" | "companyId">[];
}): boolean {
  if (beneficiaryEmployeeId === viewerEmployeeId) return false;
  if (!beneficiaryCompanyId) return false;
  return roles.some((role) => grants.some((g) => g.role === role && (g.companyId === null || g.companyId === beneficiaryCompanyId)));
}

/**
 * How many approvals wait on this person's own decision: the steps routed to them by name, plus the Recovery Leave queue steps they decide now. The queue steps come
 * from the database's own list of what this person may decide (recovery_decider_inbox), because the tables hide some of them from a CEO / CTO (an HR Admin's request on
 * the shared queue) and the badge must agree with the Approvals page. Throws when any read fails, so the caller shows "could not load" and never a false zero.
 */
export async function loadMyPendingApprovals(supabase: Supabase, viewer: { userId: string }): Promise<{ count: number; oldest: string | null }> {
  const [direct, inbox] = await Promise.all([
    // The oldest step comes from the same query as the count (ordered, one row): how long the longest-waiting decision has waited.
    supabase.from("approvals").select("created_at", { count: "exact" }).eq("approver_id", viewer.userId).eq("decision", "pending").order("created_at", { ascending: true }).limit(1),
    supabase.rpc("recovery_decider_inbox"),
  ]);
  if (direct.error) throw direct.error;
  if (inbox.error) throw inbox.error;
  // A step assigned to the person by name is already in the first count; add only the queue steps (no assigned person).
  const queueRows = (inbox.data ?? []).filter((r) => r.approver_id === null);
  const queued = new Set(queueRows.map((r) => r.approval_id));
  const stamps = [(direct.data?.[0] as { created_at?: string } | undefined)?.created_at, ...queueRows.map((r) => r.approval_created_at as string | null)].filter((x): x is string => !!x).sort();
  return { count: (direct.count ?? 0) + queued.size, oldest: stamps[0] ?? null };
}

export async function loadMyPendingApprovalCount(supabase: Supabase, viewer: { userId: string }): Promise<number> {
  return (await loadMyPendingApprovals(supabase, viewer)).count;
}

/** One approval step waiting on this person, with just enough to name it in "Needs me". */
export type PendingApprovalItem = {
  approvalId: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  /** "Leave request: Aisha Khan", "Expense claim: Omar Ali": what it is and whose, when the person's own session can read that. */
  title: string;
  /** A plain date (YYYY-MM-DD) the decision is needed by, when the record has one (a leave request that starts on it). */
  dueDate: string | null;
};

const ENTITY_TITLE: Record<string, string> = {
  leave_request: "Leave request",
  reimbursement_claim: "Expense claim",
  timesheet: "Timesheet",
  generated_letter: "Letter",
  payroll_export_run: "Payroll export",
  recovery_credit: "Recovery Leave request",
};

/**
 * Every approval step that waits on this person's own decision, one item per step, oldest first: the steps routed to them by name plus the Recovery Leave queue steps
 * they decide now (the same two reads as the count above, so they agree). This is the list behind the My Day headline: the headline number IS this list's length.
 * Throws when either read fails (the caller shows "Approvals could not be loaded", never a false zero). The names and dates come from a best-effort second read
 * through the person's own session: when it fails the items keep their type and age and simply do not name the person.
 */
export async function loadMyPendingApprovalItems(supabase: Supabase, viewer: { userId: string }): Promise<PendingApprovalItem[]> {
  const [direct, inbox] = await Promise.all([
    supabase.from("approvals").select("id, entity_type, entity_id, created_at").eq("approver_id", viewer.userId).eq("decision", "pending").order("created_at", { ascending: true }).limit(1000),
    supabase.rpc("recovery_decider_inbox"),
  ]);
  if (direct.error) throw direct.error;
  if (inbox.error) throw inbox.error;
  const byStep = new Map<string, PendingApprovalItem>();
  for (const r of direct.data ?? []) {
    byStep.set(r.id as string, { approvalId: r.id as string, entityType: r.entity_type as string, entityId: r.entity_id as string, createdAt: r.created_at as string, title: ENTITY_TITLE[r.entity_type as string] ?? "Approval", dueDate: null });
  }
  // A queue step (no assigned person) the person decides now; a step assigned by name is already above.
  for (const r of (inbox.data ?? []).filter((x) => x.approver_id === null)) {
    if (byStep.has(r.approval_id)) continue;
    byStep.set(r.approval_id, { approvalId: r.approval_id, entityType: "recovery_credit", entityId: r.id, createdAt: r.approval_created_at as string, title: ENTITY_TITLE.recovery_credit!, dueDate: null });
  }
  const items = [...byStep.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.approvalId.localeCompare(b.approvalId));
  try {
    return await nameApprovals(supabase, items);
  } catch {
    return items;
  }
}

/** Adds whose request it is (and, for leave, the day it starts) to the leave and expense items; every other kind keeps its plain type. */
async function nameApprovals(supabase: Supabase, items: PendingApprovalItem[]): Promise<PendingApprovalItem[]> {
  const ids = (type: string) => items.filter((i) => i.entityType === type).map((i) => i.entityId);
  const [leave, claims] = await Promise.all([
    ids("leave_request").length > 0 ? supabase.from("leave_requests").select("id, employee_id, start_date, end_date").in("id", ids("leave_request")) : Promise.resolve({ data: [], error: null }),
    ids("reimbursement_claim").length > 0 ? supabase.from("reimbursement_claims").select("id, employee_id").in("id", ids("reimbursement_claim")) : Promise.resolve({ data: [], error: null }),
  ]);
  if (leave.error || claims.error) throw new Error("requests could not be read");
  const employeeIds = [...new Set([...(leave.data ?? []), ...(claims.data ?? [])].map((r) => r.employee_id as string))];
  const { data: people, error } = employeeIds.length > 0 ? await supabase.from("employees").select("id, first_name, last_name").in("id", employeeIds) : { data: [], error: null };
  if (error) throw error;
  const name = new Map((people ?? []).map((p) => [p.id as string, `${p.first_name} ${p.last_name}`.trim()]));
  const leaveBy = new Map((leave.data ?? []).map((r) => [r.id as string, r]));
  const claimBy = new Map((claims.data ?? []).map((r) => [r.id as string, r]));
  return items.map((i) => {
    if (i.entityType === "leave_request") {
      const r = leaveBy.get(i.entityId);
      return r ? { ...i, title: `${i.title}: ${name.get(r.employee_id as string) ?? "an employee"}`, dueDate: (r.start_date as string | null) ?? null } : i;
    }
    if (i.entityType === "reimbursement_claim") {
      const r = claimBy.get(i.entityId);
      return r ? { ...i, title: `${i.title}: ${name.get(r.employee_id as string) ?? "an employee"}` } : i;
    }
    return i;
  });
}
