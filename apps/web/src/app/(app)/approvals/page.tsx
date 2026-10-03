import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, statusNextAction } from "@/components/ui/status-badge";
import { DecisionButtons } from "./decision-buttons";
import { RecoveryCreditDecisionForm } from "./recovery-credit-decision-form";
import { RecoveryWindowEvidence, type WindowEvidenceData } from "./recovery-window-evidence";
import { getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
import { CLASSIFICATION_LABELS, ROUTE_LABELS, formatHoursMinutes } from "@/lib/recovery/labels";

export default async function ApprovalsPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  // approver_id is null for a QUEUE step — the legacy role_queue:% mechanism
  // (still used by manual/overnight-family recovery_credit until the
  // cutover script runs) and the new self-clock queue_roles mechanism (see
  // approvals.queue_roles' own doc comment in schema.sql). Without also
  // fetching those, no queue-routed recovery credit — old OR new — would
  // ever show up here for anyone. RLS (approvals_select) already narrows
  // this to rows the viewer either decides or merely watches; the
  // eligibility filtering below (queueDecisionEligible) narrows further, to
  // "waiting on YOUR decision" specifically, matching every other entity
  // type's own approver_id-only semantics.
  const { data: approvals } = await supabase
    .from("approvals")
    .select("id, entity_type, entity_id, step_order, workflow_id, approver_id, queue_roles, created_at")
    .eq("decision", "pending")
    .or(`approver_id.eq.${session.userId},approver_id.is.null`)
    .order("created_at", { ascending: true });

  const idsOf = (entityType: string) => (approvals ?? []).filter((a) => a.entity_type === entityType).map((a) => a.entity_id);

  const leaveRequestIds = idsOf("leave_request");
  const claimIds = idsOf("reimbursement_claim");
  const timesheetIds = idsOf("timesheet");
  const letterIds = idsOf("generated_letter");
  const payrollRunIds = idsOf("payroll_export_run");
  const recoveryCreditIds = idsOf("recovery_credit");

  const [{ data: requests }, { data: claims }, { data: timesheets }, { data: letters }, { data: payrollRuns }, { data: recoveryRequests }] =
    await Promise.all([
      leaveRequestIds.length > 0
        ? supabase.from("leave_requests").select("id, employee_id, leave_type_code, start_date, end_date, total_days, reason").in("id", leaveRequestIds)
        : Promise.resolve({ data: [] as never[] }),
      claimIds.length > 0
        ? supabase.from("reimbursement_claims").select("id, employee_id, claim_date, currency, total_amount").in("id", claimIds)
        : Promise.resolve({ data: [] as never[] }),
      timesheetIds.length > 0
        ? supabase.from("timesheets").select("id, employee_id, period_start, period_end").in("id", timesheetIds)
        : Promise.resolve({ data: [] as never[] }),
      letterIds.length > 0
        ? supabase.from("generated_letters").select("id, employee_id, template_id").in("id", letterIds)
        : Promise.resolve({ data: [] as never[] }),
      payrollRunIds.length > 0
        ? supabase.from("payroll_export_runs").select("id, period_month, period_year").in("id", payrollRunIds)
        : Promise.resolve({ data: [] as never[] }),
      recoveryCreditIds.length > 0
        ? supabase
            .from("recovery_credit_requests")
            .select(
              "id, employee_id, attendance_record_id, segment_id, work_date, event_type, proposed_days, correction_reason, checked_with, corrected_at, work_mode, project_name, project_lead_employee_id, applicant_route, needs_policy_review, routing_issue, recovery_window_id, window_revision_no, adjusts_request_id, consumption_ack_at",
            )
            .in("id", recoveryCreditIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);

  // recovery_credit_requests.work_date/proposed_days are the CURRENT
  // (possibly HR-corrected) values — the ORIGINAL, unedited hours come from
  // the linked attendance_records row, so the approval screen can show
  // original vs. corrected side by side without ever overwriting the
  // evidence.
  const attendanceRecordIds = [...new Set((recoveryRequests ?? []).map((r) => r.attendance_record_id).filter((id): id is string => id !== null))];
  const { data: attendanceRecords } =
    attendanceRecordIds.length > 0
      ? await supabase
          .from("attendance_records")
          .select("id, work_date, hours_worked, active_hours_after_midnight, source")
          .in("id", attendanceRecordIds)
      : { data: [] as never[] };
  const attendanceById = new Map((attendanceRecords ?? []).map((a) => [a.id, a]));

  const templateIds = [...new Set((letters ?? []).map((l) => l.template_id))];
  const { data: templates } =
    templateIds.length > 0 ? await supabase.from("letter_templates").select("id, name").in("id", templateIds) : { data: [] as never[] };
  const templateName = new Map((templates ?? []).map((t) => [t.id, t.name]));

  const employeeIds = [
    ...new Set(
      [...(requests ?? []), ...(claims ?? []), ...(timesheets ?? []), ...(letters ?? []), ...(recoveryRequests ?? [])].map((r) => r.employee_id),
    ),
  ];
  const { data: employees } =
    employeeIds.length > 0
      ? await supabase.from("employees").select("id, first_name, last_name, company_id, country_code").in("id", employeeIds)
      : { data: [] as never[] };
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));
  const employeeName = (id: string) => {
    const e = employeeById.get(id);
    return e ? `${e.first_name} ${e.last_name}` : "—";
  };

  // ---- Window-based Recovery Leave requests: the full evidence an approver needs ----
  const windowRequests = (recoveryRequests ?? []).filter((r) => r.recovery_window_id);
  const windowIds = [...new Set(windowRequests.map((r) => r.recovery_window_id!))];
  const [{ data: windowRows }, { data: allocationRows }, { data: revisionRows }, { data: stepRows }] = await Promise.all([
    windowIds.length > 0
      ? supabase
          .from("recovery_windows")
          .select(
            "id, period_id, window_index, window_start, window_end, starting_local_date, classification, holiday_name, recorded_seconds, status, closed_reason, entitlement_days, review_flags, hr_verification_required, hr_verified_at, hr_verification_note, revision_no, policy_version_id",
          )
          .in("id", windowIds)
      : Promise.resolve({ data: [] as never[] }),
    windowIds.length > 0
      ? supabase
          .from("recovery_window_allocations")
          .select("id, window_id, session_id, work_mode, project_name, project_lead_employee_id, alloc_start, alloc_end, seconds")
          .in("window_id", windowIds)
          .order("alloc_start")
      : Promise.resolve({ data: [] as never[] }),
    windowIds.length > 0
      ? supabase
          .from("recovery_window_revisions")
          .select("window_id, revision_no, recorded_seconds, entitlement_days, reason, origin, created_at")
          .in("window_id", windowIds)
          .order("revision_no")
      : Promise.resolve({ data: [] as never[] }),
    windowRequests.length > 0
      ? supabase
          .from("approvals")
          .select("entity_id, step_order, decision, queue_roles, approver_id")
          .eq("entity_type", "recovery_credit")
          .in("entity_id", windowRequests.map((r) => r.id))
          .order("step_order")
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const periodIds = [...new Set((windowRows ?? []).map((w) => w.period_id))];
  const sessionIdsForWindows = [...new Set((allocationRows ?? []).map((a) => a.session_id))];
  const policyIds = [...new Set((windowRows ?? []).map((w) => w.policy_version_id))];
  const [{ data: periodRows }, { data: sessionHrRows }, { data: policyRows }, { data: correctionRows }] = await Promise.all([
    periodIds.length > 0 ? supabase.from("recovery_periods").select("id, started_at, rules").in("id", periodIds) : Promise.resolve({ data: [] as never[] }),
    sessionIdsForWindows.length > 0 ? supabase.from("attendance_sessions").select("id, recorded_by_hr").in("id", sessionIdsForWindows) : Promise.resolve({ data: [] as never[] }),
    policyIds.length > 0 ? supabase.from("policy_versions").select("id, version_no").in("id", policyIds) : Promise.resolve({ data: [] as never[] }),
    sessionIdsForWindows.length > 0
      ? supabase
          .from("attendance_session_corrections")
          .select("id, session_id, reason, created_at, original_clock_in_at, original_clock_out_at, corrected_clock_in_at, corrected_clock_out_at, actor_id")
          .in("session_id", sessionIdsForWindows)
          .order("created_at")
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const leadAndActorIds = [
    ...new Set([
      ...(allocationRows ?? []).map((a) => a.project_lead_employee_id).filter((id): id is string => !!id),
    ]),
  ];
  const actorUserIds = [...new Set((correctionRows ?? []).map((c) => c.actor_id))];
  const [{ data: leadEmployees }, { data: actorEmployees }] = await Promise.all([
    leadAndActorIds.length > 0 ? supabase.from("employees").select("id, first_name, last_name").in("id", leadAndActorIds) : Promise.resolve({ data: [] as never[] }),
    actorUserIds.length > 0 ? supabase.from("employees").select("user_id, first_name, last_name").in("user_id", actorUserIds) : Promise.resolve({ data: [] as never[] }),
  ]);
  const leadNameById = new Map((leadEmployees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const actorNameByUser = new Map((actorEmployees ?? []).map((e) => [e.user_id, `${e.first_name} ${e.last_name}`]));
  const windowById = new Map((windowRows ?? []).map((w) => [w.id, w]));
  const periodById = new Map((periodRows ?? []).map((p) => [p.id, p]));
  const policyVersionById = new Map((policyRows ?? []).map((p) => [p.id, p.version_no]));
  const hrSessionIds = new Set((sessionHrRows ?? []).filter((s) => s.recorded_by_hr).map((s) => s.id));
  const blockerEntries = await Promise.all(
    windowRequests.map(async (r) => [r.id, (await supabase.rpc("get_recovery_request_blocker", { p_request_id: r.id })).data ?? null] as const),
  );
  const blockerByRequest = new Map(blockerEntries);

  // Original hours for SELF-CLOCK requests of the previous (same-day) calculation: summed from the
  // employee's own clock segments for that local date — previously these showed a blank "—".
  const legacySelfClock = (recoveryRequests ?? []).filter((r) => r.attendance_record_id === null && !r.recovery_window_id);
  const legacyEmployeeIds = [...new Set(legacySelfClock.map((r) => r.employee_id))];
  const { data: legacySegments } =
    legacyEmployeeIds.length > 0
      ? await supabase
          .from("attendance_segments")
          .select("employee_id, segment_start, segment_end")
          .in("employee_id", legacyEmployeeIds)
          .not("segment_end", "is", null)
          .gte("segment_start", new Date(Math.min(...legacySelfClock.map((r) => new Date(`${r.work_date}T00:00:00Z`).getTime())) - 26 * 3600_000).toISOString())
          .lte("segment_start", new Date(Math.max(...legacySelfClock.map((r) => new Date(`${r.work_date}T00:00:00Z`).getTime())) + 50 * 3600_000).toISOString())
      : { data: [] as { employee_id: string; segment_start: string; segment_end: string | null }[] };
  function selfClockRecordedHours(request: { employee_id: string; work_date: string }): number | null {
    const tz = resolveCountryTimeZone(employeeById.get(request.employee_id)?.country_code);
    const seconds = (legacySegments ?? [])
      .filter((sg) => sg.employee_id === request.employee_id && sg.segment_end && getBusinessDateString(tz, new Date(sg.segment_start)) === request.work_date)
      .reduce((sum, sg) => sum + (new Date(sg.segment_end!).getTime() - new Date(sg.segment_start).getTime()) / 1000, 0);
    return seconds > 0 ? Math.round((seconds / 3600) * 100) / 100 : null;
  }

  // "Insufficient balance" is a warning shown to the approver, not a block
  // on submission — nothing stops a manager from knowingly approving
  // unpaid/negative leave, this just makes sure they're not doing it
  // unknowingly. Approximates decide_leave_approval()'s own deduction
  // logic: total available = the leave type's own ledger balance, plus
  // comp-day balance if deduction_priority_rules routes this leave type
  // through comp-day for the employee's company/country as of the
  // request's start date.
  const leaveTypeCodes = [...new Set((requests ?? []).map((r) => r.leave_type_code))];
  const [{ data: leaveBalances }, { data: compDayBalances }, { data: deductionRules }] = await Promise.all([
    employeeIds.length > 0 && leaveTypeCodes.length > 0
      ? supabase.from("leave_balances").select("employee_id, leave_type_code, balance_days").in("employee_id", employeeIds).in("leave_type_code", leaveTypeCodes)
      : Promise.resolve({ data: [] as never[] }),
    employeeIds.length > 0
      ? supabase.from("comp_day_balances").select("employee_id, balance_days").in("employee_id", employeeIds)
      : Promise.resolve({ data: [] as never[] }),
    leaveTypeCodes.length > 0
      ? supabase.from("deduction_priority_rules").select("company_id, country_code, leave_type_code, source_ledger, effective_from").in("leave_type_code", leaveTypeCodes)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const leaveBalanceByKey = new Map((leaveBalances ?? []).map((b) => [`${b.employee_id}:${b.leave_type_code}`, Number(b.balance_days)]));
  const compDayBalanceByEmployee = new Map((compDayBalances ?? []).map((b) => [b.employee_id, Number(b.balance_days)]));

  function hasInsufficientBalance(request: { employee_id: string; leave_type_code: string; start_date: string; total_days: number | string }): boolean {
    const employee = employeeById.get(request.employee_id);
    if (!employee) return false;
    const leaveBalance = leaveBalanceByKey.get(`${request.employee_id}:${request.leave_type_code}`) ?? 0;
    const usesCompDay = (deductionRules ?? []).some(
      (r) =>
        r.leave_type_code === request.leave_type_code &&
        r.source_ledger === "comp_day" &&
        r.effective_from <= request.start_date &&
        (r.company_id === employee.company_id || (r.company_id === null && r.country_code === employee.country_code)),
    );
    const available = leaveBalance + (usesCompDay ? (compDayBalanceByEmployee.get(request.employee_id) ?? 0) : 0);
    return Number(request.total_days) > available;
  }

  const requestById = new Map((requests ?? []).map((r) => [r.id, r]));
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));
  const timesheetById = new Map((timesheets ?? []).map((t) => [t.id, t]));
  const letterById = new Map((letters ?? []).map((l) => [l.id, l]));
  const payrollRunById = new Map((payrollRuns ?? []).map((p) => [p.id, p]));
  const recoveryRequestById = new Map((recoveryRequests ?? []).map((r) => [r.id, r]));

  // Legacy role_queue:% rows (still used by the manual/overnight family
  // until the cutover script runs — see approvals.queue_roles' own doc
  // comment) carry their role name on approval_workflow_steps, not on the
  // approvals row itself; only fetched for the rows that actually need it.
  const legacyQueueApprovals = (approvals ?? []).filter(
    (a) => a.entity_type === "recovery_credit" && a.queue_roles === null && a.workflow_id !== null,
  );
  const { data: legacyWorkflowSteps } =
    legacyQueueApprovals.length > 0
      ? await supabase
          .from("approval_workflow_steps")
          .select("workflow_id, step_order, approver_type")
          .in(
            "workflow_id",
            legacyQueueApprovals.map((a) => a.workflow_id!),
          )
      : { data: [] as { workflow_id: string; step_order: number; approver_type: string }[] };
  const legacyRoleByWorkflowStep = new Map(
    (legacyWorkflowSteps ?? [])
      .filter((s) => s.approver_type.startsWith("role_queue:"))
      .map((s) => [`${s.workflow_id}:${s.step_order}`, s.approver_type.replace("role_queue:", "")]),
  );

  const leaveApprovals = (approvals ?? []).filter((a) => a.entity_type === "leave_request" && requestById.has(a.entity_id));
  const claimApprovals = (approvals ?? []).filter((a) => a.entity_type === "reimbursement_claim" && claimById.has(a.entity_id));
  const timesheetApprovals = (approvals ?? []).filter((a) => a.entity_type === "timesheet" && timesheetById.has(a.entity_id));
  const letterApprovals = (approvals ?? []).filter((a) => a.entity_type === "generated_letter" && letterById.has(a.entity_id));
  const payrollApprovals = (approvals ?? []).filter((a) => a.entity_type === "payroll_export_run" && payrollRunById.has(a.entity_id));

  // A queue row (approver_id null — RLS also shows it to its own
  // BENEFICIARY, purely for tracking) only belongs on THIS "waiting on your
  // decision" page when the viewer actually holds one of its deciding
  // role(s) in the beneficiary's own company — mirrors has_role()/
  // decide_leave_approval()'s own authorization exactly, and matches every
  // other entity type's own approver_id-only semantics (a requester never
  // sees their own pending request here either). Self-decision is blocked
  // the same way decide_leave_approval() blocks it.
  function queueDecisionEligible(a: { entity_id: string; workflow_id: string | null; step_order: number; queue_roles: string[] | null }): boolean {
    const recoveryRequest = recoveryRequestById.get(a.entity_id);
    if (!recoveryRequest) return false;
    if (recoveryRequest.employee_id === session!.employeeId) return false;
    const companyId = employeeById.get(recoveryRequest.employee_id)?.company_id;
    if (!companyId) return false;
    const roles =
      a.queue_roles ??
      (legacyRoleByWorkflowStep.has(`${a.workflow_id}:${a.step_order}`) ? [legacyRoleByWorkflowStep.get(`${a.workflow_id}:${a.step_order}`)!] : []);
    return roles.some((role) => session!.grants.some((g) => g.role === role && (g.companyId === null || g.companyId === companyId)));
  }

  const recoveryApprovals = (approvals ?? []).filter((a) => {
    if (a.entity_type !== "recovery_credit" || !recoveryRequestById.has(a.entity_id)) return false;
    // A non-null approver_id is a person-specific step — the query above
    // already filtered these to session.userId, so no further check is
    // needed. A null approver_id is a queue step (legacy role_queue:% or
    // the new queue_roles) and needs the eligibility check above.
    if (a.approver_id !== null) return true;
    return queueDecisionEligible(a);
  });

  // HR's own correction (adjust_recovery_credit_request()) is HR-Admin-only
  // server-side — hiding it from a project lead deciding their own
  // 'employee_lead_then_hr' step (who otherwise has no use for it) avoids
  // offering a control that would just fail.
  function isHrAdminFor(companyId: string | undefined): boolean {
    if (!companyId) return false;
    return session!.grants.some((g) => g.role === "hr_admin" && (g.companyId === null || g.companyId === companyId));
  }

  const EVENT_TYPE_CELL: Record<string, string> = {
    standard: "Weekend / holiday",
    overnight: "Overnight",
    window: "24-hour window",
    window_top_up: "Window top-up",
    window_reduction: "Window reduction",
  };

  const APPLICANT_ROUTE_LABELS: Record<string, string> = {
    employee_lead_then_hr: "Project lead → HR",
    manager_hr_direct: "Manager → HR",
    hr_admin_ceo_cto_queue: "Shared CEO/CTO queue",
    self_led_hr_direct: "Self-led → HR (independent review)",
  };

  const WORK_MODE_LABELS: Record<string, string> = {
    office: "Office",
    wfh: "WFH",
    site_work: "Site work",
    client_meeting: "Client meeting",
    business_travel: "Business travel",
  };

  // Self-clock recovery-credit candidates that never got routed at all
  // (awaiting_project_lead, or a resolved routing_issue such as "the named
  // lead has no HR Engine account") never have an approvals row — see
  // sync_attendance_recovery_for_day()'s own doc comment in schema.sql —
  // so they would otherwise be entirely invisible on this page. HR sees
  // them here as an UNRESOLVED review state, never silently dropped.
  const { data: unresolvedRecoveryRequestsRaw } = await supabase
    .from("recovery_credit_requests")
    .select("id, employee_id, status, work_date, event_type, proposed_days, work_mode, project_name, applicant_route, awaiting_project_lead, routing_issue")
    .or("awaiting_project_lead.eq.true,routing_issue.not.is.null");
  const unresolvedRecoveryRequests = (unresolvedRecoveryRequestsRaw ?? []).filter(
    (r) => !["cancelled", "rejected", "approved"].includes(r.status),
  );
  const unresolvedEmployeeIds = [...new Set(unresolvedRecoveryRequests.map((r) => r.employee_id))];
  const { data: unresolvedEmployees } =
    unresolvedEmployeeIds.length > 0
      ? await supabase.from("employees").select("id, first_name, last_name, company_id").in("id", unresolvedEmployeeIds)
      : { data: [] as { id: string; first_name: string; last_name: string; company_id: string }[] };
  const unresolvedEmployeeById = new Map((unresolvedEmployees ?? []).map((e) => [e.id, e]));
  const visibleUnresolvedRequests = unresolvedRecoveryRequests.filter((r) => {
    const companyId = unresolvedEmployeeById.get(r.employee_id)?.company_id;
    return isHrAdminFor(companyId);
  });

  const nothingPending =
    leaveApprovals.length === 0 &&
    claimApprovals.length === 0 &&
    timesheetApprovals.length === 0 &&
    letterApprovals.length === 0 &&
    payrollApprovals.length === 0 &&
    recoveryApprovals.length === 0;

  // Recovery Leave earning is now ONE HR decision — a company-scoped queue
  // any current HR Admin may decide (see seed_default_approval_workflows()/
  // decide_leave_approval()'s 'role_queue:hr_admin' handling in schema.sql)
  // — never a manager-then-HR chain.
  // Self-clock-sourced requests (attendance_record_id null, segment_id set —
  // see recovery_credit_requests' own doc comment) have no single
  // attendance_records row to read original hours from; that evidence lives
  // in attendance_segments instead, which the Approvals UI does not yet
  // surface (see task tracking the 4-tier routing UI).
  function recoveryHours(recoveryRequest: { attendance_record_id: string | null; event_type: string; employee_id: string; work_date: string }): number | null {
    if (recoveryRequest.attendance_record_id === null) return selfClockRecordedHours(recoveryRequest);
    const attendance = attendanceById.get(recoveryRequest.attendance_record_id);
    const hours = recoveryRequest.event_type === "overnight" ? attendance?.active_hours_after_midnight : attendance?.hours_worked;
    return hours === null || hours === undefined ? null : Number(hours);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-muted-foreground">Requests waiting on your decision.</p>
      </div>

      {nothingPending ? (
        <Card>
          <CardContent>
            <EmptyState dense title="Nothing waiting on you right now." description="Requests routed to you for approval will show up here." />
          </CardContent>
        </Card>
      ) : null}

      {leaveApprovals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Leave requests</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaveApprovals.map((a) => {
                  const request = requestById.get(a.entity_id)!;
                  const insufficientBalance = hasInsufficientBalance(request);
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{employeeName(request.employee_id)}</TableCell>
                      <TableCell className="capitalize">{request.leave_type_code.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        {request.start_date === request.end_date ? request.start_date : `${request.start_date} – ${request.end_date}`}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {request.total_days}
                          {insufficientBalance ? (
                            <Badge variant="destructive" title="This employee's available balance for this leave type won't cover the full request — approving will draw it negative.">
                              Insufficient balance
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">{request.reason ?? "—"}</TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <StatusBadge status="pending_approval" />
                          <p className="text-xs text-muted-foreground">{statusNextAction("pending_approval", { asApprover: true })}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DecisionButtons approvalId={a.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {claimApprovals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Reimbursement claims</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Claim</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {claimApprovals.map((a) => {
                  const claim = claimById.get(a.entity_id)!;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{employeeName(claim.employee_id)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/reimbursements/${claim.id}`} className="hover:underline">
                          {claim.id.slice(0, 8)}…
                        </Link>
                      </TableCell>
                      <TableCell>{claim.claim_date}</TableCell>
                      <TableCell>
                        {claim.currency} {claim.total_amount}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <StatusBadge status="pending_approval" />
                          <p className="text-xs text-muted-foreground">{statusNextAction("pending_approval", { asApprover: true })}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DecisionButtons approvalId={a.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {timesheetApprovals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Timesheets</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {timesheetApprovals.map((a) => {
                  const timesheet = timesheetById.get(a.entity_id)!;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{employeeName(timesheet.employee_id)}</TableCell>
                      <TableCell>
                        {timesheet.period_start} – {timesheet.period_end}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <StatusBadge status="pending_approval" />
                          <p className="text-xs text-muted-foreground">{statusNextAction("pending_approval", { asApprover: true })}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DecisionButtons approvalId={a.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {letterApprovals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Letters</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {letterApprovals.map((a) => {
                  const letter = letterById.get(a.entity_id)!;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{employeeName(letter.employee_id)}</TableCell>
                      <TableCell>{templateName.get(letter.template_id) ?? "—"}</TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <StatusBadge status="pending_approval" />
                          <p className="text-xs text-muted-foreground">{statusNextAction("pending_approval", { asApprover: true })}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DecisionButtons approvalId={a.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {payrollApprovals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Payroll exports</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payrollApprovals.map((a) => {
                  const run = payrollRunById.get(a.entity_id)!;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        {run.period_month}/{run.period_year}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <StatusBadge status="pending_approval" />
                          <p className="text-xs text-muted-foreground">{statusNextAction("pending_approval", { asApprover: true })}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DecisionButtons approvalId={a.id} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {recoveryApprovals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recovery Leave credits</CardTitle>
            <p className="text-xs text-muted-foreground">
              Routed per each request&apos;s own applicant tier (see the Route column) — a shared queue means ANY current holder of that
              step&apos;s role may decide it, not one assigned person.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Decide</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recoveryApprovals.map((a) => {
                  const recoveryRequest = recoveryRequestById.get(a.entity_id)!;
                  const attendance = recoveryRequest.attendance_record_id ? attendanceById.get(recoveryRequest.attendance_record_id) : undefined;
                  const originalHours = recoveryHours(recoveryRequest);
                  const isSelfClock = recoveryRequest.attendance_record_id === null;
                  const companyId = employeeById.get(recoveryRequest.employee_id)?.company_id;
                  const windowRow = recoveryRequest.recovery_window_id ? windowById.get(recoveryRequest.recovery_window_id) : undefined;
                  const period = windowRow ? periodById.get(windowRow.period_id) : undefined;
                  // The lead's own step (step 1 of "project lead, then HR") is a provisional release, not the final
                  // approval, so the final-approval blockers only apply to every other step.
                  const isFinalStep = !(recoveryRequest.applicant_route === "employee_lead_then_hr" && a.step_order === 1);
                  const blocker = windowRow && isFinalStep ? (blockerByRequest.get(recoveryRequest.id) ?? null) : null;
                  const employeeCountry = employeeById.get(recoveryRequest.employee_id)?.country_code ?? "";
                  const windowEvidence: WindowEvidenceData | null =
                    windowRow && period
                      ? {
                          requestId: recoveryRequest.id,
                          eventType: recoveryRequest.event_type,
                          proposedDays: Number(recoveryRequest.proposed_days),
                          applicantRoute: recoveryRequest.applicant_route,
                          routingIssue: recoveryRequest.routing_issue,
                          needsAcknowledgement: recoveryRequest.event_type === "window_reduction" && !recoveryRequest.consumption_ack_at && (blocker ?? "").includes("already been used"),
                          blocker,
                          canVerify: isHrAdminFor(companyId),
                          timeZone: resolveCountryTimeZone(employeeCountry),
                          countryCode: employeeCountry,
                          policyVersionLabel: policyVersionById.has(windowRow.policy_version_id) ? `version ${policyVersionById.get(windowRow.policy_version_id)}` : "(version not visible to you)",
                          rulesSummary: (() => {
                            const rules = period.rules as { normal_day?: { zero_max_hours: number; half_max_hours: number }; rest_day?: { zero_below_hours: number; half_max_hours: number } };
                            if (windowRow.classification === "normal_day" && rules.normal_day)
                              return `Rule: up to ${rules.normal_day.zero_max_hours} h = 0; over ${rules.normal_day.zero_max_hours} h to ${rules.normal_day.half_max_hours} h = 0.5; over ${rules.normal_day.half_max_hours} h = 1 day.`;
                            if (rules.rest_day)
                              return `Rule (${CLASSIFICATION_LABELS[windowRow.classification]}): under ${rules.rest_day.zero_below_hours} h = 0; ${rules.rest_day.zero_below_hours}–${rules.rest_day.half_max_hours} h = 0.5; over ${rules.rest_day.half_max_hours} h = 1 day.`;
                            return "";
                          })(),
                          window: {
                            id: windowRow.id,
                            index: windowRow.window_index,
                            start: windowRow.window_start,
                            end: windowRow.window_end,
                            startingLocalDate: windowRow.starting_local_date,
                            classification: windowRow.classification,
                            holidayName: windowRow.holiday_name,
                            recordedSeconds: Number(windowRow.recorded_seconds),
                            status: windowRow.status,
                            closedReason: windowRow.closed_reason,
                            entitlementDays: Number(windowRow.entitlement_days),
                            flags: windowRow.review_flags,
                            hrVerificationRequired: windowRow.hr_verification_required,
                            hrVerifiedAt: windowRow.hr_verified_at,
                            hrVerificationNote: windowRow.hr_verification_note,
                            revisionNo: windowRow.revision_no,
                          },
                          periodStartedAt: period.started_at,
                          allocations: (allocationRows ?? [])
                            .filter((al) => al.window_id === windowRow.id)
                            .map((al) => ({
                              id: al.id,
                              mode: al.work_mode,
                              projectName: al.project_name,
                              leadName: al.project_lead_employee_id ? leadNameById.get(al.project_lead_employee_id) ?? null : null,
                              start: al.alloc_start,
                              end: al.alloc_end,
                              seconds: Number(al.seconds),
                              byHr: hrSessionIds.has(al.session_id),
                            })),
                          revisions: (revisionRows ?? [])
                            .filter((rv) => rv.window_id === windowRow.id)
                            .map((rv) => ({
                              revisionNo: rv.revision_no,
                              recordedSeconds: Number(rv.recorded_seconds),
                              entitlementDays: Number(rv.entitlement_days),
                              reason: rv.reason,
                              origin: rv.origin,
                              createdAt: rv.created_at,
                            })),
                          corrections: (correctionRows ?? [])
                            .filter((c) => (allocationRows ?? []).some((al) => al.window_id === windowRow.id && al.session_id === c.session_id))
                            .map((c) => ({
                              id: c.id,
                              reason: c.reason,
                              createdAt: c.created_at,
                              originalIn: c.original_clock_in_at,
                              originalOut: c.original_clock_out_at,
                              correctedIn: c.corrected_clock_in_at,
                              correctedOut: c.corrected_clock_out_at,
                              actor: actorNameByUser.get(c.actor_id) ?? "HR",
                            })),
                          steps: (stepRows ?? [])
                            .filter((st) => st.entity_id === recoveryRequest.id)
                            .map((st) => ({
                              stepOrder: st.step_order,
                              label: st.approver_id ? "Project lead" : (st.queue_roles ?? []).map((role) => (role === "hr_admin" ? "HR Admin" : role.toUpperCase())).join(" or "),
                              decision: st.decision,
                            })),
                        }
                      : null;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{employeeName(recoveryRequest.employee_id)}</TableCell>
                      <TableCell>{EVENT_TYPE_CELL[recoveryRequest.event_type] ?? recoveryRequest.event_type}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {recoveryRequest.applicant_route ? APPLICANT_ROUTE_LABELS[recoveryRequest.applicant_route] ?? recoveryRequest.applicant_route : "Legacy HR queue"}
                      </TableCell>
                      <TableCell className="max-w-md space-y-1 text-xs text-muted-foreground">
                        {windowEvidence ? (
                          <RecoveryWindowEvidence data={windowEvidence} />
                        ) : isSelfClock ? (
                          <>
                            <p>
                              Self-clock: {WORK_MODE_LABELS[recoveryRequest.work_mode ?? ""] ?? recoveryRequest.work_mode ?? "—"}
                              {recoveryRequest.project_name ? ` — ${recoveryRequest.project_name}` : ""}
                            </p>
                            {recoveryRequest.project_lead_employee_id ? <p>Lead: {employeeName(recoveryRequest.project_lead_employee_id)}</p> : null}
                            <p>Recorded clock time that day: {originalHours != null ? `${originalHours} h` : "not available"}</p>
                          </>
                        ) : (
                          <p>Source: Manual entry</p>
                        )}
                        {recoveryRequest.needs_policy_review && !windowEvidence ? (
                          <Badge variant="warning" title="Business travel and/or multiple site-work leads on this day — HR's own judgment call, not auto-decided.">
                            Needs policy review
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <RecoveryCreditDecisionForm
                          requestId={recoveryRequest.id}
                          originalWorkDate={attendance?.work_date ?? recoveryRequest.work_date}
                          originalHours={originalHours}
                          currentWorkDate={recoveryRequest.work_date}
                          currentDays={Number(recoveryRequest.proposed_days)}
                          wasCorrected={Boolean(recoveryRequest.corrected_at)}
                          canCorrect={isHrAdminFor(companyId)}
                          checkedWithRequired={recoveryRequest.applicant_route !== "employee_lead_then_hr"}
                          windowMode={!!windowRow}
                          blockedReason={blocker}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {visibleUnresolvedRequests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Unresolved recovery credit routing</CardTitle>
            <p className="text-xs text-muted-foreground">
              These self-clock candidates could not be routed automatically — never discarded, never guessed. Resolve the missing detail to
              route them for approval.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Work date</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Why unresolved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleUnresolvedRequests.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{unresolvedEmployeeById.get(r.employee_id) ? `${unresolvedEmployeeById.get(r.employee_id)!.first_name} ${unresolvedEmployeeById.get(r.employee_id)!.last_name}` : "—"}</TableCell>
                    <TableCell>{r.work_date}</TableCell>
                    <TableCell>{Number(r.proposed_days)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.awaiting_project_lead
                        ? "Awaiting a project lead — the employee or HR can supply one from the employee's own Attendance Clock page."
                        : (r.routing_issue ?? "Unknown routing issue.")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
