import { canEditEmployeeCore, getBusinessDateString, resolveCountryTimeZone, type RoleGrant } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { expiryState } from "./document-types";
import { computeExceptions, computeSetup, type Exception } from "./setup";

/**
 * The actionable flags the employee directory shows beside a row. Read for the page's rows only (at most one page of ids), through the viewer's own session,
 * so row level security decides what comes back. A kind of record the viewer cannot see, or whose read failed, is `null` and its flag is hidden: it is never
 * shown as "to do". Flags are computed only for people the viewer can manage (HR Admin of that company): a line manager or Finance sees the same list as
 * before, without setup flags, because the records those flags read are not theirs to see.
 *
 * "No manager" is NOT said here: whether someone is at the top of the organisation needs one database call per row (employee_is_c_level), which a list should
 * not make. The profile's Overview says it, where the call is made once.
 */
export interface DirectoryRow {
  id: string;
  employment_status: "active" | "on_leave" | "suspended" | "terminated";
  company_id: string;
  country_code: string;
  job_title: string | null;
  manager_id: string | null;
  deleted_at: string | null;
}

export interface DirectoryFacts {
  contracts: ReadonlyMap<string, number> | null;
  compensation: ReadonlyMap<string, number> | null;
  identity: ReadonlyArray<{ employee_id: string; expiry_date: string | null }> | null;
  documents: ReadonlyArray<{ employee_id: string; expiry_date: string | null }> | null;
  opening: ReadonlyMap<string, number> | null;
  scheduled: ReadonlyMap<string, number> | null;
  linked: ReadonlyMap<string, string | null>;
}

const count = (m: ReadonlyMap<string, number> | null, id: string) => (m === null ? null : (m.get(id) ?? 0));

/** Pure: facts in, flags out (one list per employee id). Rows the viewer cannot manage get no flags. */
export function buildDirectoryExceptions(rows: readonly DirectoryRow[], facts: DirectoryFacts, canManage: (companyId: string) => boolean): Map<string, Exception[]> {
  const out = new Map<string, Exception[]>();
  for (const r of rows) {
    if (!canManage(r.company_id)) continue;
    const today = getBusinessDateString(resolveCountryTimeZone(r.country_code));
    const identity = facts.identity ? facts.identity.filter((d) => d.employee_id === r.id) : null;
    const documents = facts.documents ? facts.documents.filter((d) => d.employee_id === r.id) : null;
    const states = [...(identity ?? []), ...(documents ?? [])].map((d) => expiryState(d.expiry_date, today));
    const known = identity !== null || documents !== null;
    const steps = computeSetup({
      employeeId: r.id,
      employmentStatus: r.employment_status,
      removed: r.deleted_at !== null,
      counts: {
        contracts: count(facts.contracts, r.id),
        compensation: count(facts.compensation, r.id),
        identityDocuments: identity === null ? null : identity.length,
        employeeDocuments: documents === null ? null : documents.length,
        openingBalances: count(facts.opening, r.id),
      },
      linkedUserId: facts.linked.get(r.id) ?? null,
      // An HR Admin (the only viewer flags are computed for) cannot invite; the step's own link says who can.
      viewerCanInvite: false,
      viewerCanOpenAccess: false,
    });
    out.set(r.id, computeExceptions({
      employeeId: r.id,
      employmentStatus: r.employment_status,
      removed: r.deleted_at !== null,
      jobTitle: r.job_title,
      managerId: r.manager_id,
      managerNotExpected: true,
      steps,
      expiredDocuments: known ? states.filter((s) => s === "expired").length : null,
      expiringDocuments: known ? states.filter((s) => s === "expiring").length : null,
      scheduledChanges: count(facts.scheduled, r.id),
    }));
  }
  return out;
}

type Db = Awaited<ReturnType<typeof createClient>>;
type Err = { message?: string } | null;
const tally = (rows: ReadonlyArray<{ employee_id: string }> | null, error: Err): Map<string, number> | null => {
  if (error || !rows) return null;
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.employee_id, (m.get(r.employee_id) ?? 0) + 1);
  return m;
};

/** Reads the facts for the rows the viewer can manage, in a handful of batched queries. Never throws: a failed query makes that kind of flag unknown. */
export async function loadDirectoryExceptions(
  supabase: Db,
  rows: readonly (DirectoryRow & { user_id?: string | null })[],
  grants: readonly RoleGrant[],
): Promise<Map<string, Exception[]>> {
  const canManage = (companyId: string) => canEditEmployeeCore(grants as RoleGrant[], companyId);
  const ids = rows.filter((r) => canManage(r.company_id)).map((r) => r.id);
  if (ids.length === 0) return new Map();

  const safe = async <T,>(run: () => PromiseLike<{ data: T | null; error: Err }>): Promise<{ data: T | null; error: Err }> => {
    try { return await run(); } catch (e) { return { data: null, error: { message: String(e) } }; }
  };
  const [contracts, comp, identity, docs, leave, compDays, scheduled] = await Promise.all([
    safe(() => supabase.from("employment_contracts").select("employee_id").in("employee_id", ids)),
    safe(() => supabase.from("compensation_details").select("employee_id").in("employee_id", ids)),
    safe(() => supabase.from("identity_documents").select("employee_id, expiry_date").in("employee_id", ids)),
    safe(() => supabase.from("employee_documents").select("employee_id, expiry_date").in("employee_id", ids).is("deleted_at", null)),
    safe(() => supabase.from("leave_ledger").select("employee_id").in("employee_id", ids).eq("reference_type", "opening_balance")),
    safe(() => supabase.from("comp_day_ledger").select("employee_id").in("employee_id", ids).eq("source", "opening_balance")),
    // `applied_at` is added by the People & HR migration; before it is installed this read fails and the flag is simply hidden.
    safe(() => (supabase as unknown as { from: (t: string) => { select: (c: string) => { in: (c: string, v: string[]) => { is: (c: string, v: null) => PromiseLike<{ data: { employee_id: string }[] | null; error: Err }> } } } })
      .from("employee_career_events").select("employee_id").in("employee_id", ids).is("applied_at", null)),
  ]);

  const leaveTally = tally(leave.data, leave.error);
  const compTally = tally(compDays.data, compDays.error);
  const opening = leaveTally && compTally ? new Map([...leaveTally].concat([...compTally]).reduce((m, [k, v]) => m.set(k, (m.get(k) ?? 0) + v), new Map<string, number>())) : null;

  const facts: DirectoryFacts = {
    contracts: tally(contracts.data, contracts.error),
    compensation: tally(comp.data, comp.error),
    identity: identity.error ? null : (identity.data ?? []),
    documents: docs.error ? null : (docs.data ?? []),
    opening,
    scheduled: tally(scheduled.data, scheduled.error),
    linked: new Map(rows.map((r) => [r.id, r.user_id ?? null])),
  };
  return buildDirectoryExceptions(rows, facts, canManage);
}
