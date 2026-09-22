import { isWeekend } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-2xl font-semibold">{value}</CardContent>
    </Card>
  );
}

export async function CompanyOverviewSection({
  companyId,
  companyName,
  countryCode,
}: {
  companyId: string;
  companyName: string;
  countryCode: string;
}) {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: employees } = await supabase
    .from("employees")
    .select("id")
    .eq("company_id", companyId)
    .eq("employment_status", "active")
    .is("deleted_at", null);
  const employeeIds = (employees ?? []).map((e) => e.id);
  const totalEmployees = employeeIds.length;

  const [{ data: attendance }, { count: pendingApprovals }, { data: holiday }, { data: country }] = await Promise.all([
    employeeIds.length > 0
      ? supabase.from("attendance_records").select("status").eq("work_date", today).in("employee_id", employeeIds)
      : Promise.resolve({ data: [] as never[] }),
    employeeIds.length > 0
      ? supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .in("employee_id", employeeIds)
          .in("status", ["submitted", "pending_approval"])
      : Promise.resolve({ count: 0 }),
    supabase.from("public_holidays").select("name").eq("country_code", countryCode).eq("holiday_date", today).maybeSingle(),
    supabase.from("countries").select("week_start_day").eq("code", countryCode).single(),
  ]);

  const presentCount = (attendance ?? []).filter((a) => a.status === "present").length;
  const leaveCount = (attendance ?? []).filter((a) => a.status === "leave").length;
  const absentCount = (attendance ?? []).filter((a) => a.status === "absent").length;
  const notRecordedCount = Math.max(0, totalEmployees - (attendance ?? []).length);
  const isRecoveryDay = !!holiday || isWeekend(today, country?.week_start_day ?? 1);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-heading text-sm font-semibold">{companyName}</h3>
        {isRecoveryDay ? <Badge variant="outline">{holiday?.name ?? "Weekend"} today</Badge> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total employees" value={totalEmployees} />
        <StatTile label="Present today" value={presentCount} />
        <StatTile label="On leave today" value={leaveCount} />
        <StatTile label="Absent today" value={absentCount} />
        <StatTile label="Not recorded yet" value={notRecordedCount} />
        <StatTile label="Pending leave requests" value={pendingApprovals ?? 0} />
      </div>
    </div>
  );
}
