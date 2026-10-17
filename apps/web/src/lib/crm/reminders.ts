import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMailAsUser } from "@/lib/email/graph";

const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface ReminderRunResult {
  generated: number;
  emailsEnabled: boolean;
  emailsAttempted: number;
  emailsSent: number;
  emailsFailed: number;
  note: string | null;
}

/** Owner emails are sent only when BOTH the environment switch and the company setting (which queues the rows) are on. */
export function reminderEmailsEnabled(): { enabled: boolean; from: string | null } {
  const from = process.env.CRM_REMINDER_FROM_EMAIL?.trim() || null;
  return { enabled: process.env.CRM_REMINDER_EMAILS === "on" && !!from, from };
}

const SUBJECT: Record<string, string> = {
  follow_up_due: "Follow-up due",
  follow_up_overdue: "Follow-up overdue",
  hold_review_due: "Hold review due",
  no_next_action: "Opportunity has no next action",
};

/**
 * In-app reminders (always) and owner emails (only when switched on). Idempotent end to end: the database's unique
 * dedupe key means a second run creates nothing new, and an email row is claimed (its next attempt pushed forward)
 * before it is sent, so overlapping runs cannot send the same reminder twice. Nothing here ever contacts a client.
 */
export async function runCrmReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const admin = createAdminClient();
  const { data: generated, error } = await admin.rpc("crm_generate_reminders", { p_now: now.toISOString() });
  if (error) throw new Error(`crm_generate_reminders failed: ${error.message}`);

  const { enabled, from } = reminderEmailsEnabled();
  const result: ReminderRunResult = { generated: generated ?? 0, emailsEnabled: enabled, emailsAttempted: 0, emailsSent: 0, emailsFailed: 0, note: null };
  if (!enabled || !from) {
    result.note = "Owner emails are off (CRM_REMINDER_EMAILS / CRM_REMINDER_FROM_EMAIL not set); in-app reminders only.";
    return result;
  }

  const { data: claims, error: claimError } = await admin.rpc("crm_claim_reminder_emails", { p_limit: 50, p_now: now.toISOString() });
  if (claimError) throw new Error(`crm_claim_reminder_emails failed: ${claimError.message}`);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";
  for (const c of claims ?? []) {
    result.emailsAttempted++;
    try {
      const greeting = escapeHtml(c.recipient_name?.trim() || c.recipient_email.split("@")[0] || "there");
      await sendMailAsUser({
        fromEmail: from,
        to: [c.recipient_email],
        subject: `${SUBJECT[c.kind] ?? "Sales reminder"}: ${c.opportunity_reference}`,
        html: `<p>Hi ${greeting},</p><p>${escapeHtml(SUBJECT[c.kind] ?? "Sales reminder")}: <strong>${escapeHtml(c.title)}</strong> on ${escapeHtml(c.opportunity_reference)} (${escapeHtml(c.opportunity_title)}).</p>${siteUrl ? `<p><a href="${siteUrl}/sales/follow-ups">Open your follow-ups</a></p>` : ""}<p style="color:#666">Internal reminder sent to ${escapeHtml(c.recipient_email)}. It is not sent to clients.</p>`,
      });
      await admin.rpc("crm_finish_reminder_email", { p_reminder_id: c.reminder_id, p_ok: true });
      result.emailsSent++;
    } catch (e) {
      result.emailsFailed++;
      await admin.rpc("crm_finish_reminder_email", { p_reminder_id: c.reminder_id, p_ok: false, p_error: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

let lastOnDemandRun = 0;

/**
 * Best-effort, throttled generation of IN-APP reminders when someone opens Sales (the scheduled job runs once a day on
 * the current hosting plan, so a follow-up that falls due mid-day would otherwise wait until tomorrow). Never sends
 * email and never throws: a failure here must not break the page.
 */
export async function generateRemindersThrottled(minIntervalMs = 5 * 60_000): Promise<void> {
  const now = Date.now();
  if (now - lastOnDemandRun < minIntervalMs) return;
  lastOnDemandRun = now;
  try {
    await createAdminClient().rpc("crm_generate_reminders", { p_now: new Date(now).toISOString() });
  } catch (e) {
    console.error("[crm] on-demand reminder generation failed", e);
  }
}
