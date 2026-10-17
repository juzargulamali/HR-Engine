import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";
import { runCrmReminders } from "@/lib/crm/reminders";

/**
 * Daily Sales & CRM reminder sweep (docs/05-automation-rules.md): creates in-app reminders for follow-ups that have
 * fallen due or gone a day overdue, holds whose review date arrived, and active opportunities with no next action.
 * Idempotent (unique dedupe keys). Owner emails are off unless CRM_REMINDER_EMAILS=on AND a company has enabled them;
 * a failed send is retried with backoff on later runs. No message is ever sent to a client.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ranAt: new Date().toISOString(), ...(await runCrmReminders()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Reminder run failed" }, { status: 500 });
  }
}
