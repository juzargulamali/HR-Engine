import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sendMailAsUser = vi.fn();
vi.mock("./graph", () => ({ sendMailAsUser: (...args: unknown[]) => sendMailAsUser(...args) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { notifyAfterLeaveDecision } from "./leave-notifications";

const EMPLOYEE_ID = "emp-1";
const EMPLOYEE_USER = "user-employee";
const MANAGER_USER = "user-manager";

type Rows = Record<string, unknown[]>;

/** Minimal chainable stand-in for the supabase query builder: every table resolves to the rows given for it. */
function fakeSupabase(tables: Rows) {
  const builder = (rows: unknown[]) => {
    const api: Record<string, unknown> = {};
    const chain = () => api;
    for (const m of ["select", "eq", "in", "order", "limit"]) api[m] = chain;
    api.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null });
    api.then = (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: rows });
    return api;
  };
  return { from: (table: string) => builder(tables[table] ?? []) } as never;
}

const baseTables: Rows = {
  leave_requests: [{ status: "approved", start_date: "2099-08-25", end_date: "2099-08-26", employee_id: EMPLOYEE_ID }],
  profiles: [
    { id: EMPLOYEE_USER, email: "hrtest.employee@enginious.ae", full_name: null },
    { id: MANAGER_USER, email: "hrtest.manager@enginious.ae", full_name: null },
  ],
};

describe("leave decision email", () => {
  beforeEach(() => sendMailAsUser.mockReset());

  it("names the recipient, the decider and the recipient address, so shared mailboxes can tell mails apart", async () => {
    const supabase = fakeSupabase({
      ...baseTables,
      employees: [
        { user_id: EMPLOYEE_USER, first_name: "Employee", last_name: "Test" },
        { user_id: MANAGER_USER, first_name: "Manager", last_name: "Test" },
      ],
    });
    await notifyAfterLeaveDecision(supabase, { requestId: "req-1", decidedByUserId: MANAGER_USER });

    expect(sendMailAsUser).toHaveBeenCalledTimes(1);
    const mail = sendMailAsUser.mock.calls[0]![0] as { fromEmail: string; to: string[]; subject: string; html: string };
    expect(mail.to).toEqual(["hrtest.employee@enginious.ae"]);
    expect(mail.subject).toBe("Leave request approved for Employee Test (2099-08-25 to 2099-08-26)");
    expect(mail.html).toContain("Hi Employee Test,");
    expect(mail.html).toContain("<strong>approved</strong> by Manager Test");
    expect(mail.html).toContain("Sent to: Employee Test &lt;hrtest.employee@enginious.ae&gt;");
  });

  it("falls back to the login's name, then the part before the @, when an employee has no usable name", async () => {
    const supabase = fakeSupabase({
      ...baseTables,
      employees: [{ user_id: EMPLOYEE_USER, first_name: "", last_name: "" }],
    });
    await notifyAfterLeaveDecision(supabase, { requestId: "req-1", decidedByUserId: MANAGER_USER });

    const mail = sendMailAsUser.mock.calls[0]![0] as { html: string };
    expect(mail.html).toContain("Hi hrtest.employee,");
    expect(mail.html).toContain("by hrtest.manager");
  });

  it("escapes HTML in names", async () => {
    const supabase = fakeSupabase({
      ...baseTables,
      employees: [{ user_id: EMPLOYEE_USER, first_name: "<b>Eve</b>", last_name: "O'Neil" }],
    });
    await notifyAfterLeaveDecision(supabase, { requestId: "req-1", decidedByUserId: MANAGER_USER });

    const mail = sendMailAsUser.mock.calls[0]![0] as { html: string };
    expect(mail.html).not.toContain("<b>Eve</b>");
    expect(mail.html).toContain("&lt;b&gt;Eve&lt;/b&gt; O&#39;Neil");
  });
});
