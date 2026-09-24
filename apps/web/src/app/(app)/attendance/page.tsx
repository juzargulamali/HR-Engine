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
  searchParams: Promise<{ date?: string; companyId?: string; q?: string }>;
}) {
  const { date, companyId: companyIdParam, q: qParam } = await searchParams;
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

  let employeesQuery = supabase
    .from("employees")
    .select("id, first_name, last_name")
    .eq("company_id", companyId)
    .eq("employment_status", "active")
    .is("deleted_at", null)
    .order("first_name");
  if (q) {
    // Same PostgREST-filter-injection guard as the Employees list page: strip
    // the characters the .or() mini-language treats specially before use.
    const safeQ = q.replace(/[,()]/g, "");
    employeesQuery = employeesQuery.or(`first_name.ilike.%${safeQ}%,last_name.ilike.%${safeQ}%`);
  }

  const [{ data: country }, { data: employees }, { data: holiday }] = await Promise.all([
    supabase.from("countries").select("week_start_day, working_weekdays").eq("code", company.country_code).single(),
    employeesQuery,
    supabase.from("public_holidays").select("name").eq("country_code", company.country_code).eq("holiday_date", workDate).maybeSingle(),
  ]);

  const employeeIds = (employees ?? []).map((e) => e.id);
  const { data: existing } =
    employeeIds.length > 0
      ? await supabase
          .from("attendance_records")
          .select("employee_id, status, work_mode, hours_worked")
          .eq("work_date", workDate)
          .in("employee_id", employeeIds)
      : { data: [] as never[] };
  const existingByEmployee = new Map((existing ?? []).map((r) => [r.employee_id, r]));

  const weekStartDay = country?.week_start_day ?? 1;
  const isHolidayDate = !!holiday;
  // Prefers working_weekdays (AE/SA/PL's resolved schedule) over the
  // week_start_day-derived contiguous work week, same precedence
  // record_attendance_and_recovery() uses server-side — otherwise this
  // register would keep showing the legacy UAE Fri/Sat weekend even after
  // the migration resolves it to Sat/Sun.
  const isRecoveryDay = isHolidayDate || isWeekend(workDate, weekStartDay, country?.working_weekdays);

  // A day with no saved row is genuinely unrecorded — never preselected as
  // Present (or as a synthetic "holiday"/"weekend" status) just because
  // it's the weekend or a public holiday. The server enforces this too
  // (attendance_records.status defaults to 'not_recorded'); this is only
  // what the register shows before anyone has saved anything for the day.
  const rows = (employees ?? []).map((e) => {
    const rec = existingByEmployee.get(e.id);
    return {
      employeeId: e.id,
      name: `${e.first_name} ${e.last_name}`,
      status: rec?.status ?? "not_recorded",
      workMode: rec?.work_mode ?? null,
      hoursWorked: rec?.hours_worked ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Attendance</h1>
        <p className="text-muted-foreground">Fill in everyone&apos;s attendance for a day in one go.</p>
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
            <div className="space-y-1.5">
              <Label htmlFor="q">Search name</Label>
              <Input id="q" name="q" placeholder="Employee name" defaultValue={q} />
            </div>
            <Button type="submit" variant="outline">
              Load
            </Button>
          </form>
        </CardContent>
      </Card>

      {isRecoveryDay ? (
        <Alert>
          {isHolidayDate ? `${holiday?.name ?? "Public holiday"} — ` : "Weekend — "}
          anyone marked present today may earn a recovery (comp) day, per your country&apos;s policy.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {company.legal_name} — {workDate}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length > 0 ? (
            <BulkAttendanceForm workDate={workDate} rows={rows} isRecoveryDay={isRecoveryDay} />
          ) : (
            <p className="text-muted-foreground">
              {q ? "No active employees match that search." : "No active employees in this company yet."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
