import "server-only";
import { isWeekend } from "@enginious-hr/domain";
import type { createClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/log";

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
  /** Set when this company's own data couldn't be loaded — every count
   * above is 0 in that case, and the UI must show that as "couldn't load",
   * never silently render it as a real, empty company. */
  error?: boolean;
}

function emptySnapshot(company: { id: string; legal_name: string; country_code: string }, error?: boolean): CompanySnapshot {
  return {
    companyId: company.id,
    companyName: company.legal_name,
    countryCode: company.country_code,
    employees: [],
    totalEmployees: 0,
    presentCount: 0,
    leaveCount: 0,
    absentCount: 0,
    notRecordedCount: 0,
    pendingLeaveApprovals: 0,
    isRecoveryDay: false,
    holidayName: null,
    error,
  };
}

/**
 * Exactly the query set the old per-company dashboard card
 * (company-overview-section.tsx) ran — refactored into a plain data
 * function so a single comparison table can compute every company's row in
 * parallel instead of duplicating this logic per rendered card. No query
 * added or removed; only the presentation changed.
 *
 * Wrapped in its own try/catch so one company's data failing (a rate
 * limit, a transient connection error, an unexpected schema mismatch)
 * degrades to an explicit error state for that one row instead of
 * throwing and taking down the whole dashboard — every other company (and
 * every other section of the page) still renders normally.
 */
export async function getCompanySnapshot(
  supabase: SupabaseServerClient,
  company: { id: string; legal_name: string; country_code: string },
  today: string,
): Promise<CompanySnapshot> {
  try {
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("company_id", company.id)
      .eq("employment_status", "active")
      .is("deleted_at", null);
    if (employeesError) throw employeesError;

    const employeeList = employees ?? [];
    const employeeIds = employeeList.map((e) => e.id);
    const totalEmployees = employeeIds.length;

    const [attendanceResult, leaveApprovalsResult, holidayResult, countryResult] = await Promise.all([
      employeeIds.length > 0
        ? supabase.from("attendance_records").select("status").eq("work_date", today).in("employee_id", employeeIds)
        : Promise.resolve({ data: [] as { status: string }[], error: null }),
      employeeIds.length > 0
        ? supabase
            .from("leave_requests")
            .select("id", { count: "exact", head: true })
            .in("employee_id", employeeIds)
            .in("status", ["submitted", "pending_approval"])
        : Promise.resolve({ count: 0, error: null }),
      supabase.from("public_holidays").select("name").eq("country_code", company.country_code).eq("holiday_date", today).maybeSingle(),
      supabase.from("countries").select("week_start_day").eq("code", company.country_code).single(),
    ]);

    // countryResult intentionally not checked for `.error` here — a
    // missing/duplicate country row (.single() on 0 or >1 rows) is a data
    // issue this snapshot already tolerates via `country?.week_start_day
    // ?? 1` below, not a reason to drop the whole company's numbers.
    if (attendanceResult.error) throw attendanceResult.error;
    if (leaveApprovalsResult.error) throw leaveApprovalsResult.error;

    const attendance = attendanceResult.data ?? [];
    const presentCount = attendance.filter((a) => a.status === "present").length;
    const leaveCount = attendance.filter((a) => a.status === "leave").length;
    const absentCount = attendance.filter((a) => a.status === "absent").length;
    const notRecordedCount = Math.max(0, totalEmployees - attendance.length);
    const isRecoveryDay = !!holidayResult.data || isWeekend(today, countryResult.data?.week_start_day ?? 1);

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
      pendingLeaveApprovals: leaveApprovalsResult.count ?? 0,
      isRecoveryDay,
      holidayName: holidayResult.data?.name ?? null,
    };
  } catch (error) {
    logServerError({ route: "/", operation: `getCompanySnapshot(${company.id})` }, error);
    return emptySnapshot(company, true);
  }
}
