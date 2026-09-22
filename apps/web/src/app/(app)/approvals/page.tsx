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

  const leaveRequestIds = (approvals ?? [])
    .filter((a) => a.entity_type === "leave_request")
    .map((a) => a.entity_id);

  const { data: requests } =
    leaveRequestIds.length > 0
      ? await supabase
          .from("leave_requests")
          .select("id, employee_id, leave_type_code, start_date, end_date, total_days, reason")
          .in("id", leaveRequestIds)
      : { data: [] as never[] };

  const employeeIds = [...new Set((requests ?? []).map((r) => r.employee_id))];
  const { data: employees } =
    employeeIds.length > 0
      ? await supabase.from("employees").select("id, first_name, last_name").in("id", employeeIds)
      : { data: [] as never[] };

  const requestById = new Map((requests ?? []).map((r) => [r.id, r]));
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-muted-foreground">Requests waiting on your decision.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending your decision</CardTitle>
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
              {(approvals ?? []).map((a) => {
                const request = requestById.get(a.entity_id);
                if (!request) return null;
                const employee = employeeById.get(request.employee_id);
                return (
                  <TableRow key={a.id}>
                    <TableCell>{employee ? `${employee.first_name} ${employee.last_name}` : "—"}</TableCell>
                    <TableCell className="capitalize">{request.leave_type_code.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      {request.start_date === request.end_date
                        ? request.start_date
                        : `${request.start_date} – ${request.end_date}`}
                    </TableCell>
                    <TableCell>{request.total_days}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">{request.reason ?? "—"}</TableCell>
                    <TableCell>
                      <DecisionButtons approvalId={a.id} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {(approvals ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nothing waiting on you right now.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
