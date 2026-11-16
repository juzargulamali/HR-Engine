import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";

/**
 * Daily applier for scheduled job and pay changes (People & HR Phase 1). A change recorded with a future effective date is saved unapplied
 * (employee_career_events.applied_at is null) and changes nothing; this job puts it in force on its date.
 *
 * The database decides what "its date" is: apply_due_employment_changes reads each employee's OWN country calendar (never the server's UTC day or a date sent from here), so this route sends nothing
 * but the call. Each event is applied on its own, so one bad event never blocks or undoes the others. An event whose pay version is no longer the current one is HELD for HR review and not applied;
 * an event whose employee has left stays scheduled. Re-running is safe: an applied event is never applied twice.
 *
 * A FAILED application is a failure of the job: the response is a 500 that lists each failed event, so the scheduler's history shows red. The events applied in the same run are kept and are counted in
 * the same body. Held events are reported (`conflicts`, `held`) but are not failures: they wait for HR. Authorised by the cron secret only, like the other jobs in vercel.json.
 */
export const dynamic = "force-dynamic";

interface ApplyResult {
  ran_at?: string;
  applied?: number;
  skipped?: number;
  conflicts?: number;
  failed?: number;
  held?: { event_id: string; employee_id: string }[];
  failures?: { event_id: string; employee_id: string; sqlstate: string; message: string }[];
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_due_employment_changes");
  // The whole call failed (the function is not installed, or the database could not be reached): nothing ran, and that is a failure too.
  if (error) return NextResponse.json({ ranAt: new Date().toISOString(), applied: 0, skipped: 0, conflicts: 0, failed: 0, failures: [], held: [], errors: [error.message] }, { status: 500 });

  const r = (data ?? {}) as ApplyResult;
  const body = {
    ranAt: r.ran_at ?? new Date().toISOString(),
    applied: r.applied ?? 0,
    skipped: r.skipped ?? 0,
    conflicts: r.conflicts ?? 0,
    failed: r.failed ?? 0,
    held: r.held ?? [],
    failures: r.failures ?? [],
    errors: [] as string[],
  };
  return NextResponse.json(body, { status: body.failed > 0 ? 500 : 200 });
}
