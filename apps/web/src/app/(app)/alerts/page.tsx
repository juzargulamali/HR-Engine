import Link from "next/link";
import { canViewHrAlerts, formatRecordedDuration, resolveCountryTimeZone } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { AutoRefresh } from "@/components/attendance/auto-refresh";
import { ALERT_TYPE_LABELS } from "@/lib/recovery/labels";
import { AcknowledgeAlertForm } from "./acknowledge-alert-form";

const HORIZON_DAYS = 30;

function daysUntil(dateStr: string, today: Date): number {
  const target = new Date(`${dateStr}T00:00:00Z`);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function UrgencyBadge({ days }: { days: number }) {
  if (days < 0) return <Badge variant="destructive">{Math.abs(days)}d overdue</Badge>;
  if (days === 0) return <Badge variant="destructive">Due today</Badge>;
  return <Badge variant="secondary">{days}d left</Badge>;
}

export default async function AlertsPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  if (!canViewHrAlerts(session.grants)) {
    return <Alert variant="destructive">Alerts are restricted to HR Admin, CEO, and CTO.</Alert>;
  }

  const supabase = await createClient();
  const today = new Date();
  const horizon = new Date(today.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  // No explicit company filter on any of these — like employees/page.tsx,
  // RLS alone decides what's visible (every company an HR Admin/CEO/CTO
  // grant covers), never re-derived here.
  const generatedAt = new Date().toISOString();
  const [{ data: employees }, { data: contracts }, { data: employeeDocs }, { data: identityDocs }, { data: recoveryAlerts }, { data: schedulerStatus }, { data: companies }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, company_id, country_code").is("deleted_at", null),
    supabase
      .from("employment_contracts")
      .select("id, employee_id, contract_type, end_date, probation_end_date")
      .eq("is_current", true)
      .or(`end_date.lte.${horizon},probation_end_date.lte.${horizon}`),
    supabase
      .from("employee_documents")
      .select("id, employee_id, document_type, expiry_date, status")
      .in("status", ["expiring_soon", "expired"]),
    supabase
      .from("identity_documents")
      .select("id, employee_id, document_type, document_number, expiry_date")
      .not("expiry_date", "is", null)
      .lte("expiry_date", horizon),
    // Recovery Leave work alerts: visibility is decided entirely by row-level security
    // (HR Admin / CEO / CTO of the alert's own company — never the employee or a manager).
    supabase
      .from("recovery_alerts")
      .select("id, company_id, employee_id, alert_type, triggered_at, period_started_at, recorded_seconds, elapsed_seconds, details, status, acknowledged_at, acknowledgement_note")
      .in("status", ["open", "acknowledged"])
      .order("triggered_at", { ascending: false })
      .limit(100),
    // Health of the background processing. Only HR Admin / Sys Admin may read it; for anyone else this
    // simply returns an error and the banner is omitted.
    supabase.rpc("recovery_scheduler_status"),
    supabase.from("companies").select("id, legal_name"),
  ]);
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.legal_name]));
  const employeeMeta = new Map((employees ?? []).map((e) => [e.id, e]));
  const isHrAdmin = session.grants.some((g) => g.role === "hr_admin");
  const openAlerts = (recoveryAlerts ?? []).filter((a) => a.status === "open");
  const acknowledgedAlerts = (recoveryAlerts ?? []).filter((a) => a.status === "acknowledged").slice(0, 10);
  const alertTz = (employeeId: string) => resolveCountryTimeZone(employeeMeta.get(employeeId)?.country_code);
  const fmtLocal = (iso: string, employeeId: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: alertTz(employeeId), weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const employeeName = new Map((employees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));

  const contractsEnding = (contracts ?? [])
    .filter((c) => c.end_date)
    .map((c) => ({ ...c, days: daysUntil(c.end_date!, today) }))
    .sort((a, b) => a.days - b.days);

  const probationEnding = (contracts ?? [])
    .filter((c) => c.probation_end_date)
    .map((c) => ({ ...c, days: daysUntil(c.probation_end_date!, today) }))
    .sort((a, b) => a.days - b.days);

  const docsFlagged = (employeeDocs ?? [])
    .map((d) => ({ ...d, days: d.expiry_date ? daysUntil(d.expiry_date, today) : null }))
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  const identityFlagged = (identityDocs ?? [])
    .map((d) => ({ ...d, days: daysUntil(d.expiry_date!, today) }))
    .sort((a, b) => a.days - b.days);

  const nothingFlagged =
    contractsEnding.length === 0 &&
    probationEnding.length === 0 &&
    docsFlagged.length === 0 &&
    identityFlagged.length === 0 &&
    openAlerts.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Alerts</h1>
        <p className="text-muted-foreground">
          Contracts, probation reviews, and documents due for attention in the next {HORIZON_DAYS} days, or already
          overdue. As of {todayStr}.
        </p>
      </div>

      {schedulerStatus && schedulerStatus.windows_policy_active ? (
        <Alert variant={schedulerStatus.stale || schedulerStatus.open_failures > 0 ? "warning" : "default"}>
          <p className="font-medium">Recovery Leave background processing</p>
          <p className="mt-1">
            {schedulerStatus.last_success_at
              ? `Last successful run: ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(schedulerStatus.last_success_at))}.`
              : "It has not run yet."}{" "}
            {schedulerStatus.stale ? "It is overdue, so windows may close and alerts may appear late. " : ""}
            {schedulerStatus.open_failures > 0 ? `${schedulerStatus.open_failures} employee(s) failed on the last run and will be retried. ` : ""}
            {!schedulerStatus.pg_cron_installed || !schedulerStatus.pg_cron_job
              ? "The 5-minute database scheduler is not enabled, so only the daily safety-net run is active."
              : `Scheduler: ${schedulerStatus.pg_cron_job.schedule}${schedulerStatus.pg_cron_job.active ? "" : " (paused)"}.`}
          </p>
        </Alert>
      ) : null}

      {openAlerts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recovery Leave work alerts</CardTitle>
            <p className="text-xs text-muted-foreground">
              Warnings only: recording continues and none of these creates a recovery day by itself. Times are in each employee&apos;s own country
              time zone. Elapsed hours (the whole stretch) are not the same as recorded hours (clocked-in time only).
            </p>
            <AutoRefresh generatedAt={generatedAt} timeZone={resolveCountryTimeZone(null)} intervalSeconds={60} />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead>Working period began</TableHead>
                  <TableHead>Recorded</TableHead>
                  <TableHead>Elapsed</TableHead>
                  <TableHead>Triggered</TableHead>
                  <TableHead>Rest / rollover</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {openAlerts.map((a) => {
                  const d = a.details as { gaps?: unknown[]; still_open?: boolean; window_index?: number; threshold_hours?: number };
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link href={`/employees/${a.employee_id}`} className="hover:underline">
                          {employeeName.get(a.employee_id) ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell>{companyName.get(a.company_id) ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="warning">{ALERT_TYPE_LABELS[a.alert_type]}</Badge>
                      </TableCell>
                      <TableCell>{fmtLocal(a.period_started_at, a.employee_id)}</TableCell>
                      <TableCell>{formatRecordedDuration(Number(a.recorded_seconds))}</TableCell>
                      <TableCell>{formatRecordedDuration(Number(a.elapsed_seconds))}</TableCell>
                      <TableCell>{fmtLocal(a.triggered_at, a.employee_id)}</TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {a.alert_type === "window_rollover"
                          ? `Window ${d.window_index ?? "?"} rolled over automatically at 24 elapsed hours without a completed rest; no manual clock-out was made.`
                          : `${d.threshold_hours ?? 20} recorded hours reached without a completed rest${d.still_open ? " — still clocked in" : ""}; ${(d.gaps ?? []).length} clocked-out gap(s) shorter than the rest threshold.`}
                      </TableCell>
                      <TableCell>{isHrAdmin ? <AcknowledgeAlertForm alertId={a.id} /> : null}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {acknowledgedAlerts.length > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Recently acknowledged: {acknowledgedAlerts.map((a) => `${employeeName.get(a.employee_id) ?? "—"} (${ALERT_TYPE_LABELS[a.alert_type]})`).join(", ")}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {nothingFlagged ? (
        <Card>
          <CardContent>
            <EmptyState dense title="Nothing needs attention right now." description="No contracts, documents, or probation periods are due within the next 30 days." />
          </CardContent>
        </Card>
      ) : null}

      {contractsEnding.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Contracts ending</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Contract type</TableHead>
                  <TableHead>End date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractsEnding.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/employees/${c.employee_id}`} className="hover:underline">
                        {employeeName.get(c.employee_id) ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{c.contract_type.replace(/_/g, " ")}</TableCell>
                    <TableCell>{c.end_date}</TableCell>
                    <TableCell>
                      <UrgencyBadge days={c.days} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {probationEnding.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Probation reviews due</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Probation end date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {probationEnding.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/employees/${c.employee_id}`} className="hover:underline">
                        {employeeName.get(c.employee_id) ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell>{c.probation_end_date}</TableCell>
                    <TableCell>
                      <UrgencyBadge days={c.days} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {docsFlagged.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Documents expiring or expired</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docsFlagged.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/employees/${d.employee_id}`} className="hover:underline">
                        {employeeName.get(d.employee_id) ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{d.document_type.replace(/_/g, " ")}</TableCell>
                    <TableCell>{d.expiry_date ?? "—"}</TableCell>
                    <TableCell>{d.days !== null ? <UrgencyBadge days={d.days} /> : <Badge variant="outline">No date</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {identityFlagged.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Identity documents expiring soon</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {identityFlagged.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/employees/${d.employee_id}`} className="hover:underline">
                        {employeeName.get(d.employee_id) ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{d.document_type.replace(/_/g, " ")}</TableCell>
                    <TableCell className="font-mono text-xs">{d.document_number}</TableCell>
                    <TableCell>{d.expiry_date}</TableCell>
                    <TableCell>
                      <UrgencyBadge days={d.days} />
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
