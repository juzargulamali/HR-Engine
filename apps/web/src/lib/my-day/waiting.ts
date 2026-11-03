import type { createClient } from "@/lib/supabase/server";
import type { RequestStatus } from "@/types/database.types";

type Client = Awaited<ReturnType<typeof createClient>>;

export type WaitingSource = "leave" | "claims" | "recovery";
/** One source of "Waiting on others": how many of the person's own requests wait for a decision, and when the oldest was submitted. A failed read is its own state, never a zero. */
export type WaitingResult =
  | { status: "ok"; count: number; oldest: string | null; /** Who the waiting requests are with ("Pia Manager", "the HR queue"), when the person's own session can read it. */ with?: string; /** The "with whom" read failed: the row says so instead of staying silent. */ withFailed?: true }
  | { status: "error" };

const PENDING: RequestStatus[] = ["submitted", "pending_approval"];

const oldestOf = (rows: readonly (string | null)[]): string | null => rows.filter((r): r is string => !!r).sort()[0] ?? null;

const APPROVAL_ENTITY: Record<WaitingSource, string> = { leave: "leave_request", claims: "reimbursement_claim", recovery: "recovery_credit" };

/** A shared queue is named as a queue (never one invented person): who may decide is the people holding these roles. */
export function queueLabel(roles: readonly string[]): string {
  const has = (r: string) => roles.includes(r);
  if (has("hr_admin")) return "the HR queue";
  if (has("finance")) return "the Finance queue";
  if (has("ceo") || has("cto")) return "the CEO or CTO queue";
  return `the ${roles.map((r) => r.replace(/_/g, " ")).join(" or ")} queue`;
}

type PendingStep = { entity_type: string; entity_id: string; approver_id: string | null; queue_roles: string[] | null };

/**
 * The person's own requests that were submitted and still wait for someone's decision: leave requests, expense claims and Recovery Leave requests. Every query
 * is filtered to their own employee record and runs through their own session, so these are exactly the rows they can already read on their own pages.
 * The three reads are independent (Promise.allSettled): one that fails gives its own error result and the others still list.
 */
export async function loadMyWaitingRequests(supabase: Client, employeeId: string): Promise<Record<WaitingSource, WaitingResult>> {
  const reads = {
    leave: async () => {
      const { data, error } = await supabase.from("leave_requests").select("id, submitted_at").eq("employee_id", employeeId).in("status", PENDING).is("deleted_at", null).limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id as string, at: r.submitted_at as string | null }));
    },
    claims: async () => {
      const { data, error } = await supabase.from("reimbursement_claims").select("id, submitted_at, created_at").eq("employee_id", employeeId).in("status", PENDING).is("deleted_at", null).limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id as string, at: (r.submitted_at ?? r.created_at) as string | null }));
    },
    recovery: async () => {
      const { data, error } = await supabase.from("recovery_credit_requests").select("id, submitted_at").eq("employee_id", employeeId).in("status", PENDING).limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id as string, at: r.submitted_at as string | null }));
    },
  };
  const keys = Object.keys(reads) as WaitingSource[];
  const settled = await Promise.allSettled(keys.map((k) => reads[k]()));
  const out = {} as Record<WaitingSource, WaitingResult>;
  keys.forEach((k, i) => {
    const r = settled[i]!;
    out[k] = r.status === "fulfilled" ? { status: "ok", count: r.value.length, oldest: oldestOf(r.value.map((x) => x.at)) } : { status: "error" };
  });

  // Who each waiting request is with: its current approval step, readable by the person who made the request (approvals_select, owner branch). One extra read for
  // all three sources; if it fails the rows keep their count and age and say that who decides could not be loaded.
  const ids = keys.flatMap((k, i) => { const r = settled[i]!; return r.status === "fulfilled" ? r.value.map((x) => x.id) : []; });
  if (ids.length === 0) return out;
  try {
    const { data: steps, error } = await supabase.from("approvals").select("entity_type, entity_id, approver_id, queue_roles").eq("decision", "pending").in("entity_id", ids).limit(500);
    if (error) throw error;
    const pending = (steps ?? []) as PendingStep[];
    const people = [...new Set(pending.map((x) => x.approver_id).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (people.length > 0) {
      const { data: profiles, error: pe } = await supabase.from("profiles").select("id, full_name, email").in("id", people);
      if (pe) throw pe;
      for (const p of profiles ?? []) names.set(p.id as string, (p.full_name as string | null)?.trim() || (p.email as string | null)?.split("@")[0] || "an approver");
    }
    keys.forEach((k, i) => {
      const r = settled[i]!;
      const res = out[k]!;
      if (r.status !== "fulfilled" || res.status !== "ok" || r.value.length === 0) return;
      const mine = new Set(r.value.map((x) => x.id));
      const who = new Set<string>();
      for (const st of pending) {
        if (st.entity_type !== APPROVAL_ENTITY[k] || !mine.has(st.entity_id)) continue;
        if (st.approver_id) who.add(names.get(st.approver_id) ?? "an approver");
        else if (st.queue_roles && st.queue_roles.length > 0) who.add(queueLabel(st.queue_roles));
      }
      if (who.size === 1) res.with = [...who][0]!;
      else if (who.size > 1) res.with = `${who.size} different approvers`;
    });
  } catch {
    for (const k of keys) { const res = out[k]!; if (res.status === "ok" && res.count > 0) res.withFailed = true; }
  }
  return out;
}

/** "Oldest waiting 3 days", "Oldest submitted today": whole calendar days between the submission and now. */
export function waitingText(since: string | null, now: Date): string | undefined {
  if (!since) return undefined;
  const ms = now.getTime() - new Date(since).getTime();
  if (!Number.isFinite(ms)) return undefined;
  const days = Math.max(0, Math.floor(ms / 86_400_000));
  return days === 0 ? "Oldest submitted today" : `Oldest waiting ${days} ${days === 1 ? "day" : "days"}`;
}

/** "Waiting 3 days" / "Waiting since today" for a request that waits on the viewer's decision. */
export function waitingAgeText(since: string | null | undefined, now: Date): string | undefined {
  if (!since) return undefined;
  const ms = now.getTime() - new Date(since).getTime();
  if (!Number.isFinite(ms)) return undefined;
  const days = Math.max(0, Math.floor(ms / 86_400_000));
  return days === 0 ? "Waiting since today" : `Waiting ${days} ${days === 1 ? "day" : "days"}`;
}
