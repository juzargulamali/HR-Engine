import Link from "next/link";
import { getBusinessDateString, isWeekend, resolveCountryTimeZone } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteAttendanceButton } from "./delete-attendance-button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/workspace/states";
import { formatDate } from "@/components/sales/format";
import { attendanceDayLabel, DAY_LABEL_TONE } from "@/lib/hr/attendance-status";
import { attendanceHref } from "@/lib/hr/queue";

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Attendance for one person. It leads with what needs review (a manual entry and the clock disagreeing, a recovery window waiting for HR to verify it) and the days concerned, each linking to the
 * register on that company and date with this person's row open: the register edits the original record, this tab never does. The day words are the register's own (Present, On leave, Absent,
 * Rest day, No record). Exceptions are read only for someone who can manage attendance, who is also the person who can open the register.
 */
export async function AttendanceSection({ employeeId, canManage, companyId, countryCode }: { employeeId: string; canManage: boolean; companyId: string; countryCode: string }) {
  const supabase = await createClient();
  // Two months back from this employee's own calendar day (the same look-back the HR queue uses).
  const since = new Date(Date.parse(`${getBusinessDateString(resolveCountryTimeZone(countryCode))}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: records, error }, { data: country }, { data: holidays }, conflicts, windows] = await Promise.all([
    supabase.from("attendance_records").select("id, work_date, clock_in, clock_out, hours_worked, status, source, presence_conflict").eq("employee_id", employeeId).order("work_date", { ascending: false }).limit(30),
    supabase.from("countries").select("week_start_day, working_weekdays").eq("code", countryCode).maybeSingle(),
    supabase.from("public_holidays").select("holiday_date").eq("country_code", countryCode).gte("holiday_date", since),
    canManage ? supabase.from("attendance_records").select("id, work_date").eq("employee_id", employeeId).not("presence_conflict", "is", null).gte("work_date", since).order("work_date", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    canManage ? supabase.from("recovery_windows").select("id, starting_local_date").eq("employee_id", employeeId).eq("hr_verification_required", true).is("hr_verified_at", null).gte("starting_local_date", since).order("starting_local_date", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);

  if (error) return <LoadError what="the attendance records" retryHref={`/employees/${employeeId}?tab=attendance`} />;

  const holidayDates = new Set((holidays ?? []).map((h) => h.holiday_date));
  const isRestDay = (date: string) => holidayDates.has(date) || isWeekend(date, country?.week_start_day ?? 1, country?.working_weekdays);
  const flagged = new Set((conflicts.data ?? []).map((c) => c.work_date));
  const exceptions = [
    ...(conflicts.data ?? []).map((c) => ({ key: `c-${c.id}`, date: c.work_date, text: "Manual entry and clock records differ" })),
    ...(windows.data ?? []).map((w) => ({ key: `w-${w.id}`, date: w.starting_local_date, text: "Recovery window waiting for HR verification" })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const exceptionsFailed = !!(conflicts.error || windows.error);

  return (
    <div className="space-y-4">
      {exceptionsFailed ? <LoadError what="the attendance exceptions" retryHref={`/employees/${employeeId}?tab=attendance`} /> : null}
      {exceptions.length > 0 ? (
        <Card data-testid="attendance-exceptions">
          <CardHeader><CardTitle className="text-base">Needs review ({exceptions.length})</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {exceptions.map((x) => (
                <li key={x.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span><span className="font-medium">{formatDate(x.date)}</span> · {x.text}</span>
                  <Link href={attendanceHref(companyId, x.date, employeeId)} className="font-medium text-accent hover:underline">Open this day in the register</Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Clock in</TableHead>
            <TableHead>Clock out</TableHead>
            <TableHead>Hours</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(records ?? []).map((r) => {
            const label = attendanceDayLabel({ status: r.status, hasClockEvidence: !!r.clock_in, isRestDay: isRestDay(r.work_date) });
            return (
              <TableRow key={r.id}>
                <TableCell>{r.work_date}</TableCell>
                <TableCell>{formatTime(r.clock_in)}</TableCell>
                <TableCell>{formatTime(r.clock_out)}</TableCell>
                <TableCell>{r.hours_worked ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={DAY_LABEL_TONE[label]}>{label}</Badge>
                    {flagged.has(r.work_date) ? <Badge variant="warning">Needs review</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{canManage ? <DeleteAttendanceButton recordId={r.id} employeeId={employeeId} /> : null}</TableCell>
              </TableRow>
            );
          })}
          {(records ?? []).length === 0 ? (
            <TableRow>
              <TableCell colSpan={6}>
                <EmptyState dense title="No attendance recorded yet." />
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
