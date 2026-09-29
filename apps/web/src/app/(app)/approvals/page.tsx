import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, statusNextAction } from "@/components/ui/status-badge";
import { DecisionButtons } from "./decision-buttons";

export default async function ApprovalsPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: approvals } = await supabase
    .from("approvals")
    .select("id, entity_type, entity_id, step_order, created_at")
    .eq("approver_id", session.userId)
    .eq("decision", "pending")
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
            .select("id, employee_id, attendance_record_id, work_date, event_type, proposed_days")
            .in("id", recoveryCreditIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);

  // recovery_credit_requests never exposes hours directly — "standard" days
  // derive their credit from attendance_records.hours_worked,
  // "overnight" ones from active_hours_after_midnight (see
  // record_attendance_and_recovery()/record_overnight_recovery_credit() in
  // schema.sql) — so the approver's hours figure has to come from a
  // second, separate read of the underlying attendance row.
  const attendanceRecordIds = [...new Set((recoveryRequests ?? []).map((r) => r.attendance_record_id))];
  const { data: attendanceRecords } =
    attendanceRecordIds.length > 0
      ? await supabase.from("attendance_records").select("id, hours_worked, active_hours_after_midnight").in("id", attendanceRecordIds)
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

  const leaveApprovals = (approvals ?? []).filter((a) => a.entity_type === "leave_request" && requestById.has(a.entity_id));
  const claimApprovals = (approvals ?? []).filter((a) => a.entity_type === "reimbursement_claim" && claimById.has(a.entity_id));
  const timesheetApprovals = (approvals ?? []).filter((a) => a.entity_type === "timesheet" && timesheetById.has(a.entity_id));
  const letterApprovals = (approvals ?? []).filter((a) => a.entity_type === "generated_letter" && letterById.has(a.entity_id));
  const payrollApprovals = (approvals ?? []).filter((a) => a.entity_type === "payroll_export_run" && payrollRunById.has(a.entity_id));
  const recoveryApprovals = (approvals ?? []).filter((a) => a.entity_type === "recovery_credit" && recoveryRequestById.has(a.entity_id));

  const nothingPending =
    leaveApprovals.length === 0 &&
    claimApprovals.length === 0 &&
    timesheetApprovals.length === 0 &&
    letterApprovals.length === 0 &&
    payrollApprovals.length === 0 &&
    recoveryApprovals.length === 0;

  // Recovery Leave earning is a fixed, seeded two-step workflow — step 1
  // (Line Manager, provisional) then step 2 (HR Admin, the only point that
  // posts the actual comp_day_ledger credit) — see
  // seed_default_approval_workflows() in schema.sql. Deriving the label
  // straight from this approval row's own step_order avoids a further
  // join just to read back approval_workflow_steps.approver_type; the
  // fallback covers a future workflow edit changing that fixed shape.
  function recoveryStepLabel(stepOrder: number): string {
    if (stepOrder === 1) return "Step 1 of 2 — Line Manager (provisional)";
    if (stepOrder === 2) return "Step 2 of 2 — HR Admin (final, posts the credit)";
    return `Step ${stepOrder}`;
  }

  function recoveryHours(recoveryRequest: { attendance_record_id: string; event_type: string }): string {
    const attendance = attendanceById.get(recoveryRequest.attendance_record_id);
    const hours = recoveryRequest.event_type === "overnight" ? attendance?.active_hours_after_midnight : attendance?.hours_worked;
    return hours === null || hours === undefined ? "—" : `${hours}h`;
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
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Work date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Credit</TableHead>
                  <TableHead>Approval step</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {recoveryApprovals.map((a) => {
                  const recoveryRequest = recoveryRequestById.get(a.entity_id)!;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{employeeName(recoveryRequest.employee_id)}</TableCell>
                      <TableCell>{recoveryRequest.work_date}</TableCell>
                      <TableCell className="capitalize">{recoveryRequest.event_type}</TableCell>
                      <TableCell>{recoveryHours(recoveryRequest)}</TableCell>
                      <TableCell>{recoveryRequest.proposed_days} day(s)</TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="text-sm">{recoveryStepLabel(a.step_order)}</p>
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
    </div>
  );
}
