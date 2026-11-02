import type { createClient } from "@/lib/supabase/server";
import type { RequestStatus } from "@/types/database.types";

type Client = Awaited<ReturnType<typeof createClient>>;

export type WaitingSource = "leave" | "claims" | "recovery";
/** One source of "Waiting on others": how many of the person's own requests wait for a decision, and when the oldest was submitted. A failed read is its own state, never a zero. */
export type WaitingResult = { status: "ok"; count: number; oldest: string | null } | { status: "error" };

const PENDING: RequestStatus[] = ["submitted", "pending_approval"];

const oldestOf = (rows: readonly (string | null)[]): string | null => rows.filter((r): r is string => !!r).sort()[0] ?? null;

/**
 * The person's own requests that were submitted and still wait for someone's decision: leave requests, expense claims and Recovery Leave requests. Every query
 * is filtered to their own employee record and runs through their own session, so these are exactly the rows they can already read on their own pages.
 * The three reads are independent (Promise.allSettled): one that fails gives its own error result and the others still list.
 */
export async function loadMyWaitingRequests(supabase: Client, employeeId: string): Promise<Record<WaitingSource, WaitingResult>> {
  const reads = {
    leave: async () => {
      const { data, error } = await supabase.from("leave_requests").select("submitted_at").eq("employee_id", employeeId).in("status", PENDING).is("deleted_at", null).limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => r.submitted_at as string | null);
    },
    claims: async () => {
      const { data, error } = await supabase.from("reimbursement_claims").select("submitted_at, created_at").eq("employee_id", employeeId).in("status", PENDING).is("deleted_at", null).limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => (r.submitted_at ?? r.created_at) as string | null);
    },
    recovery: async () => {
      const { data, error } = await supabase.from("recovery_credit_requests").select("submitted_at").eq("employee_id", employeeId).in("status", PENDING).limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => r.submitted_at as string | null);
    },
  };
  const keys = Object.keys(reads) as WaitingSource[];
  const settled = await Promise.allSettled(keys.map((k) => reads[k]()));
  const out = {} as Record<WaitingSource, WaitingResult>;
  keys.forEach((k, i) => {
    const r = settled[i]!;
    out[k] = r.status === "fulfilled" ? { status: "ok", count: r.value.length, oldest: oldestOf(r.value) } : { status: "error" };
  });
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
