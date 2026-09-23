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

    const emails = await emailsById(supabase, [params.employeeUserId, ...recipientIds]);
    const fromEmail = emails.get(params.employeeUserId);
    const toEmails = recipientIds.map((id) => emails.get(id)).filter((e): e is string => Boolean(e));
    if (!fromEmail || toEmails.length === 0) return;

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
    const emails = await emailsById(supabase, [params.fromUserId, params.approverUserId]);
    const fromEmail = emails.get(params.fromUserId);
    const toEmail = emails.get(params.approverUserId);
    if (!fromEmail || !toEmail) return;

    await sendMailAsUser({
      fromEmail,
      to: [toEmail],
      subject: `Action needed — leave request for ${params.employeeName}`,
      html: `
        <p>${escapeHtml(params.employeeName)}'s leave request (${escapeHtml(params.startDate)} to ${escapeHtml(params.endDate)}) now needs your decision.</p>
        <p>Review it in the HR Engine app.</p>
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
    const emails = await emailsById(supabase, [params.decidedByUserId, params.employeeUserId]);
    const fromEmail = emails.get(params.decidedByUserId);
    const toEmail = emails.get(params.employeeUserId);
    if (!fromEmail || !toEmail) return;

    await sendMailAsUser({
      fromEmail,
      to: [toEmail],
      subject: `Your leave request was ${params.decision} (${params.startDate} to ${params.endDate})`,
      html: `<p>Your leave request from ${escapeHtml(params.startDate)} to ${escapeHtml(params.endDate)} has been <strong>${params.decision}</strong>.</p>`,
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
      if (!nextApproval) return;

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
