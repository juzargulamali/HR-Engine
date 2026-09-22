import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  const [{ data: requests }, { data: claims }, { data: timesheets }] = await Promise.all([
    leaveRequestIds.length > 0
      ? supabase.from("leave_requests").select("id, employee_id, leave_type_code, start_date, end_date, total_days, reason").in("id", leaveRequestIds)
      : Promise.resolve({ data: [] as never[] }),
    claimIds.length > 0
      ? supabase.from("reimbursement_claims").select("id, employee_id, claim_date, currency, total_amount").in("id", claimIds)
      : Promise.resolve({ data: [] as never[] }),
    timesheetIds.length > 0
      ? supabase.from("timesheets").select("id, employee_id, period_start, period_end").in("id", timesheetIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const employeeIds = [
    ...new Set([...(requests ?? []), ...(claims ?? []), ...(timesheets ?? [])].map((r) => r.employee_id)),
  ];
  const { data: employees } =
    employeeIds.length > 0
      ? await supabase.from("employees").select("id, first_name, last_name").in("id", employeeIds)
      : { data: [] as never[] };
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));
  const employeeName = (id: string) => {
    const e = employeeById.get(id);
    return e ? `${e.first_name} ${e.last_name}` : "—";
  };

  const requestById = new Map((requests ?? []).map((r) => [r.id, r]));
  const claimById = new Map((claims ?? []).map((c) => [c.id, c]));
  const timesheetById = new Map((timesheets ?? []).map((t) => [t.id, t]));

  const leaveApprovals = (approvals ?? []).filter((a) => a.entity_type === "leave_request" && requestById.has(a.entity_id));
  const claimApprovals = (approvals ?? []).filter((a) => a.entity_type === "reimbursement_claim" && claimById.has(a.entity_id));
  const timesheetApprovals = (approvals ?? []).filter((a) => a.entity_type === "timesheet" && timesheetById.has(a.entity_id));

  const nothingPending = leaveApprovals.length === 0 && claimApprovals.length === 0 && timesheetApprovals.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-muted-foreground">Requests waiting on your decision.</p>
      </div>

      {nothingPending ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">Nothing waiting on you right now.</CardContent>
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
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaveApprovals.map((a) => {
                  const request = requestById.get(a.entity_id)!;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{employeeName(request.employee_id)}</TableCell>
                      <TableCell className="capitalize">{request.leave_type_code.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        {request.start_date === request.end_date ? request.start_date : `${request.start_date} – ${request.end_date}`}
                      </TableCell>
                      <TableCell>{request.total_days}</TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">{request.reason ?? "—"}</TableCell>
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
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {claimApprovals.map((a) => {
                  const claim = claimById.get(a.entity_id)!;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{employeeName(claim.employee_id)}</TableCell>
                      <TableCell>{claim.claim_date}</TableCell>
                      <TableCell>
                        {claim.currency} {claim.total_amount}
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
