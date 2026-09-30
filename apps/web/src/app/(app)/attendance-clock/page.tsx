import { CalendarClock, MapPin } from "lucide-react";
import { resolveCountryTimeZone, formatBusinessTime } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { ClockControls } from "./clock-controls";
import { ResolveProjectLeadForm } from "./resolve-project-lead-form";

const WORK_MODE_LABELS: Record<string, string> = {
  office: "Office",
  wfh: "Work from home",
  site_work: "Site work / Installation",
  client_meeting: "Client meeting",
  business_travel: "Business travel",
};

function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const totalMinutes = Math.max(0, Math.round((end - start) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

// Stored timestamps are UTC; every display here renders in the employee's
// OWN country timezone (via resolveCountryTimeZone(employee.country_code)),
// never the viewer's browser/OS timezone — toLocaleString() would otherwise
// silently use the latter, which is wrong for a traveling employee or an HR
// Admin viewing someone else's session in a different country.
function formatDateTimeInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

/**
 * The employee's own attendance clock — Clock In / Clock Out only (never
 * Start Break / End Break, see attendance_sessions' own doc comment in
 * schema.sql), work mode selection, and mid-shift work-mode switching
 * without ending the session. Every timestamp shown here is server-derived
 * from clock_in_at/segment_start/segment_end — the employee never asserts
 * one directly.
 */
export default async function AttendanceClockPage() {
  const session = await getCurrentSession();
  if (!session) return null; // guarded by the layout above

  if (!session.employeeId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">My Attendance Clock</h1>
        </div>
        <EmptyState
          title="No employee record is linked to your account."
          description="Attendance clocking is only available to accounts linked to an employee profile. Contact HR Admin if you believe this is a mistake."
        />
      </div>
    );
  }

  const supabase = await createClient();
  const employeeId = session.employeeId;

  const { data: employee } = await supabase.from("employees").select("company_id, country_code").eq("id", employeeId).maybeSingle();
  const timeZone = resolveCountryTimeZone(employee?.country_code);

  const [{ data: openSession }, { data: colleagues }, { data: recentSessions }, { data: awaitingLeadRequests }] = await Promise.all([
    supabase
      .from("attendance_sessions")
      .select("id, clock_in_at, status")
      .eq("employee_id", employeeId)
      .eq("status", "open")
      .maybeSingle(),
    employee?.company_id
      ? supabase
          .from("employees")
          .select("id, first_name, last_name")
          .eq("company_id", employee.company_id)
          .eq("employment_status", "active")
          .is("deleted_at", null)
          .order("first_name")
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    supabase
      .from("attendance_sessions")
      .select("id, clock_in_at, clock_out_at, status, hr_closed_reason")
      .eq("employee_id", employeeId)
      .order("clock_in_at", { ascending: false })
      .limit(10),
    supabase
      .from("recovery_credit_requests")
      .select("id, work_date, event_type, proposed_days")
      .eq("employee_id", employeeId)
      .eq("awaiting_project_lead", true),
  ]);

  let openSegment: {
    id: string;
    work_mode: string;
    project_name: string | null;
    project_lead_employee_id: string | null;
    segment_start: string;
  } | null = null;
  if (openSession) {
    const { data } = await supabase
      .from("attendance_segments")
      .select("id, work_mode, project_name, project_lead_employee_id, segment_start")
      .eq("session_id", openSession.id)
      .is("segment_end", null)
      .maybeSingle();
    openSegment = data ?? null;
  }

  const sessionIds = (recentSessions ?? []).map((s) => s.id);
  const { data: recentSegments } =
    sessionIds.length > 0
      ? await supabase
          .from("attendance_segments")
          .select("id, session_id, work_mode, project_name, segment_start, segment_end")
          .in("session_id", sessionIds)
          .order("segment_start", { ascending: true })
      : { data: [] as { id: string; session_id: string; work_mode: string; project_name: string | null; segment_start: string; segment_end: string | null }[] };
  const segmentsBySession = new Map<string, typeof recentSegments>();
  for (const seg of recentSegments ?? []) {
    const list = segmentsBySession.get(seg.session_id) ?? [];
    list.push(seg);
    segmentsBySession.set(seg.session_id, list);
  }

  const employeeName = (id: string | null) => {
    if (!id) return "—";
    const e = (colleagues ?? []).find((c) => c.id === id);
    return e ? `${e.first_name} ${e.last_name}` : "—";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My Attendance Clock</h1>
        <p className="text-muted-foreground">Clock in and out, and switch work mode mid-shift — no start/end break actions.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {openSession && openSegment ? (
              <span className="flex items-center gap-2">
                <Badge variant="success">Clocked in</Badge>
                since {formatBusinessTime(timeZone, new Date(openSession.clock_in_at))} (
                {formatDuration(openSession.clock_in_at, null)})
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Badge variant="secondary">Not clocked in</Badge>
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {openSegment ? (
            <p className="mb-4 text-sm text-muted-foreground">
              Current: {WORK_MODE_LABELS[openSegment.work_mode] ?? openSegment.work_mode}
              {openSegment.project_name ? ` — ${openSegment.project_name}` : ""}
              {openSegment.project_lead_employee_id ? ` (lead: ${employeeName(openSegment.project_lead_employee_id)})` : ""}
              {" — "}
              {formatDuration(openSegment.segment_start, null)} on this segment
            </p>
          ) : null}
          <ClockControls
            isClockedIn={!!openSession}
            currentWorkMode={openSegment?.work_mode ?? null}
            colleagues={colleagues ?? []}
          />
        </CardContent>
      </Card>

      {(awaitingLeadRequests ?? []).length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recovery credit awaiting a project lead</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              This work qualified for Recovery Leave, but no project lead was recorded for it. Select one to route it for approval — it is
              never discarded while you do this.
            </Alert>
            {(awaitingLeadRequests ?? []).map((r) => (
              <ResolveProjectLeadForm
                key={r.id}
                requestId={r.id}
                workDate={r.work_date}
                proposedDays={Number(r.proposed_days)}
                colleagues={colleagues ?? []}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {(recentSessions ?? []).length === 0 ? (
            <EmptyState dense icon={CalendarClock} title="No attendance sessions yet." description="Clock in above to start your first one." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clocked in</TableHead>
                  <TableHead>Clocked out</TableHead>
                  <TableHead>Segments</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recentSessions ?? []).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{formatDateTimeInZone(s.clock_in_at, timeZone)}</TableCell>
                    <TableCell>{s.clock_out_at ? formatDateTimeInZone(s.clock_out_at, timeZone) : "—"}</TableCell>
                    <TableCell className="max-w-sm text-xs text-muted-foreground">
                      {(segmentsBySession.get(s.id) ?? [])
                        .map((seg) => {
                          const label = WORK_MODE_LABELS[seg.work_mode] ?? seg.work_mode;
                          return seg.project_name ? `${label} (${seg.project_name})` : label;
                        })
                        .join(" → ")}
                    </TableCell>
                    <TableCell>
                      {s.status === "open" ? (
                        <Badge variant="success">Open</Badge>
                      ) : s.hr_closed_reason ? (
                        <Badge variant="warning" title={s.hr_closed_reason}>
                          Closed by HR
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Closed</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            Location is only ever captured at a Site work / Installation clock-in or clock-out — never continuously, and never for any other
            work mode.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
