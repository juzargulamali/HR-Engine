import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildTeamRows, teamScope, type BalanceRow, type CompRow, type RequestRow, type TeamEmployee, type TeamRow } from "./team";

type Client = Awaited<ReturnType<typeof createClient>>;

/** How many people are read at most. More than this is said, never silently cut. */
export const TEAM_LIMIT = 200;
const CHUNK = 40;

async function inChunks<T>(ids: string[], read: (part: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) return null;
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * Everyone the viewer's own session can read, apart from themselves, with their leave. `failed` is true when the people themselves could not be read (the
 * table then says so); the three figure sources fail on their own. Returns no rows for a person who can read nobody else, so the section stays away.
 */
export async function loadLeaveTeam(supabase: Client, viewer: { employeeId: string; grants: readonly { role: string; companyId: string | null }[] }, today: string): Promise<{ failed: boolean; rows: TeamRow[]; total: number; capped: boolean }> {
  const scope = teamScope(viewer.grants);
  let q = supabase
    .from("employees")
    .select("id, first_name, last_name, job_title, employment_status", { count: "exact" })
    .neq("id", viewer.employeeId)
    .is("deleted_at", null)
    .neq("employment_status", "terminated");
  if (scope.mode === "reports") q = q.eq("manager_id", viewer.employeeId);
  if (scope.mode === "companies") q = q.or(`manager_id.eq.${viewer.employeeId},company_id.in.(${scope.companyIds.join(",")})`);
  const { data, error, count } = await q.order("first_name").order("id").limit(TEAM_LIMIT);
  if (error) {
    console.error("[leave] team could not be loaded", error);
    return { failed: true, rows: [], total: 0, capped: false };
  }
  const employees = (Array.isArray(data) ? data : []) as TeamEmployee[];
  if (employees.length === 0) return { failed: false, rows: [], total: 0, capped: false };
  const ids = employees.map((e) => e.id);
  const [balances, comp, requests] = await Promise.all([
    inChunks<BalanceRow>(ids, (p) => supabase.from("leave_balances").select("employee_id, leave_type_code, balance_days").in("employee_id", p)),
    inChunks<CompRow>(ids, (p) => supabase.from("comp_day_balances").select("employee_id, balance_days").in("employee_id", p)),
    // Waiting requests (whatever their dates) and approved leave that has not ended yet.
    inChunks<RequestRow>(ids, (p) => supabase.from("leave_requests").select("employee_id, status, start_date, end_date").in("employee_id", p).or(`status.in.(submitted,pending_approval),and(status.eq.approved,end_date.gte.${today})`).limit(5000)),
  ]);
  if (balances === null || comp === null || requests === null) console.error("[leave] part of the team leave figures could not be loaded", { balances: balances === null, comp: comp === null, requests: requests === null });
  const total = count ?? employees.length;
  return { failed: false, rows: buildTeamRows({ employees, balances, comp, requests }, today), total, capped: total > employees.length };
}
