import { createClient } from "@/lib/supabase/server";
import { EVENT_TYPE_LABELS } from "@/lib/recovery/labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/workspace/states";
import { OvernightRecoveryForm } from "./overnight-recovery-form";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  submitted: "secondary",
  pending_approval: "secondary",
  approved: "default",
  rejected: "destructive",
  cancelled: "outline",
};

/**
 * Read-only summary — the actionable "request leave"/"cancel" flow stays on
 * /leave (the employee's own self-service page); this tab exists so
 * HR/manager/Finance/CEO/CTO can see the same balances and history without
 * leaving the employee's profile. Reuses the exact same queries and badge
 * mapping as /leave/page.tsx rather than introducing a new pattern.
 */
export async function LeaveSection({ employeeId, canRecordOvernightRecovery = false }: { employeeId: string; canRecordOvernightRecovery?: boolean }) {
  const supabase = await createClient();
  const [{ data: leaveBalances, error: balancesError }, { data: compBalance, error: compError }, { data: requests, error: requestsError }, { data: recoveryCreditRequests, error: recoveryError }] = await Promise.all([
    supabase.from("leave_balances").select("leave_type_code, balance_days").eq("employee_id", employeeId),
    supabase.from("comp_day_balances").select("balance_days").eq("employee_id", employeeId).maybeSingle(),
    supabase
      .from("leave_requests")
      .select("id, leave_type_code, start_date, end_date, total_days, status")
      .eq("employee_id", employeeId)
      .order("start_date", { ascending: false })
      .limit(20),
    // Recovery Leave EARNING status — a separate approval chain from the
    // leave_requests table above (which only covers CONSUMING an
    // already-earned day). RLS (recovery_credit_requests_select) already
    // scopes this to the employee themselves, their manager, or HR Admin.
    supabase
      .from("recovery_credit_requests")
      .select("id, work_date, event_type, proposed_days, status")
      .eq("employee_id", employeeId)
      .order("work_date", { ascending: false })
      .limit(20),
  ]);

  // Each part stands alone: a failed read says so (never "0 days" or "No ... yet") and the other parts still show.
  const balancesFailed = !!(balancesError || compError);
  const here = `/employees/${employeeId}`;

  return (
    <div className="space-y-4">
      {balancesFailed ? <LoadError what="the leave balances" retryHref={here} note="This is a problem loading the information, not zero days." /> : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(leaveBalances ?? []).map((b) => (
          <Card key={b.leave_type_code}>
            <CardHeader>
              <CardTitle className="text-sm font-medium capitalize text-muted-foreground">
                {b.leave_type_code.replace(/_/g, " ")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{b.balance_days} days</CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Comp-off</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{compBalance?.balance_days ?? 0} days</CardContent>
        </Card>
      </div>
      )}

      {requestsError ? <LoadError what="the leave requests" retryHref={here} /> : (
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Dates</TableHead>
            <TableHead>Days</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(requests ?? []).map((r) => (
            <TableRow key={r.id}>
              <TableCell className="capitalize">{r.leave_type_code.replace(/_/g, " ")}</TableCell>
              <TableCell>{r.start_date === r.end_date ? r.start_date : `${r.start_date} – ${r.end_date}`}</TableCell>
              <TableCell>{r.total_days}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status.replace(/_/g, " ")}</Badge>
              </TableCell>
            </TableRow>
          ))}
          {(requests ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={4}>
                <EmptyState dense title="No leave requests yet." />
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      )}

      <div className="space-y-2 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Recovery Leave earning (Reporting Manager → HR Admin approval)</h3>
        {recoveryError ? <LoadError what="the recovery credit requests" retryHref={here} /> : (
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(recoveryCreditRequests ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.work_date}</TableCell>
                <TableCell>{EVENT_TYPE_LABELS[r.event_type] ?? r.event_type}</TableCell>
                <TableCell>{r.proposed_days}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status.replace(/_/g, " ")}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {(recoveryCreditRequests ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <EmptyState dense title="No recovery credit requests yet." />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        )}
      </div>

      {canRecordOvernightRecovery ? <OvernightRecoveryForm employeeId={employeeId} /> : null}
    </div>
  );
}
