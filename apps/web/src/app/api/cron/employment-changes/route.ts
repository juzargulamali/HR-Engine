import "server-only";
import { NextResponse } from "next/server";
import { getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";

/**
 * Daily applier for scheduled job and pay changes (People & HR Phase 1). A change recorded with a future effective date is saved unapplied
 * (employee_career_events.applied_at is null) and changes nothing; this job puts it in force on its date, in the employee's OWN country's calendar
 * day (never the server's UTC day). The database function does the work, one event at a time, so one bad event never blocks the others, and an
 * event whose employee has left stays scheduled and is reported. Re-running is safe: an applied event is never applied twice.
 * Authorised by the cron secret only, like the other jobs in vercel.json.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: scheduled, error: scheduledError } = await admin.from("employee_career_events").select("employee_id").is("applied_at", null);
  if (scheduledError) return NextResponse.json({ error: scheduledError.message }, { status: 500 });
  const employeeIds = [...new Set((scheduled ?? []).map((e) => e.employee_id))];
  if (employeeIds.length === 0) return NextResponse.json({ ranAt: new Date().toISOString(), countries: [], applied: 0, skipped: 0, failed: 0 });

  const { data: employees, error: employeesError } = await admin.from("employees").select("id, country_code").in("id", employeeIds);
  // Fail loudly: guessing a country here would apply a change on the wrong calendar day.
  if (employeesError) return NextResponse.json({ error: employeesError.message }, { status: 500 });
  const countries = [...new Set((employees ?? []).map((e) => e.country_code))];

  const results: { country: string; today: string; applied: number; skipped: number; failed: number }[] = [];
  const errors: string[] = [];
  for (const country of countries) {
    const today = getBusinessDateString(resolveCountryTimeZone(country));
    const { data, error } = await admin.rpc("apply_due_employment_changes", { p_country: country, p_today: today });
    if (error) { errors.push(`${country}: ${error.message}`); continue; }
    const r = (data ?? {}) as { applied?: number; skipped?: number; failed?: number };
    results.push({ country, today, applied: r.applied ?? 0, skipped: r.skipped ?? 0, failed: r.failed ?? 0 });
  }

  const total = (k: "applied" | "skipped" | "failed") => results.reduce((n, r) => n + r[k], 0);
  const body = { ranAt: new Date().toISOString(), countries: results, applied: total("applied"), skipped: total("skipped"), failed: total("failed"), errors };
  return NextResponse.json(body, { status: errors.length > 0 ? 500 : 200 });
}
