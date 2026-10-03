import Link from "next/link";
import { Clock } from "lucide-react";
import { describeRecoveryStatus, formatBusinessTime, resolveCountryTimeZone } from "@enginious-hr/domain";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ClockStatus } from "@/components/attendance/clock-status";
import { AutoRefresh } from "@/components/attendance/auto-refresh";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { CLASSIFICATION_LABELS, formatHoursMinutes, workModeLabel } from "@/lib/recovery/labels";

const EXPLAIN_NAME = "Attendance clock";

/**
 * The dashboard's attendance status for every employee linked to the signed-in
 * account (it is never rendered for an unlinked account, so nobody gets a
 * fabricated "Clocked out" state). Clock In / Clock Out / Switch mode open the
 * clock page, where the actual controls live — there are deliberately no break
 * buttons anywhere.
 *
 * Everything shown is read from recovery_live_summary(), which derives the
 * figures live from the clock evidence in the employee's OWN country time zone
 * (never the browser's), and refreshes itself every 30 seconds with a visible
 * "Last updated" and stale/disconnected states.
 *
 * Provisional Recovery Leave is shown only as a STATUS ("Awaiting closure",
 * "Awaiting approval", "Approved") — never as an available balance.
 */
export async function AttendanceClockCard({ employeeId }: { employeeId: string }) {
  const supabase = await createClient();
  const { data: summary } = await supabase.rpc("recovery_live_summary", { p_employee_id: employeeId });
  const generatedAt = new Date().toISOString();

  const timeZone = resolveCountryTimeZone(summary?.country_code);
  const clockStatus = summary?.clock_status ?? "not_started";
  const clockedIn = clockStatus === "clocked_in";
  const period = summary?.period ?? null;
  const window = summary?.window ?? null;
  const recovery = window
    ? describeRecoveryStatus({
        windowClosed: window.closed,
        entitlementDays: window.entitlement_days,
        requestStatus: window.request_status as "submitted" | "pending_approval" | "approved" | "rejected" | "cancelled" | null,
      })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" aria-hidden />
          {EXPLAIN_NAME}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <ClockStatus status={clockStatus} />
            {clockedIn && summary?.open_since ? (
              <p className="text-sm text-muted-foreground">
                {workModeLabel(summary.work_mode)}
                {summary.project_name ? ` — ${summary.project_name}` : ""} · since {formatBusinessTime(timeZone, new Date(summary.open_since))}
              </p>
            ) : null}
            {!clockedIn && clockStatus === "clocked_out" ? <p className="text-sm text-muted-foreground">Your attendance today is recorded.</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {clockedIn ? (
              <>
                <Link href="/attendance-clock" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Clock Out
                </Link>
                <Link href="/attendance-clock#switch" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Switch mode
                </Link>
              </>
            ) : (
              <Link href="/attendance-clock" className={cn(buttonVariants({ size: "sm" }))}>
                Clock In
              </Link>
            )}
          </div>
        </div>

        {period ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {window ? (
              <div>
                <dt className="text-muted-foreground">Recorded in this 24-hour window</dt>
                <dd className="font-medium">
                  {formatHoursMinutes(window.recorded_seconds)}
                  {!window.closed ? <span className="ml-2 text-xs font-normal text-muted-foreground">so far</span> : null}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">Working period began</dt>
              <dd className="font-medium">
                {new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(
                  new Date(period.started_at),
                )}
              </dd>
            </div>
            {window && recovery ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">
                  Recovery for this window ({CLASSIFICATION_LABELS[window.classification]})
                </dt>
                <dd className="font-medium">
                  {recovery.status === "none" ? (
                    "No recovery day so far"
                  ) : (
                    <>
                      {window.entitlement_days} day{window.entitlement_days === 1 ? "" : "s"} — <Badge variant="secondary">{recovery.label}</Badge>
                      <span className="ml-2 text-xs font-normal text-muted-foreground">Provisional: not part of your available balance until approved.</span>
                    </>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {period?.long_work_warning ? (
          <Alert variant="warning">
            You have recorded {period.alert_work_hours}+ hours of work without a {period.rest_gap_hours}-hour rest. This is a notice for HR to
            review — recording continues and nothing is lost. Please rest when it is safe to.
          </Alert>
        ) : null}
        {period && period.rollover_count > 0 && clockedIn ? (
          <p className="text-xs text-muted-foreground">
            Your 24-hour recovery window rolled over automatically — you do not need to clock out for that.
          </p>
        ) : null}

        <AutoRefresh generatedAt={generatedAt} timeZone={timeZone} intervalSeconds={30} />
      </CardContent>
    </Card>
  );
}
