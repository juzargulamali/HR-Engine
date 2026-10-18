import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

import { getCompanySnapshot } from "./dashboard-data";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

/**
 * A tiny in-memory stand-in for the Supabase query builder, enough for getCompanySnapshot: select/eq/in/is filters, maybeSingle and
 * head-count. It filters for real, so a wrong date, country or employee list gives a different answer, which is what these tests need.
 */
function fakeClient(tables: Tables) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let head = false;
      const b: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => { head = !!opts?.head; return b; },
        eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return b; },
        in: (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return b; },
        is: (col: string, v: unknown) => { rows = rows.filter((r) => (v === null ? r[col] == null : r[col] === v)); return b; },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res(head ? { count: rows.length, data: null, error: null } : { data: rows, error: null }),
      };
      return b;
    },
  } as never;
}

const COUNTRIES: Row[] = [
  { code: "AE", week_start_day: 0, working_weekdays: [1, 2, 3, 4, 5] },
  { code: "SA", week_start_day: 0, working_weekdays: [0, 1, 2, 3, 4] },
  { code: "PL", week_start_day: 1, working_weekdays: [1, 2, 3, 4, 5] },
];
const emp = (id: string, country: string): Row => ({ id, first_name: id, last_name: "T", country_code: country, company_id: "c1", employment_status: "active", deleted_at: null });
const company = { id: "c1", legal_name: "Test Co", country_code: "AE" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("getCompanySnapshot: attendance on rest days and holidays, per employee's own country", () => {
  it("a scheduled workday: people with no record are counted as scheduled, not as rest-day", async () => {
    vi.setSystemTime(new Date("2026-10-15T08:00:00Z")); // Thursday everywhere
    const s = await getCompanySnapshot(fakeClient({ employees: [emp("a", "AE"), emp("b", "AE")], countries: COUNTRIES, attendance_records: [{ employee_id: "a", work_date: "2026-10-15", status: "present" }] }), company);
    expect(s).toMatchObject({ presentCount: 1, notRecordedCount: 1, notRecordedScheduledCount: 1, notRecordedRestCount: 0, notRecordedUnknownCount: 0, restDayLabel: null });
  });

  it("a weekly rest day (Sunday in the UAE workweek): no record is not a scheduled gap, and the total is unchanged", async () => {
    vi.setSystemTime(new Date("2026-10-18T08:00:00Z")); // Sunday
    const s = await getCompanySnapshot(fakeClient({ employees: [emp("a", "AE"), emp("b", "AE"), emp("c", "AE")], countries: COUNTRIES }), company);
    expect(s).toMatchObject({ totalEmployees: 3, notRecordedCount: 3, notRecordedScheduledCount: 0, notRecordedRestCount: 3, restDayLabel: "Weekly rest day" });
  });

  it("someone who worked on a rest day still shows as present", async () => {
    vi.setSystemTime(new Date("2026-10-18T08:00:00Z"));
    const s = await getCompanySnapshot(fakeClient({ employees: [emp("a", "AE"), emp("b", "AE")], countries: COUNTRIES, attendance_records: [{ employee_id: "a", work_date: "2026-10-18", status: "present" }] }), company);
    expect(s).toMatchObject({ presentCount: 1, notRecordedCount: 1, notRecordedRestCount: 1, notRecordedScheduledCount: 0 });
  });

  it("a public holiday of the employee's own country is named", async () => {
    vi.setSystemTime(new Date("2026-10-15T08:00:00Z"));
    const s = await getCompanySnapshot(fakeClient({ employees: [emp("a", "AE")], countries: COUNTRIES, public_holidays: [{ country_code: "AE", holiday_date: "2026-10-15", name: "Test Day" }] }), company);
    expect(s).toMatchObject({ notRecordedRestCount: 1, notRecordedScheduledCount: 0, restDayLabel: "Public holiday: Test Day" });
  });

  it("uses each employee's own workweek: Sunday is a rest day for a UAE employee and a workday for a Saudi one", async () => {
    vi.setSystemTime(new Date("2026-10-18T08:00:00Z"));
    const s = await getCompanySnapshot(fakeClient({ employees: [emp("uae", "AE"), emp("ksa", "SA")], countries: COUNTRIES }), company);
    expect(s).toMatchObject({ notRecordedRestCount: 1, notRecordedScheduledCount: 1, restDayLabel: "Rest day or holiday for some employees" });
  });

  it("uses each employee's own local date, not one date for the company or the viewer", async () => {
    // 21:30 UTC on Fri 16 Oct: already Sat 17 Oct 01:30 in Dubai, still Fri 16 Oct 23:30 in Warsaw.
    vi.setSystemTime(new Date("2026-10-16T21:30:00Z"));
    const s = await getCompanySnapshot(
      fakeClient({
        employees: [emp("dubai", "AE"), emp("warsaw", "PL")],
        countries: COUNTRIES,
        attendance_records: [
          { employee_id: "dubai", work_date: "2026-10-17", status: "present" }, // recorded on the Dubai local date
          { employee_id: "warsaw", work_date: "2026-10-17", status: "present" }, // a Warsaw row dated the 17th is NOT today's for Warsaw
        ],
      }),
      company,
    );
    expect(s.presentCount).toBe(1); // Warsaw's "today" is the 16th, so that row is not counted
    expect(s).toMatchObject({ notRecordedScheduledCount: 1, notRecordedRestCount: 0 }); // Warsaw: Friday workday with no record
  });

  it("does not guess when a country's workweek is unavailable: neutral 'not classified', never a scheduled gap", async () => {
    vi.setSystemTime(new Date("2026-10-18T08:00:00Z"));
    const s = await getCompanySnapshot(fakeClient({ employees: [emp("a", "AE")], countries: [] }), company);
    expect(s).toMatchObject({ notRecordedCount: 1, notRecordedUnknownCount: 1, notRecordedScheduledCount: 0, notRecordedRestCount: 0, restDayLabel: null });
  });

  it("leave and absent keep their own counts and never turn into 'present'", async () => {
    vi.setSystemTime(new Date("2026-10-15T08:00:00Z"));
    const s = await getCompanySnapshot(
      fakeClient({ employees: [emp("a", "AE"), emp("b", "AE"), emp("c", "AE")], countries: COUNTRIES, attendance_records: [{ employee_id: "a", work_date: "2026-10-15", status: "leave" }, { employee_id: "b", work_date: "2026-10-15", status: "absent" }] }),
      company,
    );
    expect(s).toMatchObject({ presentCount: 0, leaveCount: 1, absentCount: 1, notRecordedCount: 1 });
  });
});
