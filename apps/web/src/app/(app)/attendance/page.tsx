import Link from "next/link";
import { canManageAttendance, isWeekend, getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { BulkAttendanceForm } from "./bulk-attendance-form";
import { EmptyState } from "@/components/ui/empty-state";
import { AutoRefresh } from "@/components/attendance/auto-refresh";
import { workModeLabel } from "@/lib/recovery/labels";
import { RegisterTable } from "./register-table";
import type { Colleague, RegisterDetail, RegisterRowView, SessionDetail, WindowDetail } from "./register-types";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  not_recorded: "outline",
  present: "default",
  absent: "destructive",
  leave: "secondary",
  partial_day: "secondary",
};

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; companyId?: string; q?: string; filter?: string; manual?: string }>;
}) {
  const { date, companyId: companyIdParam, q: qParam, filter: filterParam, manual: manualParam } = await searchParams;
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: companies } = await supabase.from("companies").select("id, legal_name, country_code");
  const manageableCompanies = (companies ?? []).filter((c) => canManageAttendance(session.grants, c.id));

  if (manageableCompanies.length === 0) {
    if (!session.employeeId) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Attendance</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            No employee record is linked to your account yet — nothing to show here.
          </CardContent>
        </Card>
      );
    }

    const { data: records } = await supabase
      .from("attendance_records")
      .select("id, work_date, hours_worked, status")
      .eq("employee_id", session.employeeId)
      .order("work_date", { ascending: false })
      .limit(60);

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">My Attendance</h1>
          <p className="text-muted-foreground">HR fills this in daily — this is a read-only view of your record.</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(records ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.work_date}</TableCell>
                    <TableCell>{r.hours_worked ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {(records ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <EmptyState dense title="No attendance recorded yet." />
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

  const companyId = companyIdParam && manageableCompanies.some((c) => c.id === companyIdParam) ? companyIdParam : manageableCompanies[0]!.id;
  const company = manageableCompanies.find((c) => c.id === companyId)!;
  // Default date is this company's own business-local "today" — not the
  // server's UTC one — since this page is always scoped to exactly one
  // company at a time.
  const workDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getBusinessDateString(resolveCountryTimeZone(company.country_code));
  const q = (qParam ?? "").trim().slice(0, 100);

  const timeZone = resolveCountryTimeZone(company.country_code);
  const generatedAt = new Date().toISOString();
  const filter = FILTERS.some((f) => f.value === filterParam) ? (filterParam as FilterValue) : "all";
  const showManual = manualParam === "1";

  const [{ data: country }, { data: holiday }, { data: registerData, error: registerError }, { data: colleagueRows }] = await Promise.all([
    supabase.from("countries").select("week_start_day, working_weekdays").eq("code", company.country_code).single(),
    supabase.from("public_holidays").select("name").eq("country_code", company.country_code).eq("holiday_date", workDate).maybeSingle(),
    supabase.rpc("attendance_register_for_date", { p_company_id: companyId, p_date: workDate }),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("company_id", companyId)
      .eq("employment_status", "active")
      .is("deleted_at", null)
      .order("first_name"),
  ]);

  const colleagues: Colleague[] = (colleagueRows ?? []).map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}` }));
  const nameById = new Map(colleagues.map((c) => [c.id, c.name]));

  const allRows: RegisterRowView[] = (registerData ?? []).map((r) => ({
    employeeId: r.employee_id,
    name: r.employee_name,
    timeZone: r.timezone,
    clockStatus: r.clock_status,
    attendanceStatus: r.attendance_status,
    attendanceSource: r.attendance_source,
    workModes: r.work_modes,
    firstClockIn: r.first_clock_in,
    lastClockOut: r.last_clock_out,
    recordedSeconds: Number(r.recorded_seconds),
    isProvisional: r.is_provisional,
    openSince: r.open_since,
    sessionCount: r.session_count,
    recoverySummary: r.recovery_summary,
    reviewFlags: r.review_flags,
    openAlertCount: r.open_alert_count,
    presenceConflict: r.presence_conflict,
    onLeave: r.on_leave,
    hrRecorded: r.hr_recorded,
    manualHours: r.manual_hours == null ? null : Number(r.manual_hours),
  }));

  // Counts shown above the register. "Clocked in now" is a LIVE clock fact and
  // is deliberately separate from "Present on <date>" (presence stays Present
  // after clock-out). Neither ever infers an absence.
  const clockedInNow = allRows.filter((r) => r.clockStatus === "clocked_in").length;
  const presentOnDate = allRows.filter((r) => r.attendanceStatus === "present" || r.sessionCount > 0).length;
  const needsReviewCount = allRows.filter((r) => r.recoverySummary === "needs_review" || r.presenceConflict || r.openAlertCount > 0).length;
  const notStartedCount = allRows.filter((r) => r.clockStatus === "not_started" && r.attendanceStatus === "not_recorded").length;

  const needle = q.toLowerCase();
  const rows = allRows.filter((r) => {
    if (needle && !r.name.toLowerCase().includes(needle)) return false;
    switch (filter) {
      case "clocked_in":
        return r.clockStatus === "clocked_in";
      case "office":
      case "wfh":
      case "site_work":
      case "client_meeting":
      case "business_travel":
        return r.workModes.includes(filter);
      case "leave":
        return r.onLeave || r.attendanceStatus === "leave";
      case "needs_review":
        return r.recoverySummary === "needs_review" || !!r.presenceConflict || r.openAlertCount > 0;
      default:
        return true;
    }
  });

  // ---- expandable evidence: sessions/segments/corrections/locations/windows ----
  const ids = rows.map((r) => r.employeeId);
  const dayStart = new Date(`${workDate}T00:00:00Z`);
  const from = new Date(dayStart.getTime() - 26 * 3600_000).toISOString();
  const to = new Date(dayStart.getTime() + 50 * 3600_000).toISOString();
  const tzById = new Map(allRows.map((r) => [r.employeeId, r.timeZone]));
  const details: Record<string, RegisterDetail> = {};

  if (ids.length > 0) {
    const { data: segs } = await supabase
      .from("attendance_segments")
      .select("id, session_id, employee_id, work_mode, project_name, project_lead_employee_id, segment_start, segment_end")
      .in("employee_id", ids)
      .gte("segment_start", from)
      .lt("segment_start", to)
      .order("segment_start");
    const onDate = (segs ?? []).filter((sg) => getBusinessDateString(tzById.get(sg.employee_id) ?? timeZone, new Date(sg.segment_start)) === workDate);
    const sessionIds = [...new Set(onDate.map((sg) => sg.session_id))];
    const segmentIds = onDate.map((sg) => sg.id);

    const [{ data: sessions }, { data: corrections }, { data: locations }, { data: windowRows }] = await Promise.all([
      sessionIds.length > 0
        ? supabase
            .from("attendance_sessions")
            .select("id, employee_id, clock_in_at, clock_out_at, status, hr_closed_reason, recorded_by_hr, recorded_by_hr_reason, recovery_model")
            .in("id", sessionIds)
            .order("clock_in_at")
        : Promise.resolve({ data: [] as never[] }),
      sessionIds.length > 0
        ? supabase
            .from("attendance_session_corrections")
            .select("id, session_id, kind, reason, actor_id, created_at, original_clock_in_at, original_clock_out_at, corrected_clock_in_at, corrected_clock_out_at")
            .in("session_id", sessionIds)
            .order("created_at")
        : Promise.resolve({ data: [] as never[] }),
      segmentIds.length > 0
        ? supabase.from("attendance_locations").select("segment_id, event, permission_status, latitude").in("segment_id", segmentIds)
        : Promise.resolve({ data: [] as never[] }),
      supabase
        .from("recovery_windows")
        .select("id, employee_id, window_index, window_start, window_end, recorded_seconds, status, classification, entitlement_days, review_flags, hr_verification_required, hr_verified_at")
        .in("employee_id", ids)
        .eq("starting_local_date", workDate)
        .order("window_start"),
    ]);

    const windowIds = (windowRows ?? []).map((w) => w.id);
    const { data: windowRequests } =
      windowIds.length > 0
        ? await supabase.from("recovery_credit_requests").select("recovery_window_id, status, event_type").in("recovery_window_id", windowIds).eq("event_type", "window").not("status", "in", "(cancelled,rejected)")
        : { data: [] as { recovery_window_id: string | null; status: string; event_type: string }[] };
    const requestStatusByWindow = new Map((windowRequests ?? []).map((r) => [r.recovery_window_id, r.status]));

    const actorIds = [...new Set((corrections ?? []).map((c) => c.actor_id))];
    const { data: actorEmployees } =
      actorIds.length > 0 ? await supabase.from("employees").select("user_id, first_name, last_name").in("user_id", actorIds) : { data: [] as { user_id: string | null; first_name: string; last_name: string }[] };
    const actorName = new Map((actorEmployees ?? []).map((a) => [a.user_id, `${a.first_name} ${a.last_name}`]));

    const locationBySegment = new Map<string, string>();
    for (const l of locations ?? []) {
      const text = `${l.event === "segment_start" ? "start" : "end"} ${l.permission_status === "granted" ? "captured" : l.permission_status}`;
      locationBySegment.set(l.segment_id, locationBySegment.has(l.segment_id) ? `${locationBySegment.get(l.segment_id)}, ${text}` : text);
    }

    for (const id of ids) details[id] = { sessions: [], windows: [] };
    for (const ses of sessions ?? []) {
      const detail: SessionDetail = {
        id: ses.id,
        clockIn: ses.clock_in_at,
        clockOut: ses.clock_out_at,
        status: ses.status,
        hrClosedReason: ses.hr_closed_reason,
        recordedByHr: ses.recorded_by_hr,
        recordedByHrReason: ses.recorded_by_hr_reason,
        recoveryModel: ses.recovery_model,
        segments: onDate
          .filter((sg) => sg.session_id === ses.id)
          .map((sg) => ({
            id: sg.id,
            mode: sg.work_mode,
            projectName: sg.project_name,
            leadName: sg.project_lead_employee_id ? nameById.get(sg.project_lead_employee_id) ?? null : null,
            start: sg.segment_start,
            end: sg.segment_end,
            location: locationBySegment.get(sg.id) ?? null,
          })),
        corrections: (corrections ?? [])
          .filter((c) => c.session_id === ses.id)
          .map((c) => ({
            id: c.id,
            kind: c.kind,
            reason: c.reason,
            actorName: actorName.get(c.actor_id) ?? "HR",
            createdAt: c.created_at,
            originalIn: c.original_clock_in_at,
            originalOut: c.original_clock_out_at,
            correctedIn: c.corrected_clock_in_at,
            correctedOut: c.corrected_clock_out_at,
          })),
      };
      details[ses.employee_id]?.sessions.push(detail);
    }
    for (const w of windowRows ?? []) {
      const detail: WindowDetail = {
        id: w.id,
        index: w.window_index,
        start: w.window_start,
        end: w.window_end,
        recordedSeconds: Number(w.recorded_seconds),
        status: w.status,
        classification: w.classification,
        entitlementDays: Number(w.entitlement_days),
        flags: w.review_flags,
        hrVerificationRequired: w.hr_verification_required,
        hrVerifiedAt: w.hr_verified_at,
        requestStatus: requestStatusByWindow.get(w.id) ?? null,
      };
      details[w.employee_id]?.windows.push(detail);
    }
  }

  const weekStartDay = country?.week_start_day ?? 1;
  const isHolidayDate = !!holiday;
  // Prefers working_weekdays (AE/SA/PL's resolved schedule) over the
  // week_start_day-derived contiguous work week, same precedence
  // is_recovery_eligible_day() uses server-side.
  const isRecoveryDay = isHolidayDate || isWeekend(workDate, weekStartDay, country?.working_weekdays);

  // The previous manual all-row register is still reachable, but never the default:
  // it is only loaded on request (?manual=1), since typed daily totals cannot prove
  // clock gaps or recovery windows (see record_attendance_and_recovery()).
  // Which Recovery Leave rules are in force on this date for this company's country. Shown on the manual tool (and used as a
  // stable marker by the browser tests, which must expect the previous credit behaviour only while the previous rules apply).
  const { data: windowsPolicyInForce } = showManual
    ? await supabase
        .from("policy_versions")
        .select("id, version_no")
        .eq("country_code", company.country_code)
        .eq("policy_type", "overtime_rules")
        .eq("status", "active")
        .filter("payload->>model", "eq", "recovery_windows")
        .lte("effective_from", workDate)
        .or(`effective_to.is.null,effective_to.gte.${workDate}`)
        .limit(1)
        .maybeSingle()
    : { data: null };
  const recoveryModelInForce: "windowed" | "legacy" = windowsPolicyInForce ? "windowed" : "legacy";
  let manualRows: { employeeId: string; name: string; status: string; workMode: string | null; hoursWorked: string | null; isClockedIn: boolean; presenceConflict: string | null }[] = [];
  if (showManual) {
    const { data: existing } = await supabase
      .from("attendance_records")
      .select("employee_id, status, work_mode, hours_worked, source, presence_conflict")
      .eq("work_date", workDate)
      .in("employee_id", allRows.map((r) => r.employeeId));
    const existingByEmployee = new Map((existing ?? []).map((r) => [r.employee_id, r]));
    manualRows = allRows.filter((e) => !needle || e.name.toLowerCase().includes(needle)).map((e) => {
      const rec = existingByEmployee.get(e.employeeId);
      return {
        employeeId: e.employeeId,
        name: e.name,
        status: rec?.status ?? "not_recorded",
        workMode: rec?.work_mode ?? null,
        hoursWorked: rec?.hours_worked ?? null,
        isClockedIn: rec?.source === "self_clock" && rec?.status === "present" && rec?.hours_worked == null,
        presenceConflict: rec?.presence_conflict ?? null,
      };
    });
  }

  const hrLinkParams = new URLSearchParams({ companyId, date: workDate });
  if (q) hrLinkParams.set("q", q);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Attendance</h1>
          <p className="text-muted-foreground">
            Updated automatically from your team&apos;s clock-ins. Times are shown in each employee&apos;s own country time zone.
          </p>
        </div>
        <AutoRefresh generatedAt={generatedAt} timeZone={timeZone} intervalSeconds={30} />
      </div>

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="flex flex-wrap items-end gap-3">
            {manageableCompanies.length > 1 ? (
              <div className="space-y-1.5">
                <Label htmlFor="companyId">Company</Label>
                <Select id="companyId" name="companyId" defaultValue={companyId}>
                  {manageableCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.legal_name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <input type="hidden" name="companyId" value={companyId} />
            )}
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input id="date" name="date" type="date" defaultValue={workDate} />
            </div>
            {showManual ? <input type="hidden" name="manual" value="1" /> : null}
            <div className="space-y-1.5">
              <Label htmlFor="filter">Show</Label>
              <Select id="filter" name="filter" defaultValue={filter}>
                {FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q">Search name</Label>
              <Input id="q" name="q" placeholder="Employee name" defaultValue={q} />
            </div>
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

      {isRecoveryDay ? (
        <Alert>
          {isHolidayDate ? `${holiday?.name ?? "Public holiday"} — ` : "Weekly rest day — "}
          recorded work today may earn Recovery Leave under your country&apos;s policy; the amount is decided per 24-hour window from the recorded clock time.
        </Alert>
      ) : null}
      {registerError ? <Alert variant="destructive">Could not load the register: {registerError.message}</Alert> : null}

      {!showManual ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile label="Clocked in now" value={clockedInNow} hint="Live clock status — separate from attendance for the date" />
            <SummaryTile label={`Present on ${workDate}`} value={presentOnDate} hint="Stays Present after clocking out" />
            <SummaryTile label="Not started / not recorded" value={notStartedCount} hint="No clock evidence — not treated as absent" />
            <SummaryTile label="Needs review" value={needsReviewCount} hint="Conditions HR should look at" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                {company.legal_name} — {workDate}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {allRows.length > 0 ? (
                <RegisterTable rows={rows} details={details} colleagues={colleagues} workDate={workDate} canEdit />
              ) : (
                <p className="text-muted-foreground">No active employees in this company yet.</p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Recorded hours count clocked-in time only (lunch while clocked in counts; clocked-out gaps never do). While someone is still clocked
                in the figure is provisional and no verdict is shown.{" "}
                <Link href={`/attendance?${hrLinkParams.toString()}&manual=1`} className="underline">
                  Open the manual daily entry tool (previous register)
                </Link>
              </p>
            </CardContent>
          </Card>
        </>
      ) : null}

      {showManual ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {company.legal_name} — {workDate} · manual daily entry (previous register)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert data-testid="manual-register-model" data-model={recoveryModelInForce}>
              {recoveryModelInForce === "windowed" ? (
                <>
                  The window-based Recovery Leave policy (version {windowsPolicyInForce?.version_no}) is in force on {workDate}. Typed daily totals cannot prove
                  clock gaps or recovery windows, so they never create Recovery Leave on their own — they are flagged for review. Use &ldquo;Edit → Add
                  missing attendance&rdquo; above to record exact times instead.
                </>
              ) : (
                <>
                  The previous Recovery Leave rules (same-day, over-4-hours) are in force on {workDate}: a present day over 4 hours on a weekend or public
                  holiday creates a Recovery Leave request from the typed total, as before.
                </>
              )}
            </Alert>
            <BulkAttendanceForm workDate={workDate} rows={manualRows} isRecoveryDay={isRecoveryDay} />
            <p className="text-xs text-muted-foreground">
              <Link href={`/attendance?${hrLinkParams.toString()}`} className="underline">
                Back to the automatic register
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const FILTERS = [
  { value: "all", label: "Everyone" },
  { value: "clocked_in", label: "Clocked in now" },
  { value: "office", label: workModeLabel("office") },
  { value: "wfh", label: workModeLabel("wfh") },
  { value: "site_work", label: workModeLabel("site_work") },
  { value: "client_meeting", label: workModeLabel("client_meeting") },
  { value: "business_travel", label: workModeLabel("business_travel") },
  { value: "leave", label: "On leave" },
  { value: "needs_review", label: "Needs review" },
] as const;
type FilterValue = (typeof FILTERS)[number]["value"];

function SummaryTile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold" data-testid={`tile-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
