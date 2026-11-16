/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/alerts", useSearchParams: () => new URLSearchParams(), redirect: vi.fn() }));
vi.mock("./acknowledge-item-form", () => ({ AcknowledgeItemForm: ({ kind }: { kind: string }) => <span data-testid="ack-form">{kind}</span> }));
vi.mock("@/components/workspace/list-memory", () => ({ RememberList: () => null }));
vi.mock("@/components/workspace/list-toolbar", () => ({ ListToolbar: () => null }));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables, rpcs) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Hana", grants }) }));

import AlertsPage from "./page";

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await AlertsPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  grants = [{ role: "hr_admin", companyId: "c1", countryCode: null }];
  tables = {
    employees: rows([
      { id: "e2", first_name: "Omar", last_name: "Ali", company_id: "c1", country_code: "AE" },
      { id: "e3", first_name: "Lena", last_name: "Nowak", company_id: "c2", country_code: "PL" },
    ]),
    companies: rows([{ id: "c1", legal_name: "Aurora Trading" }, { id: "c2", legal_name: "Birch Works" }]),
    employment_contracts: rows([]), employee_documents: rows([]), identity_documents: rows([]), attendance_records: rows([]), recovery_windows: rows([]),
    recovery_alerts: rows([]), hr_queue_acknowledgements: rows([]), ai_drafts: rows([]),
  };
  rpcs = { recovery_scheduler_status: { data: { stale: false, open_failures: 0, windows_policy_active: false, scheduler_ready: { ready: true, reasons: [] } }, error: null } };
});

describe("Alerts page: the HR work queue", () => {
  it("a successful read with nothing due says so", async () => {
    expect(await render()).toContain("Nothing needs attention right now.");
  });

  it("a failed read is an error that names the part, never 'Nothing needs attention'", async () => {
    tables = { ...tables, employment_contracts: failing() };
    const html = await render();
    expect(html).toContain("Could not load part of the alerts (contracts)");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Nothing needs attention right now.");
  });

  it("a failed Recovery Leave alerts read and a failed attendance read are named too", async () => {
    tables = { ...tables, recovery_alerts: failing(), attendance_records: failing() };
    const html = await render();
    expect(html).toContain("attendance exceptions");
    expect(html).toContain("recovery alerts");
  });

  it("groups items into Needs action, Due soon and Acknowledged, each with employee, company, issue, date, who acts next and one direct action", async () => {
    tables = {
      ...tables,
      employee_documents: rows([{ id: "d1", employee_id: "e2", document_type: "visa", expiry_date: day(-3) }]),
      employment_contracts: rows([{ id: "k1", employee_id: "e2", contract_type: "probation", end_date: null, probation_end_date: day(10) }]),
      attendance_records: rows([{ id: "a1", employee_id: "e2", work_date: day(-1) }]),
      hr_queue_acknowledgements: rows([{ kind: "attendance", source_id: "a1", source_date: day(-1), acknowledged_at: new Date().toISOString(), note: "Checking with the line manager" }]),
    };
    const html = await render();
    expect(html).toContain('data-testid="queue-needs_action"');
    expect(html).toContain("Omar Ali");
    expect(html).toContain("Aurora Trading");
    expect(html).toContain("Visa expired");
    expect(html).toContain("3 days ago");
    expect(html).toContain("Acts next: You (HR Admin)");
    // the one direct action opens the shared Add document form for a renewal, with the employee and document already chosen, and knows it came from the queue
    expect(html).toContain("/employees/e2?tab=documents&amp;add=employee%3Avisa&amp;renew=1&amp;docId=d1&amp;from=alerts");
    expect(html).toContain("Probation review is due in 10 days");
    expect(html).toContain('data-testid="queue-due_soon"');
    // an acknowledged item is still listed, still says it is open, and keeps its link to the register on that employee and date
    expect(html).toContain("Manual entry and clock records differ");
    expect(html).toContain("Checking with the line manager");
    expect(html).toContain("Still open until the record is fixed");
    expect(html).toContain(`/attendance?companyId=c1&amp;date=${day(-1)}&amp;filter=needs_review&amp;employee=e2&amp;from=alerts`);
  });

  it("acknowledging controls are offered to HR Admin of that company only; a CEO sees the items and who acts next, with no Mark as seen", async () => {
    tables = { ...tables, employee_documents: rows([{ id: "d1", employee_id: "e2", document_type: "visa", expiry_date: day(-3) }]) };
    expect(await render()).toContain('data-testid="ack-form"');
    grants = [{ role: "ceo", companyId: "c1", countryCode: null }];
    const html = await render();
    expect(html).toContain("Visa expired");
    expect(html).toContain("Acts next: HR Admin of Aurora Trading");
    expect(html).not.toContain('data-testid="ack-form"');
  });

  it("an identity document's number never appears in the queue", async () => {
    tables = { ...tables, identity_documents: rows([{ id: "i1", employee_id: "e2", document_type: "passport", expiry_date: day(-1), document_number: "X1234567" }]) };
    const html = await render();
    expect(html).toContain("Passport expired");
    expect(html).not.toContain("X1234567");
  });

  it("a renewed document (a newer row with a later date) is no longer in the queue", async () => {
    tables = { ...tables, employee_documents: rows([
      { id: "old", employee_id: "e2", document_type: "visa", expiry_date: day(-30) },
      { id: "new", employee_id: "e2", document_type: "visa", expiry_date: day(400) },
    ]) };
    expect(await render()).toContain("Nothing needs attention right now.");
  });

  it("the company filter narrows the queue and the empty state of a filter says so", async () => {
    grants = [{ role: "hr_admin", companyId: "c1", countryCode: null }, { role: "hr_admin", companyId: "c2", countryCode: null }];
    tables = { ...tables, employee_documents: rows([{ id: "d1", employee_id: "e3", document_type: "visa", expiry_date: day(-3) }]) };
    expect(await render({ company: "c2" })).toContain("Lena Nowak");
    const html = await render({ company: "c1" });
    expect(html).not.toContain("Lena Nowak");
    expect(html).toContain("No items match these filters.");
  });

  it("an AI suggestion needing a decision is listed for HR Admin with a link to the existing review screen and none of its content", async () => {
    tables = { ...tables, ai_drafts: rows([{ id: "dr1", entity_type: "leave_ledger", proposed_action: "adjust_balance", created_by_agent: "helper", created_at: new Date().toISOString() }]) };
    const html = await render();
    expect(html).toContain("AI suggestion waiting for a decision: adjust balance on leave ledger");
    expect(html).toContain("/ai-suggestions?from=alerts#draft-dr1");
  });

  it("when the processor is late, one line says alerts may be late and points to Administration (the diagnostics are not here)", async () => {
    rpcs = { recovery_scheduler_status: { data: { stale: true, open_failures: 0, windows_policy_active: true, scheduler_ready: { ready: false, reasons: ["x"] }, database_fingerprint: "abc123" }, error: null } };
    const html = await render();
    expect(html).toContain("Background processing");
    expect(html).not.toContain("abc123");
    expect(html).not.toContain("Database fingerprint");
  });
});
