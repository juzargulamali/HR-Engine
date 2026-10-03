import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

/**
 * Recovery Leave window processor — the SAFETY-NET trigger. The primary
 * trigger is pg_cron inside the database, every 5 minutes (owner-enabled, see
 * docs/recovery-windows-deployment.md, because Vercel's Hobby plan cannot run
 * a cron more often than once a day). This daily route exists so that, even if
 * pg_cron were never enabled or stopped, windows still close and HR alerts
 * still appear at least once a day instead of never.
 *
 * All the work is recovery_process_due() in the database: it catches up every
 * 24-elapsed-hour boundary missed since the last run, creates the approval
 * requests and HR alerts, retries earlier failures, and records each run (and
 * each per-employee failure) so a problem is visible, not silent. It is
 * idempotent, so overlapping with pg_cron or a retried invocation is safe.
 *
 * Authority: Bearer CRON_SECRET (constant-time compared) and the service-role
 * client; the function itself is revoked from every signed-in role. It acts
 * under no HR identity — rows it causes carry origin 'processor'.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("recovery_process_due", { p_origin: "vercel_cron" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A partial or failed run is a real problem: report it with a non-2xx status
  // so Vercel's cron log shows it, while the body still says exactly what ran.
  const status = data?.status === "failed" || data?.status === "partial" ? 500 : 200;
  return NextResponse.json(data, { status });
}
