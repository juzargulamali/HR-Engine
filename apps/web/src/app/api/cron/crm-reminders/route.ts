import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";
import { runCrmReminders } from "@/lib/crm/reminders";
import { purgeExpiredUploads } from "@/lib/crm/upload-cleanup";

/**
 * Daily Sales & CRM reminder sweep (docs/05-automation-rules.md): creates in-app reminders for follow-ups that have
 * fallen due or gone a day overdue, holds whose review date arrived, and active opportunities with no next action.
 * Idempotent (unique dedupe keys). Owner emails are off unless CRM_REMINDER_EMAILS=on AND a company has enabled them;
 * a failed send is retried with backoff on later runs. No message is ever sent to a client.
 *
 * It also sweeps expired private-upload intents (deleting leftover quarantine files), so one daily job covers both.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const reminders = await runCrmReminders();
    // A failed sweep must not hide a successful reminder run (or the other way round): report each on its own.
    const uploads = await purgeExpiredUploads().then((r) => ({ ...r, error: null as string | null }), (e: unknown) => ({ error: e instanceof Error ? e.message : "Upload clean-up failed" }));
    return NextResponse.json({ ranAt: new Date().toISOString(), ...reminders, uploadCleanup: uploads });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Reminder run failed" }, { status: 500 });
  }
}
