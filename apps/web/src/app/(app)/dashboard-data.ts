import "server-only";
import { isWeekend } from "@enginious-hr/domain";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface CompanySnapshot {
  companyId: string;
  companyName: string;
  countryCode: string;
  employees: { id: string; first_name: string; last_name: string }[];
  totalEmployees: number;
  presentCount: number;
  leaveCount: number;
  absentCount: number;
  notRecordedCount: number;
  pendingLeaveApprovals: number;
  isRecoveryDay: boolean;
  holidayName: string | null;
}

/**
 * Exactly the query set the old per-company dashboard card
 * (company-overview-section.tsx) ran — refactored into a plain data
 * function so a single comparison table can compute every company's row in
 * parallel instead of duplicating this logic per rendered card. No query
 * added or removed; only the presentation changed.
 */
export async function getCompanySnapshot(
  supabase: SupabaseServerClient,
  company: { id: string; legal_name: string; country_code: string },
  today: string,
): Promise<CompanySnapshot> {
  const { data: employees } = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .eq("company_id", company.id)
    .eq("employment_status", "active")
    .is("deleted_at", null);
  const employeeList = employees ?? [];
  const employeeIds = employeeList.map((e) => e.id);
  const totalEmployees = employeeIds.length;

  const [{ data: attendance }, { count: pendingLeaveApprovals }, { data: holiday }, { data: country }] = await Promise.all([
    employeeIds.length > 0
      ? supabase.from("attendance_records").select("status").eq("work_date", today).in("employee_id", employeeIds)
      : Promise.resolve({ data: [] as { status: string }[] }),
    employeeIds.length > 0
      ? supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .in("employee_id", employeeIds)
          .in("status", ["submitted", "pending_approval"])
      : Promise.resolve({ count: 0 }),
    supabase.from("public_holidays").select("name").eq("country_code", company.country_code).eq("holiday_date", today).maybeSingle(),
    supabase.from("countries").select("week_start_day").eq("code", company.country_code).single(),
  ]);

  const presentCount = (attendance ?? []).filter((a) => a.status === "present").length;
  const leaveCount = (attendance ?? []).filter((a) => a.status === "leave").length;
  const absentCount = (attendance ?? []).filter((a) => a.status === "absent").length;
  const notRecordedCount = Math.max(0, totalEmployees - (attendance ?? []).length);
  const isRecoveryDay = !!holiday || isWeekend(today, country?.week_start_day ?? 1);

  return {
    companyId: company.id,
    companyName: company.legal_name,
    countryCode: company.country_code,
    employees: employeeList,
    totalEmployees,
    presentCount,
    leaveCount,
    absentCount,
    notRecordedCount,
    pendingLeaveApprovals: pendingLeaveApprovals ?? 0,
    isRecoveryDay,
    holidayName: holiday?.name ?? null,
  };
}
