import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sendMailAsUser } from "./graph";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Every function here is best-effort: a leave request is already saved and
 * routed by the time these run, so a Graph failure (not configured yet,
 * expired secret, a mailbox that doesn't exist) must never surface as an
 * error to the person submitting/deciding it — log and move on.
 */
function logFailure(where: string, err: unknown) {
  console.error(`[leave-notifications] ${where} failed`, err);
}

/**
 * employeeName is built from employees.first_name/last_name — free text
 * only HR Admin can set (createEmployee), never the employee themselves
 * (updateOwnContactInfo only allows personal_email/phone) — but HR Admin
 * setting a name containing HTML would otherwise render unescaped in every
 * recipient's email client. Escaping here costs nothing and closes that
 * off regardless of who could reach it.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function emailsById(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("profiles").select("id, email").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p.email]));
}

/**
 * Display names for greetings and the "sent to" footer. Prefers the employee
 * record's own first/last name (what HR typed), then the login profile's
 * full_name, then the part of the email before the @ — so a name is always
 * available even where row-level security hides another person's employee
 * row from the acting user. Every mail here also carries a footer naming its
 * recipient(s): when several people share one mailbox (aliases, shared
 * inboxes, test accounts), the greeting and footer are what tell the
 * messages apart.
 */
async function namesById(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return new Map();
  const [{ data: employees }, { data: profiles }] = await Promise.all([
    supabase.from("employees").select("user_id, first_name, last_name").in("user_id", unique),
    supabase.from("profiles").select("id, email, full_name").in("id", unique),
  ]);
  const names = new Map<string, string>();
  for (const p of profiles ?? []) {
    names.set(p.id, p.full_name?.trim() || (p.email.split("@")[0] ?? p.email));
  }
  for (const e of employees ?? []) {
    const full = `${e.first_name} ${e.last_name}`.trim();
    if (e.user_id && full) names.set(e.user_id, full);
  }
  return names;
}

function recipientFooter(recipients: { name: string; email: string }[]): string {
  const list = recipients.map((r) => `${escapeHtml(r.name)} &lt;${escapeHtml(r.email)}&gt;`).join(", ");
  return `<p style="color:#666;font-size:12px">Sent to: ${list}</p>`;
}

export async function notifyLeaveSubmitted(
  supabase: SupabaseClient,
  params: {
    employeeUserId: string;
    employeeName: string;
    managerEmployeeId: string | null;
    companyId: string;
    leaveTypeCode: string;
    startDate: string;
    endDate: string;
    totalDays: number;
  },
): Promise<void> {
  try {
    const [{ data: hrAdmins }, { data: ceos }, { data: ctos }, manager] = await Promise.all([
      supabase.rpc("resolve_role_holders", { p_role: "hr_admin", p_company_id: params.companyId }),
      supabase.rpc("resolve_role_holders", { p_role: "ceo", p_company_id: params.companyId }),
      // cto is a full peer of ceo everywhere in this system (see
      // resolve_approver()'s role:ceo -> "any C-level exec" broadening in
      // schema.sql) — notify both C-level execs, not just whoever holds
      // the ceo role specifically.
      supabase.rpc("resolve_role_holders", { p_role: "cto", p_company_id: params.companyId }),
      params.managerEmployeeId
        ? supabase.from("employees").select("user_id").eq("id", params.managerEmployeeId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const recipientIds = [...(hrAdmins ?? []), ...(ceos ?? []), ...(ctos ?? []), manager.data?.user_id].filter(
      (id): id is string => typeof id === "string" && id !== params.employeeUserId,
    );

    const [emails, names] = await Promise.all([
      emailsById(supabase, [params.employeeUserId, ...recipientIds]),
      namesById(supabase, recipientIds),
    ]);
    const fromEmail = emails.get(params.employeeUserId);
    const toEmails = recipientIds.map((id) => emails.get(id)).filter((e): e is string => Boolean(e));
    if (!fromEmail || toEmails.length === 0) return;
    const recipients = Array.from(new Set(recipientIds))
      .map((id) => ({ name: names.get(id) ?? "", email: emails.get(id) ?? "" }))
      .filter((r) => r.email);

    await sendMailAsUser({
      fromEmail,
      to: toEmails,
      subject: `Leave request — ${params.employeeName} (${params.startDate} to ${params.endDate})`,
      html: `
        <p>${escapeHtml(params.employeeName)} has submitted a leave request.</p>
        <ul>
          <li>Type: ${escapeHtml(params.leaveTypeCode)}</li>
          <li>From: ${escapeHtml(params.startDate)}</li>
          <li>To: ${escapeHtml(params.endDate)}</li>
          <li>Total days: ${params.totalDays}</li>
        </ul>
        <p>Review it in the HR Engine app.</p>
        ${recipientFooter(recipients)}
      `,
    });
  } catch (err) {
    logFailure("notifyLeaveSubmitted", err);
  }
}

async function notifyApproverTurn(
  supabase: SupabaseClient,
  params: { fromUserId: string; approverUserId: string; employeeName: string; startDate: string; endDate: string },
): Promise<void> {
  try {
    const [emails, names] = await Promise.all([
      emailsById(supabase, [params.fromUserId, params.approverUserId]),
      namesById(supabase, [params.approverUserId]),
    ]);
    const fromEmail = emails.get(params.fromUserId);
    const toEmail = emails.get(params.approverUserId);
    if (!fromEmail || !toEmail) return;
    const approverName = names.get(params.approverUserId) ?? toEmail;

    await sendMailAsUser({
      fromEmail,
      to: [toEmail],
      subject: `Action needed from ${approverName} — leave request for ${params.employeeName}`,
      html: `
        <p>Hi ${escapeHtml(approverName)},</p>
        <p>${escapeHtml(params.employeeName)}'s leave request (${escapeHtml(params.startDate)} to ${escapeHtml(params.endDate)}) now needs your decision.</p>
        <p>Review it in the HR Engine app.</p>
        ${recipientFooter([{ name: approverName, email: toEmail }])}
      `,
    });
  } catch (err) {
    logFailure("notifyApproverTurn", err);
  }
}

async function notifyLeaveDecision(
  supabase: SupabaseClient,
  params: { decidedByUserId: string; employeeUserId: string; decision: "approved" | "rejected"; startDate: string; endDate: string },
): Promise<void> {
  try {
    const [emails, names] = await Promise.all([
      emailsById(supabase, [params.decidedByUserId, params.employeeUserId]),
      namesById(supabase, [params.decidedByUserId, params.employeeUserId]),
    ]);
    const fromEmail = emails.get(params.decidedByUserId);
    const toEmail = emails.get(params.employeeUserId);
    if (!fromEmail || !toEmail) return;
    const employeeName = names.get(params.employeeUserId) ?? toEmail;
    const deciderName = names.get(params.decidedByUserId) ?? fromEmail;

    await sendMailAsUser({
      fromEmail,
      to: [toEmail],
      subject: `Leave request ${params.decision} for ${employeeName} (${params.startDate} to ${params.endDate})`,
      html: `
        <p>Hi ${escapeHtml(employeeName)},</p>
        <p>Your leave request from ${escapeHtml(params.startDate)} to ${escapeHtml(params.endDate)} has been <strong>${params.decision}</strong> by ${escapeHtml(deciderName)}.</p>
        ${recipientFooter([{ name: employeeName, email: toEmail }])}
      `,
    });
  } catch (err) {
    logFailure("notifyLeaveDecision", err);
  }
}

/**
 * Called after decide_leave_approval() succeeds for a leave_request
 * approval — the RPC itself returns void, so this re-reads the request's
 * resulting state to figure out which of the two outcomes to notify:
 * either the chain moved to a new approver, or the request is now finalized
 * (approved/rejected) and the employee should hear about it.
 */
export async function notifyAfterLeaveDecision(
  supabase: SupabaseClient,
  params: { requestId: string; decidedByUserId: string },
): Promise<void> {
  try {
    const { data: request } = await supabase
      .from("leave_requests")
      .select("status, start_date, end_date, employee_id")
      .eq("id", params.requestId)
      .maybeSingle();
    if (!request) return;

    if (request.status === "approved" || request.status === "rejected") {
      const { data: employee } = await supabase.from("employees").select("user_id").eq("id", request.employee_id).maybeSingle();
      if (!employee?.user_id) return;
      await notifyLeaveDecision(supabase, {
        decidedByUserId: params.decidedByUserId,
        employeeUserId: employee.user_id,
        decision: request.status,
        startDate: request.start_date,
        endDate: request.end_date,
      });
      return;
    }

    if (request.status === "pending_approval") {
      const { data: nextApproval } = await supabase
        .from("approvals")
        .select("approver_id")
        .eq("entity_type", "leave_request")
        .eq("entity_id", params.requestId)
        .eq("decision", "pending")
        .order("step_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      // leave_request steps always resolve to a specific person — only
      // recovery_credit's role-queue step (see schema.sql) ever has a null
      // approver_id. This can't happen here, but the column is nullable
      // now, so guard rather than assert.
      if (!nextApproval?.approver_id) return;

      const { data: employee } = await supabase.from("employees").select("first_name, last_name").eq("id", request.employee_id).maybeSingle();

      await notifyApproverTurn(supabase, {
        fromUserId: params.decidedByUserId,
        approverUserId: nextApproval.approver_id,
        employeeName: employee ? `${employee.first_name} ${employee.last_name}` : "An employee",
        startDate: request.start_date,
        endDate: request.end_date,
      });
    }
  } catch (err) {
    logFailure("notifyAfterLeaveDecision", err);
  }
}
