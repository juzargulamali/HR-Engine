import { canManageAttendance, isWeekend } from "@enginious-hr/domain";
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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  present: "default",
  absent: "destructive",
  leave: "secondary",
  holiday: "outline",
  weekend: "outline",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; companyId?: string }>;
}) {
  const { date, companyId: companyIdParam } = await searchParams;
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
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      No attendance recorded yet.
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

  const workDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayISO();
  const companyId = companyIdParam && manageableCompanies.some((c) => c.id === companyIdParam) ? companyIdParam : manageableCompanies[0]!.id;
  const company = manageableCompanies.find((c) => c.id === companyId)!;

  const [{ data: country }, { data: employees }, { data: holiday }] = await Promise.all([
    supabase.from("countries").select("week_start_day").eq("code", company.country_code).single(),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("company_id", companyId)
      .eq("employment_status", "active")
      .is("deleted_at", null)
      .order("first_name"),
    supabase.from("public_holidays").select("name").eq("country_code", company.country_code).eq("holiday_date", workDate).maybeSingle(),
  ]);

  const employeeIds = (employees ?? []).map((e) => e.id);
  const { data: existing } =
    employeeIds.length > 0
      ? await supabase.from("attendance_records").select("employee_id, status, hours_worked").eq("work_date", workDate).in("employee_id", employeeIds)
      : { data: [] as never[] };
  const existingByEmployee = new Map((existing ?? []).map((r) => [r.employee_id, r]));

  const weekStartDay = country?.week_start_day ?? 1;
  const isHolidayDate = !!holiday;
  const isRecoveryDay = isHolidayDate || isWeekend(workDate, weekStartDay);

  const rows = (employees ?? []).map((e) => {
    const rec = existingByEmployee.get(e.id);
    return {
      employeeId: e.id,
      name: `${e.first_name} ${e.last_name}`,
      status: rec?.status ?? (isRecoveryDay ? (isHolidayDate ? "holiday" : "weekend") : "present"),
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
            <Button type="submit" variant="outline">
              Load
            </Button>
          </form>
        </CardContent>
      </Card>

      {isRecoveryDay ? (
        <Alert>
          {isHolidayDate ? `${holiday?.name ?? "Public holiday"} — ` : "Weekend — "}
          anyone marked present today earns a recovery (comp) day automatically.
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
            <p className="text-muted-foreground">No active employees in this company yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
