import Link from "next/link";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CancelRequestButton } from "./cancel-request-button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, statusNextAction } from "@/components/ui/status-badge";
import type { RequestStatus } from "@/types/database.types";

const STATUS_VALUES: RequestStatus[] = ["submitted", "pending_approval", "approved", "rejected", "cancelled"];

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusParam } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;

  if (!session.employeeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Leave</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          No employee record is linked to your account yet — nothing to show here.
        </CardContent>
      </Card>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const status = statusParam && (STATUS_VALUES as string[]).includes(statusParam) ? (statusParam as RequestStatus) : "";
  const supabase = await createClient();

  let requestsQuery = supabase
    .from("leave_requests")
    .select("id, leave_type_code, start_date, end_date, total_days, status, reason")
    .eq("employee_id", session.employeeId)
    .order("start_date", { ascending: false });
  if (status) requestsQuery = requestsQuery.eq("status", status);

  const [{ data: leaveBalances }, { data: compBalance }, { data: requests }] = await Promise.all([
    supabase.from("leave_balances").select("leave_type_code, balance_days").eq("employee_id", session.employeeId),
    supabase.from("comp_day_balances").select("balance_days").eq("employee_id", session.employeeId).maybeSingle(),
    requestsQuery,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My Leave</h1>
          <p className="text-muted-foreground">Your leave balances and requests.</p>
        </div>
        <Link href="/leave/new" className={cn(buttonVariants({ size: "sm" }))}>
          Request leave
        </Link>
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle>My requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={status}>
                <option value="">All</option>
                {STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>
            <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Apply
            </button>
            {status ? (
              <Link href="/leave" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                Reset
              </Link>
            ) : null}
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(requests ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="capitalize">{r.leave_type_code.replace(/_/g, " ")}</TableCell>
                  <TableCell>
                    {r.start_date === r.end_date ? r.start_date : `${r.start_date} – ${r.end_date}`}
                  </TableCell>
                  <TableCell>{r.total_days}</TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <StatusBadge status={r.status} />
                      <p className="text-xs text-muted-foreground">{statusNextAction(r.status)}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.status === "submitted" || r.status === "pending_approval" || (r.status === "approved" && r.start_date > today) ? (
                      <CancelRequestButton requestId={r.id} restoresBalance={r.status === "approved"} />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {(requests ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState dense title={status ? "No leave requests with that status." : "No leave requests yet."} />
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
