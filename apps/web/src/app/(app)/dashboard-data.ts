import "server-only";
import { classifyScheduledDay, getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
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
  /** Employees with no recorded status for their own local date (same number as before; the three counts below split it). */
  notRecordedCount: number;
  /** ...of whom this many were scheduled to work (a scheduled day of their own country's workweek, not a public holiday). */
  notRecordedScheduledCount: number;
  /** ...and this many were on their country's weekly rest day or a public holiday, so no attendance was expected. */
  notRecordedRestCount: number;
  /** ...and this many could not be classified (no workweek data for their country): described neutrally, never as a failure. */
  notRecordedUnknownCount: number;
  leaveRequestsAwaitingDecision: number;
  /**
   * Short plain label when some or all of this company's employees are on a weekly rest day or public holiday TODAY in their own
   * country ("Weekly rest day", "Public holiday: National Day", or "Rest day or holiday for some employees" when the company
   * spans calendars), else null. Per employee, using the employee's own country, local date and holiday calendar.
   */
  restDayLabel: string | null;
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
    notRecordedScheduledCount: 0,
    notRecordedRestCount: 0,
    notRecordedUnknownCount: 0,
    leaveRequestsAwaitingDecision: 0,
    restDayLabel: null,
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
): Promise<CompanySnapshot> {
  try {
    const { data: employees, error: employeesError } = await supabase
      .from("employees")
      .select("id, first_name, last_name, country_code")
      .eq("company_id", company.id)
      .eq("employment_status", "active")
      .is("deleted_at", null);
    if (employeesError) throw employeesError;

    const employeeList = employees ?? [];
    const totalEmployees = employeeList.length;

    // Each employee is judged against THEIR OWN country: their local date, their country's workweek and their country's public
    // holidays (an employee's country can differ from the company's), never the viewer's browser or one calendar for the company.
    const byCountry = new Map<string, string[]>();
    for (const e of employeeList) {
      const cc = e.country_code ?? company.country_code;
      byCountry.set(cc, [...(byCountry.get(cc) ?? []), e.id]);
    }
    const groups = [...byCountry.entries()].map(([countryCode, ids]) => ({
      countryCode,
      ids,
      date: getBusinessDateString(resolveCountryTimeZone(countryCode)),
    }));

    const [countriesResult, leaveApprovalsResult, perGroup] = await Promise.all([
      groups.length > 0
        ? supabase.from("countries").select("code, week_start_day, working_weekdays").in("code", groups.map((g) => g.countryCode))
        : Promise.resolve({ data: [] as { code: string; week_start_day: number; working_weekdays: number[] | null }[], error: null }),
      totalEmployees > 0
        ? supabase
            .from("leave_requests")
            .select("id", { count: "exact", head: true })
            .in(
              "employee_id",
              employeeList.map((e) => e.id),
            )
            .in("status", ["submitted", "pending_approval"])
        : Promise.resolve({ count: 0, error: null }),
      Promise.all(
        groups.map(async (g) => {
          const [attendance, holiday] = await Promise.all([
            supabase.from("attendance_records").select("employee_id, status").eq("work_date", g.date).in("employee_id", g.ids),
            supabase.from("public_holidays").select("name").eq("country_code", g.countryCode).eq("holiday_date", g.date).maybeSingle(),
          ]);
          return { g, attendance, holiday };
        }),
      ),
    ]);

    // A missing/unreadable countries row is a data issue this snapshot tolerates: those employees are described neutrally
    // ("day type not known"), not dropped and not guessed at.
    if (leaveApprovalsResult.error) throw leaveApprovalsResult.error;
    const workweekBy = new Map((countriesResult.data ?? []).map((c) => [c.code, { weekStartDay: c.week_start_day, workingWeekdays: c.working_weekdays }]));

    let presentCount = 0;
    let leaveCount = 0;
    let absentCount = 0;
    let notRecordedScheduledCount = 0;
    let notRecordedRestCount = 0;
    let notRecordedUnknownCount = 0;
    let restEmployees = 0;
    const restLabels = new Set<string>();

    for (const { g, attendance, holiday } of perGroup) {
      if (attendance.error) throw attendance.error;
      const rows = attendance.data ?? [];
      // partial_day counts alongside present for this summary — both mean "showed up that day" for headcount purposes; the
      // daily register itself still distinguishes them. Anyone who actually has a recorded status keeps it on a weekend or
      // holiday too: this never hides attendance that happened.
      presentCount += rows.filter((a) => a.status === "present" || a.status === "partial_day").length;
      leaveCount += rows.filter((a) => a.status === "leave").length;
      absentCount += rows.filter((a) => a.status === "absent").length;
      // A day with no saved row at all, AND a day explicitly saved as 'not_recorded', both mean nobody said what happened.
      const recorded = rows.filter((a) => a.status !== "not_recorded").length;
      const missing = Math.max(0, g.ids.length - recorded);

      const day = classifyScheduledDay({ date: g.date, workweek: workweekBy.get(g.countryCode) ?? null, holidayName: holiday.data?.name ?? null });
      if (day.kind === "workday") notRecordedScheduledCount += missing;
      else if (day.kind === "unknown") notRecordedUnknownCount += missing;
      else notRecordedRestCount += missing;
      if (day.kind === "weekly_rest" || day.kind === "public_holiday") {
        restEmployees += g.ids.length;
        restLabels.add(day.kind === "public_holiday" ? (day.holidayName ? `Public holiday: ${day.holidayName}` : "Public holiday") : "Weekly rest day");
      }
    }

    const restDayLabel =
      restEmployees === 0 ? null : restEmployees < totalEmployees || restLabels.size > 1 ? "Rest day or holiday for some employees" : [...restLabels][0]!;

    return {
      companyId: company.id,
      companyName: company.legal_name,
      countryCode: company.country_code,
      employees: employeeList,
      totalEmployees,
      presentCount,
      leaveCount,
      absentCount,
      notRecordedCount: notRecordedScheduledCount + notRecordedRestCount + notRecordedUnknownCount,
      notRecordedScheduledCount,
      notRecordedRestCount,
      notRecordedUnknownCount,
      leaveRequestsAwaitingDecision: leaveApprovalsResult.count ?? 0,
      restDayLabel,
    };
  } catch (error) {
    logServerError({ route: "/", operation: `getCompanySnapshot(${company.id})` }, error);
    return emptySnapshot(company, true);
  }
}
