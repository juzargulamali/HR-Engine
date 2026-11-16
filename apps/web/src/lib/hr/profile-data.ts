import { getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
import { currentVersions, expiryState } from "./document-types";
import type { QueueItem } from "./queue";
import { computeExceptions, computeSetup, type Exception, type SetupStep } from "./setup";

/**
 * Loads what the profile's setup checklist and next actions need: a handful of bounded, employee-scoped reads, each through the signed-in viewer's own client, so
 * row level security decides what comes back. A read the viewer is not allowed to make, or one that fails, yields `null`: the step or flag is then hidden, never
 * shown as "to do". Nothing here writes.
 */
interface CountResult { count: number | null; error: unknown }
interface RowsResult<T> { data: T[] | null; error: unknown }

/** The slice of the Supabase query builder these reads use, so the mapping can be tested without a database. */
export interface HrReadClient {
  from(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): ProfileQuery;
  };
}
export interface ProfileQuery extends PromiseLike<CountResult & RowsResult<Record<string, unknown>>> {
  eq(column: string, value: unknown): ProfileQuery;
  is(column: string, value: null): ProfileQuery;
}

export const countOrNull = (r: CountResult): number | null => (r.error || r.count === null ? null : r.count);

export interface ProfileViewer {
  canEditCore: boolean;
  canSeeContracts: boolean;
  canSeeComp: boolean;
  canSeeIdentity: boolean;
  canSeeDocuments: boolean;
  canSeeCareerEvents: boolean;
  canInvite: boolean;
  canOpenAccess: boolean;
}

export interface ProfileEmployee {
  id: string;
  country_code: string;
  employment_status: "active" | "on_leave" | "suspended" | "terminated";
  deleted_at: string | null;
  user_id: string | null;
  job_title: string | null;
  manager_id: string | null;
}

export interface DocumentExpiryCounts { expired: number; expiring: number }

interface DocRow { expiry_date: string | null; status?: string | null; document_type?: string; id?: string; created_at?: string }

/** Counts documents that are expired or expiring soon from their dates (the same 60-day look-ahead everywhere). A document with no date is never flagged. */
export function documentExpiryCounts(rows: readonly DocRow[], today: string): DocumentExpiryCounts {
  // The current version of each type is chosen by the shared rule (the newest row, whatever its expiry date, including none) BEFORE expiry is judged: earlier versions are history.
  const typed = rows.filter((r): r is DocRow & { document_type: string; id: string; created_at: string } => !!r.document_type && !!r.id && !!r.created_at);
  const loose = rows.filter((r) => !(r.document_type && r.id && r.created_at));
  let expired = 0;
  let expiring = 0;
  for (const r of [...currentVersions(typed), ...loose]) {
    const s = expiryState(r.expiry_date, today);
    if (s === "expired" || r.status === "expired") expired++;
    else if (s === "expiring" || r.status === "expiring_soon") expiring++;
  }
  return { expired, expiring };
}

export interface ProfileSetupData {
  steps: SetupStep[];
  exceptions: Exception[];
  today: string;
}

export async function loadProfileSetup(
  supabase: HrReadClient,
  employee: ProfileEmployee,
  viewer: ProfileViewer,
  opts: { managerNotExpected: boolean; /** The employee's items from the HR queue, for a viewer who may see it: they replace the plain document counts so the profile and the queue say the same thing. */ queue?: readonly QueueItem[] | null },
): Promise<ProfileSetupData> {
  const today = getBusinessDateString(resolveCountryTimeZone(employee.country_code));
  const e = employee.id;
  const none = Promise.resolve<CountResult & RowsResult<Record<string, unknown>>>({ count: null, data: null, error: "not allowed" });

  const [contracts, compensation, identity, docs, openingLeave, openingComp, scheduled] = await Promise.all([
    viewer.canSeeContracts ? supabase.from("employment_contracts").select("id", { count: "exact", head: true }).eq("employee_id", e) : none,
    viewer.canSeeComp ? supabase.from("compensation_details").select("id", { count: "exact", head: true }).eq("employee_id", e) : none,
    viewer.canSeeIdentity ? supabase.from("identity_documents").select("id, expiry_date, document_type, created_at", { count: "exact" }).eq("employee_id", e) : none,
    viewer.canSeeDocuments ? supabase.from("employee_documents").select("id, expiry_date, status, document_type, created_at", { count: "exact" }).eq("employee_id", e).is("deleted_at", null) : none,
    viewer.canEditCore ? supabase.from("leave_ledger").select("id", { count: "exact", head: true }).eq("employee_id", e).eq("reference_type", "opening_balance") : none,
    viewer.canEditCore ? supabase.from("comp_day_ledger").select("id", { count: "exact", head: true }).eq("employee_id", e).eq("source", "opening_balance") : none,
    // `applied_at` is added with this phase's migration; until it is installed the read fails and the flag is simply not shown.
    // Scheduled = not applied and not cancelled; `conflict_at` marks the ones the daily job held back for review.
    viewer.canSeeCareerEvents ? supabase.from("employee_career_events").select("id, conflict_at", { count: "exact" }).eq("employee_id", e).is("applied_at", null).is("dismissed_at", null) : none,
  ]);

  const identityRows = identity.error ? null : ((identity.data ?? []) as unknown as DocRow[]);
  const docRows = docs.error ? null : ((docs.data ?? []) as unknown as DocRow[]);
  const openingLeaveN = countOrNull(openingLeave);
  const openingCompN = countOrNull(openingComp);

  const steps = viewer.canEditCore
    ? computeSetup({
        employeeId: e,
        employmentStatus: employee.employment_status,
        removed: employee.deleted_at !== null,
        counts: {
          contracts: countOrNull(contracts),
          compensation: countOrNull(compensation),
          identityDocuments: identityRows ? (countOrNull(identity) ?? identityRows.length) : null,
          employeeDocuments: docRows ? (countOrNull(docs) ?? docRows.length) : null,
          openingBalances: openingLeaveN === null || openingCompN === null ? null : openingLeaveN + openingCompN,
        },
        linkedUserId: employee.user_id,
        viewerCanInvite: viewer.canInvite,
        viewerCanOpenAccess: viewer.canOpenAccess,
      })
    : [];

  const idCounts = identityRows ? documentExpiryCounts(identityRows, today) : null;
  const docCounts = docRows ? documentExpiryCounts(docRows, today) : null;
  const seen = idCounts !== null || docCounts !== null;

  let exceptions = computeExceptions({
    employeeId: e,
    employmentStatus: employee.employment_status,
    removed: employee.deleted_at !== null,
    jobTitle: employee.job_title,
    managerId: employee.manager_id,
    managerNotExpected: opts.managerNotExpected,
    steps,
    expiredDocuments: seen ? (idCounts?.expired ?? 0) + (docCounts?.expired ?? 0) : null,
    expiringDocuments: seen ? (idCounts?.expiring ?? 0) + (docCounts?.expiring ?? 0) : null,
    scheduledChanges: countOrNull(scheduled),
    heldChanges: scheduled.error || !scheduled.data ? null : scheduled.data.filter((r) => r.conflict_at != null).length,
  });
  if (opts.queue) {
    // The HR queue's items for this person speak in the queue's own words (and with its links), so one issue reads the same on both screens.
    exceptions = exceptions.filter((x) => x.key !== "expired" && x.key !== "expiring");
    const fromQueue: Exception[] = opts.queue.map((i) => ({
      key: `queue-${i.kind}`, label: i.state === "acknowledged" ? `${i.issue} (seen, still open)` : i.issue,
      tone: i.urgency === "due_soon" ? "info" : "attention", href: i.href,
    }));
    exceptions = [...exceptions, ...fromQueue];
  }
  // Someone who cannot edit the record is not told to fill in its job title or manager: they could not act on it.
  if (!viewer.canEditCore) exceptions = exceptions.filter((x) => x.key !== "manager" && x.key !== "job" && x.key !== "setup");

  return { steps, exceptions, today };
}
