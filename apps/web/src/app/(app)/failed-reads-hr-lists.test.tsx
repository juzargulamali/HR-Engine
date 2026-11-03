/**
 * @vitest-environment jsdom
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

/**
 * Remaining A4b screens: the employee profile tabs (all but Leave), payroll, performance and timesheets. With the read failing each says it could
 * not load and never prints its own "nothing here" wording; with the read succeeding and genuinely empty it still says so; what loaded stays visible
 * and a form that depends on the failed read is withheld rather than shown with blanks.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(), notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/actions/assets");
vi.mock("@/lib/actions/attendance");
vi.mock("@/lib/actions/companies");
vi.mock("@/lib/actions/employees");
vi.mock("@/lib/actions/payroll");
vi.mock("@/lib/actions/performance");
vi.mock("@/lib/actions/polandTermination");
vi.mock("@/lib/actions/timesheets");

const down = failing();
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const base = fakeSupabase(tables, rpcs);
    return { ...base, from: (t: string) => (tables[t] === undefined ? base.from("__down__") : base.from(t)) };
  },
}));
let session: Record<string, unknown> = {};
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => session }));

beforeEach(() => {
  tables = { __down__: down };
  rpcs = {};
  session = { userId: "u1", employeeId: "e1", email: "hana@example.com", fullName: "Hana", grants: [{ role: "hr_admin", companyId: "c1", countryCode: null }, { role: "ceo", companyId: "c1", countryCode: null }] };
});

/** Awaits every async server component in the tree (a page that nests another async section), leaving client components alone. */
async function settle(node: unknown): Promise<unknown> {
  if (Array.isArray(node)) return Promise.all(node.map(settle));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: unknown }>;
  if (typeof el.type === "function" && el.type.constructor.name === "AsyncFunction") {
    return settle(await (el.type as (p: unknown) => Promise<unknown>)(el.props));
  }
  if (el.props.children === undefined) return el;
  return cloneElement(el, undefined, ...([await settle(el.props.children)].flat() as ReactNode[]));
}
const rendered = async (node: Promise<unknown> | unknown) => renderToStaticMarkup((await settle(await node)) as never);

describe("Employee profile tabs", () => {
  it("Employment: contract history and promotions each say could not load; the add-version form is withheld", async () => {
    const { EmploymentSection } = await import("./employees/[id]/employment-section");
    const html = await rendered(EmploymentSection({ employeeId: "e9", canSeeContracts: true, canEditContracts: true, canSeeCareerEvents: true, canRecordCareer: true }));
    expect(html).toContain("Could not load the contract history");
    expect(html).toContain("Could not load the promotions and salary history");
    expect(html).not.toContain("No contract on record yet");
    expect(html).not.toContain("No promotions, title changes");
    expect(html).not.toContain("Supersede with new version");
    expect(html).not.toContain("<form");
  });
  it("Employment: genuinely empty still says so, and the add-version form is offered", async () => {
    tables = { employment_contracts: rows([]), employee_career_events: rows([]), employees: row({ job_title: "Rigger" }), compensation_details: row(null) };
    const { EmploymentSection } = await import("./employees/[id]/employment-section");
    const html = await rendered(EmploymentSection({ employeeId: "e9", canSeeContracts: true, canEditContracts: true, canSeeCareerEvents: true, canRecordCareer: false }));
    expect(html).toContain("No contract on record yet");
    expect(html).toContain("Supersede with new version");
    expect(html).not.toContain("Could not load");
  });
  it("Career history: the history loads but the current title/salary does not, so the record form is withheld", async () => {
    tables = { employee_career_events: rows([{ id: "ev1", event_type: "promotion", effective_date: "2026-01-01", previous_job_title: "A", new_job_title: "B", previous_base_salary: null, new_base_salary: null, currency: "AED", note: null }]), __down__: down };
    const { CareerHistorySection } = await import("./employees/[id]/career-history-section");
    const html = await rendered(CareerHistorySection({ employeeId: "e9", canView: true, canRecord: true }));
    expect(html).toContain("Promotion");
    expect(html).toContain("Could not load the current title and salary");
    expect(html).not.toContain("Could not load the promotions");
  });
  it("Compensation: not 'No compensation on record yet', and no change form", async () => {
    const { CompensationSection } = await import("./employees/[id]/compensation-section");
    const html = await rendered(CompensationSection({ employeeId: "e9", canEdit: true, isSelf: false }));
    expect(html).toContain("Could not load the compensation");
    expect(html).not.toContain("No compensation on record yet");
  });
  it("Final settlement: any unreadable input means no figure at all", async () => {
    tables = { compensation_details: row({ base_salary: "3000", currency: "AED" }), leave_balances: row({ balance_days: 5 }), reimbursement_claims: rows([]), employee_loans: failing() };
    rpcs = { resolve_policy: row(null) };
    const { FinalSettlementSection } = await import("./employees/[id]/final-settlement-section");
    const html = await rendered(FinalSettlementSection({ employeeId: "e9", countryCode: "AE", hireDate: "2020-01-01", terminationDate: "2026-10-01" }));
    expect(html).toContain("Could not load the final settlement inputs");
    expect(html).not.toContain("Total settlement");
  });
  it("Final settlement: healthy inputs still compute", async () => {
    tables = { compensation_details: row({ base_salary: "3000", currency: "AED" }), leave_balances: row({ balance_days: 5 }), reimbursement_claims: rows([]), employee_loans: rows([]) };
    rpcs = { resolve_policy: row(null) };
    const { FinalSettlementSection } = await import("./employees/[id]/final-settlement-section");
    const html = await rendered(FinalSettlementSection({ employeeId: "e9", countryCode: "AE", hireDate: "2020-01-01", terminationDate: "2026-10-01" }));
    expect(html).toContain("Total settlement");
    expect(html).not.toContain("Could not load");
  });
  it("Overview: unreadable linked login / managers is reported and the edit form is withheld (a blank would otherwise unlink or clear the manager)", async () => {
    tables = { __down__: down, profiles: failing(), employees: failing() };
    const { OverviewSection } = await import("./employees/[id]/overview-section");
    const employee = { id: "e9", first_name: "Ola", last_name: "Z", job_title: "Rigger", employment_status: "active", manager_id: "m1", user_id: "u9", company_id: "c1", hire_date: "2020-01-01", date_of_birth: null, personal_email: null, phone: null, country_code: "AE", recognised_prior_service_years: 0, is_first_ever_employment: false, termination_date: null };
    const html = await rendered(OverviewSection({ employee: employee as never, canEditCore: true, isSelf: false }));
    expect(html).toContain("Could not load the linked login");
    expect(html).toContain("the list of possible managers");
    expect(html).not.toContain("Linked login</p>");
    expect(html).not.toContain("Save profile");
  });
  it("Attendance", async () => {
    const { AttendanceSection } = await import("./employees/[id]/attendance-section");
    const html = await rendered(AttendanceSection({ employeeId: "e9", canManage: true }));
    expect(html).toContain("Could not load the attendance records");
    expect(html).not.toContain("No attendance recorded yet");
  });
  it("Documents, identity documents, insurance and loans keep their add forms but never say 'none on file'", async () => {
    const [{ EmployeeDocumentsSection }, { IdentityDocumentsSection }, { InsuranceSection }, { LoansSection }] = await Promise.all([
      import("./employees/[id]/employee-documents-section"), import("./employees/[id]/identity-documents-section"),
      import("./employees/[id]/insurance-section"), import("./employees/[id]/loans-section"),
    ]);
    const docs = await rendered(EmployeeDocumentsSection({ employeeId: "e9", canEdit: true }));
    expect(docs).toContain("Could not load the documents");
    expect(docs).not.toContain("No documents on file");
    const ids = await rendered(IdentityDocumentsSection({ employeeId: "e9", canEdit: true }));
    expect(ids).toContain("Could not load the identity documents");
    expect(ids).not.toContain("No identity documents on file");
    const ins = await rendered(InsuranceSection({ employeeId: "e9", canEdit: true }));
    expect(ins).toContain("Could not load the insurance policies");
    expect(ins).not.toContain("No insurance policies on file");
    const loans = await rendered(LoansSection({ employeeId: "e9", canEdit: true, defaultCurrency: "AED" }));
    expect(loans).toContain("Could not load the loans and cash advances");
    expect(loans).not.toContain("No loans or cash advances on record");
  });
  it("Assets: unreadable asset names are not shown as an unknown asset", async () => {
    tables = { asset_assignments: rows([{ id: "a1", asset_id: "x1", issued_date: "2026-01-01", returned_date: null }]), assets: failing() };
    const { AssetsSection } = await import("./employees/[id]/assets-section");
    const html = await rendered(AssetsSection({ employeeId: "e9", companyId: "c1", canManage: true }));
    expect(html).toContain("Could not load the asset tags and categories");
    expect(html).toContain("Could not load the in-stock assets available to assign");
    expect(html).not.toContain("No in-stock assets available");
    expect(html).not.toContain("No assets assigned");
  });
  it("Assets: assignments unreadable", async () => {
    const { AssetsSection } = await import("./employees/[id]/assets-section");
    const html = await rendered(AssetsSection({ employeeId: "e9", companyId: "c1", canManage: false }));
    expect(html).toContain("Could not load the assigned assets");
    expect(html).not.toContain("No assets assigned");
  });
  it("Performance tab: goals and appraisals say could not load; appraisal start is withheld", async () => {
    const { PerformanceSection } = await import("./employees/[id]/performance-section");
    const html = await rendered(PerformanceSection({ employeeId: "e9", companyId: "c1", canManage: true }));
    expect(html).toContain("Could not load the goals");
    expect(html).toContain("Could not load the appraisals");
    expect(html).not.toContain("No goals yet");
    expect(html).not.toContain("No appraisals yet");
  });
  it("Performance tab: loaded goals stay visible when only the cycle names fail", async () => {
    tables = { goals: rows([{ id: "g1", cycle_id: "cy1", title: "Ship the rig", status: "in_progress", self_rating: null, manager_rating: null }]), appraisals: rows([]), performance_cycles: failing() };
    const { PerformanceSection } = await import("./employees/[id]/performance-section");
    const html = await rendered(PerformanceSection({ employeeId: "e9", companyId: "c1", canManage: false }));
    expect(html).toContain("Ship the rig");
    expect(html).toContain("Could not load the cycle names");
    expect(html).toContain("Could not load</td>");
  });
});

describe("Payroll, performance and timesheets", () => {
  it("Payroll: a failed employee read is not 'restricted to HR Admin...'", async () => {
    const { default: Page } = await import("./payroll/page");
    const html = await rendered(Page());
    expect(html).toContain("Could not load your employee record");
    expect(html).not.toContain("restricted to HR Admin");
  });
  it("Payroll: a failed account read is not 'restricted'", async () => {
    session = { ...session, loadFailed: true, grants: [] };
    const { default: Page } = await import("./payroll/page");
    const html = await rendered(Page());
    expect(html).toContain("Could not load your account");
    expect(html).not.toContain("restricted to HR Admin");
  });
  it("Payroll: runs failing says so; genuinely none says none; a real refusal still refuses", async () => {
    tables = { employees: row({ company_id: "c1" }), payroll_export_runs: failing() };
    const { default: Page } = await import("./payroll/page");
    let html = await rendered(Page());
    expect(html).toContain("Could not load the export runs");
    expect(html).not.toContain("No export runs yet");
    tables = { employees: row({ company_id: "c1" }), payroll_export_runs: rows([]) };
    html = await rendered(Page());
    expect(html).toContain("No export runs yet");
    session = { ...session, grants: [] };
    html = await rendered(Page());
    expect(html).toContain("restricted to HR Admin");
  });
  it("Payroll run: a failed read is not a 404 and the lines are not 'No lines yet' / a zero total", async () => {
    const { default: Page } = await import("./payroll/[id]/page");
    let html = await rendered(Page({ params: Promise.resolve({ id: "r1" }) }));
    expect(html).toContain("Could not load this payroll run");
    tables = { payroll_export_runs: row({ id: "r1", company_id: "c1", period_month: 10, period_year: 2026, status: "draft", authorized_by: null, authorized_at: null, sent_at: null }), payroll_export_lines: failing(), employees: failing(), companies: failing() };
    html = await rendered(Page({ params: Promise.resolve({ id: "r1" }) }));
    expect(html).toContain("Could not load the payroll lines");
    expect(html).not.toContain("No lines yet");
    expect(html).not.toContain("Grand total");
    expect(html).not.toContain("Add manual line</");
  });
  it("Performance: each list says could not load; the new-goal form is withheld when cycles fail", async () => {
    tables = { employees: row({ company_id: "c1" }) };
    const { default: Page } = await import("./performance/page");
    tables = { ...tables, performance_cycles: failing(), goals: failing(), appraisals: failing() };
    const html = await rendered(Page());
    expect(html).toContain("Could not load your goals");
    expect(html).toContain("Could not load your appraisals");
    expect(html).toContain("Could not load the performance cycles");
    expect(html).not.toContain("No goals yet");
    expect(html).not.toContain("No appraisals yet");
  });
  it("Performance: a failed employee read says so", async () => {
    const { default: Page } = await import("./performance/page");
    expect(await rendered(Page())).toContain("Could not load your employee record");
  });
  it("Performance: genuinely empty still says so", async () => {
    tables = { employees: row({ company_id: "c1" }), performance_cycles: rows([]), goals: rows([]), appraisals: rows([]) };
    const { default: Page } = await import("./performance/page");
    const html = await rendered(Page());
    expect(html).toContain("No goals yet");
    expect(html).not.toContain("Could not load");
  });
  it("Performance cycles list", async () => {
    tables = { companies: rows([{ id: "c1", legal_name: "Enginious" }]), performance_cycles: failing() };
    const { default: Page } = await import("./performance/cycles/page");
    const html = await rendered(Page());
    expect(html).toContain("Could not load the cycles");
    expect(html).not.toContain("No cycles yet");
  });
  it("Timesheets: list failing is not 'No timesheets yet'", async () => {
    const { default: Page } = await import("./timesheets/page");
    const html = await rendered(Page());
    expect(html).toContain("Could not load your timesheets");
    expect(html).not.toContain("No timesheets yet");
  });
  it("Timesheets: hours failing is not zero hours", async () => {
    tables = { timesheets: rows([{ id: "t1", period_start: "2026-10-01", period_end: "2026-10-07", status: "draft" }]), timesheet_entries: failing() };
    const { default: Page } = await import("./timesheets/page");
    const html = await rendered(Page());
    expect(html).toContain("2026-10-01");
    expect(html).toContain("Could not load the hours");
    expect(html).toContain("Could not load</td>");
  });
  it("Timesheet detail: failed read is not a 404; failed entries are not an empty timesheet", async () => {
    const { default: Page } = await import("./timesheets/[id]/page");
    expect(await rendered(Page({ params: Promise.resolve({ id: "t1" }) }))).toContain("Could not load this timesheet");
    tables = { timesheets: row({ id: "t1", employee_id: "e1", period_start: "2026-10-01", period_end: "2026-10-07", status: "draft" }), timesheet_entries: failing(), employees: row({ company_id: "c1" }), projects: rows([]) };
    const html = await rendered(Page({ params: Promise.resolve({ id: "t1" }) }));
    expect(html).toContain("Could not load the entries");
    expect(html).toContain("Hours could not be loaded");
    expect(html).not.toContain("No entries yet");
    expect(html).not.toContain("0 hours logged");
  });
  it("Appraisal detail: a failed read is not a 404", async () => {
    const { default: Page } = await import("./performance/appraisals/[id]/page");
    expect(await rendered(Page({ params: Promise.resolve({ id: "a1" }) }))).toContain("Could not load this appraisal");
  });
});
