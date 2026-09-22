import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/cron/auth";

const FALLBACK_EXPIRING_SOON_DAYS = 30;

function daysUntil(today: string, expiryDate: string): number {
  return Math.round((Date.parse(expiryDate) - Date.parse(today)) / (24 * 60 * 60 * 1000));
}

/**
 * Daily employee-document expiry sweep (docs/05-automation-rules.md §5.1):
 * transitions employee_documents.status (valid -> expiring_soon -> expired)
 * and fires one notification per (document, configured lead_days) pair the
 * first time it's crossed — document_expiry_reminders_sent's unique
 * constraint is what makes re-running this job safe.
 *
 * The "expiring soon" threshold itself is a UI default (30 days) when no
 * document_expiry_reminder_rules row applies — unlike the actual reminder
 * lead times, this isn't a legal/country rule, just a reasonable fallback
 * for when HR Admin hasn't configured one yet.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: documents, error: documentsError } = await admin
    .from("employee_documents")
    .select("id, employee_id, document_type, expiry_date, status")
    .not("expiry_date", "is", null)
    .is("deleted_at", null);
  if (documentsError) return NextResponse.json({ error: documentsError.message }, { status: 500 });

  const employeeIds = [...new Set((documents ?? []).map((d) => d.employee_id))];
  const { data: employees, error: employeesError } =
    employeeIds.length > 0
      ? await admin.from("employees").select("id, user_id, company_id, country_code").in("id", employeeIds)
      : { data: [] as { id: string; user_id: string | null; company_id: string; country_code: string }[], error: null };
  if (employeesError) return NextResponse.json({ error: employeesError.message }, { status: 500 });
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));

  const { data: rules, error: rulesError } = await admin
    .from("document_expiry_reminder_rules")
    .select("company_id, country_code, document_type, lead_days");
  if (rulesError) return NextResponse.json({ error: rulesError.message }, { status: 500 });

  let statusUpdates = 0;
  let remindersSent = 0;
  const failures: string[] = [];

  for (const doc of documents ?? []) {
    if (!doc.expiry_date) continue;
    const employee = employeeById.get(doc.employee_id);
    if (!employee) continue;

    const applicableRules = (rules ?? []).filter(
      (r) =>
        r.document_type === doc.document_type &&
        (r.company_id === employee.company_id || (r.company_id === null && r.country_code === employee.country_code)),
    );
    const thresholdDays =
      applicableRules.length > 0 ? Math.max(...applicableRules.map((r) => r.lead_days)) : FALLBACK_EXPIRING_SOON_DAYS;

    const daysRemaining = daysUntil(today, doc.expiry_date);
    const newStatus = daysRemaining < 0 ? "expired" : daysRemaining <= thresholdDays ? "expiring_soon" : "valid";

    if (newStatus !== doc.status) {
      const { error: updateError } = await admin.from("employee_documents").update({ status: newStatus }).eq("id", doc.id);
      if (updateError) failures.push(`status/${doc.id}: ${updateError.message}`);
      else statusUpdates += 1;
    }

    for (const rule of applicableRules) {
      if (daysRemaining < 0 || daysRemaining > rule.lead_days) continue;

      const { data: alreadySent } = await admin
        .from("document_expiry_reminders_sent")
        .select("id")
        .eq("employee_document_id", doc.id)
        .eq("lead_days", rule.lead_days)
        .maybeSingle();
      if (alreadySent) continue;

      const { error: insertReminderError } = await admin
        .from("document_expiry_reminders_sent")
        .insert({ employee_document_id: doc.id, lead_days: rule.lead_days });
      if (insertReminderError) {
        failures.push(`reminder/${doc.id}/${rule.lead_days}: ${insertReminderError.message}`);
        continue;
      }

      const recipientUserIds = new Set<string>();
      if (employee.user_id) recipientUserIds.add(employee.user_id);
      const { data: hrAdmins } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "hr_admin")
        .is("revoked_at", null)
        .or(`company_id.eq.${employee.company_id},company_id.is.null`);
      for (const hr of hrAdmins ?? []) recipientUserIds.add(hr.user_id);

      for (const userId of recipientUserIds) {
        const { error: notifyError } = await admin.from("notifications").insert({
          user_id: userId,
          type: "document_expiring",
          payload: { employeeDocumentId: doc.id, documentType: doc.document_type, expiryDate: doc.expiry_date, leadDays: rule.lead_days },
        });
        if (notifyError) failures.push(`notify/${doc.id}/${userId}: ${notifyError.message}`);
        else remindersSent += 1;
      }
    }
  }

  return NextResponse.json({ ranAt: today, documentsChecked: (documents ?? []).length, statusUpdates, remindersSent, failures });
}
