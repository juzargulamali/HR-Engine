import { LoadError } from "@/components/workspace/states";
import Link from "next/link";
import { getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
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
import { CalendarDays, Clock } from "lucide-react";
import { OsStatCard } from "@/components/os/stat-card";
import { EVENT_TYPE_LABELS } from "@/lib/recovery/labels";
import { loadLeaveApprover, type LeaveApprover } from "@/lib/leave/approver";
import { loadLeaveTeam } from "@/lib/leave/team-data";
import { TeamLeaveSection } from "./team-section";

export const metadata = { title: "Leave" };

const STATUS_VALUES: RequestStatus[] = ["submitted", "pending_approval", "approved", "rejected", "cancelled"];

const sentenceCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: statusParam } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;

  // A failed role / employee read is not "no employee record": say it could not load.
  if (session.loadFailed) return <LoadError what="your account" />;

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

  const status = statusParam && (STATUS_VALUES as string[]).includes(statusParam) ? (statusParam as RequestStatus) : "";
  const supabase = await createClient();

  // This employee's own business-local date — "is this request still
  // upcoming" must use their own country's calendar day, not the server's
  // UTC one.
  const { data: me, error: meError } = await supabase.from("employees").select("country_code, company_id").eq("id", session.employeeId).maybeSingle();
  const today = getBusinessDateString(resolveCountryTimeZone(me?.country_code));

  let requestsQuery = supabase
    .from("leave_requests")
    .select("id, leave_type_code, start_date, end_date, total_days, status, reason")
    .eq("employee_id", session.employeeId)
    .order("start_date", { ascending: false });
  if (status) requestsQuery = requestsQuery.eq("status", status);

  const employeeId = session.employeeId;
  // Each part stands alone: one that cannot be read says so and the rest still show. The approver and the team are read through the person's own session.
  const [{ data: leaveBalances, error: balancesError }, { data: compBalance, error: compError }, { data: requests, error: requestsError }, recoveryRes, approverRes, team] = await Promise.all([
    supabase.from("leave_balances").select("leave_type_code, balance_days").eq("employee_id", employeeId),
    supabase.from("comp_day_balances").select("balance_days").eq("employee_id", employeeId).maybeSingle(),
    requestsQuery,
    supabase.from("recovery_credit_requests").select("id, work_date, event_type, proposed_days, status").eq("employee_id", employeeId).in("status", ["submitted", "pending_approval"]).order("work_date", { ascending: false }).limit(20),
    me?.company_id ? loadLeaveApprover(supabase, { companyId: me.company_id, employeeId, userId: session.userId }).then((v): { ok: LeaveApprover } | { failed: true } => ({ ok: v })).catch((e) => { console.error("[leave] approver could not be loaded", e); return { failed: true as const }; }) : Promise.resolve({ failed: true as const }),
    loadLeaveTeam(supabase, { employeeId, grants: session.grants }, today),
  ]);
  const recoveryFailed = !!recoveryRes.error;
  if (recoveryFailed) console.error("[leave] recovery requests could not be loaded", recoveryRes.error);
  const approver = "ok" in approverRes ? approverRes.ok : null;

  // A failed read is never "0 days" or "No leave requests yet": each part says it could not load.
  const balancesFailed = !!(balancesError || compError);
  const requestsFailed = !!(requestsError || meError);
  if (balancesFailed) console.error("[leave] balances could not be loaded", balancesError ?? compError);
  if (requestsFailed) console.error("[leave] requests could not be loaded", requestsError ?? meError);

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

      <p className="text-sm" data-testid="leave-approver">
        <span className="text-muted-foreground">Your leave requests go to </span>
        {approver === null ? <span className="text-destructive">Could not load who approves your leave. <Link href="/leave" className="font-medium underline underline-offset-2">Try again</Link></span>
          : approver.kind === "person" ? <strong>{approver.name}</strong>
          : approver.kind === "self_approved" ? <span>nobody: as a company executive your own leave needs no approver.</span>
          : <span>nobody yet. {approver.why}</span>}
        {approver?.kind === "person" ? <span className="text-muted-foreground"> first.</span> : null}
      </p>

      {balancesFailed ? (
        <LoadError what="your leave balances" retryHref="/leave" note="This is a problem loading the information, not zero days." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(leaveBalances ?? []).map((b) => (
            <OsStatCard key={b.leave_type_code} label={sentenceCase(b.leave_type_code.replace(/_/g, " "))} value={`${b.balance_days} days`} icon={CalendarDays} edge={Number(b.balance_days) > 0 ? "cyan" : "muted"} compact={false} />
          ))}
          <OsStatCard label="Recovery Leave" value={`${compBalance?.balance_days ?? 0} days`} icon={Clock} edge={Number(compBalance?.balance_days ?? 0) > 0 ? "blue" : "muted"} compact={false} />
        </div>
      )}

      {recoveryFailed ? (
        <LoadError what="your Recovery Leave requests" retryHref="/leave" note="This is a problem loading the information, not an empty list." />
      ) : (recoveryRes.data ?? []).length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recovery Leave waiting for approval</CardTitle>
          </CardHeader>
          <CardContent>
            <Table stack>
              <TableHeader>
                <TableRow><TableHead>Day worked</TableHead><TableHead>Kind</TableHead><TableHead>Days</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(recoveryRes.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.work_date}</TableCell>
                    <TableCell>{EVENT_TYPE_LABELS[r.event_type] ?? r.event_type}</TableCell>
                    <TableCell>{r.proposed_days}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

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
          {requestsFailed ? <LoadError what="your leave requests" retryHref="/leave" note="This is a problem loading the information, not an empty history." /> : (
          <Table stack>
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
                      <p className="text-sm text-muted-foreground">{statusNextAction(r.status)}</p>
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
          )}
        </CardContent>
      </Card>

      <TeamLeaveSection result={team} today={today} />
    </div>
  );
}
