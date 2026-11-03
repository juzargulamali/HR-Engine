/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, type FakeResult } from "@/test/fake-supabase";

/**
 * One check per screen of the "failed read shown as empty" family (D-20 and friends): with every read failing, each screen says it could
 * not load and never prints its own "nothing here" wording. The healthy and genuinely-empty cases are covered next to each screen.
 */
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(), notFound: () => { throw new Error("NOT_FOUND"); },
}));
const down = failing();
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
let rpcs: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const base = fakeSupabase(tables, rpcs);
    return { ...base, from: (t: string) => (tables[t] === undefined ? base.from("__down__") : base.from(t)) };
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getCurrentSession: async () => ({
    userId: "u1", employeeId: "e1", email: "hana@example.com", fullName: "Hana",
    grants: [{ role: "hr_admin", companyId: "c1", countryCode: null }, { role: "sys_admin", companyId: null, countryCode: null }],
  }),
}));

beforeEach(() => {
  tables = { __down__: down };
  rpcs = {};
});

const flat = (node: unknown) => renderToStaticMarkup(node as never);

describe("a failed read is 'could not load', not an empty or 'not found' screen", () => {
  it("Employees list", async () => {
    const { default: Page } = await import("./employees/page");
    const html = flat(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Could not load the employees");
    expect(html).not.toContain("No employees match");
  });
  it("Employee profile is not a 404", async () => {
    const { default: Page } = await import("./employees/[id]/page");
    const html = flat(await Page({ params: Promise.resolve({ id: "e9" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Could not load this employee");
  });
  it("Public holidays", async () => {
    const { default: Page } = await import("./holidays/page");
    const html = flat(await Page());
    expect(html).toContain("Could not load the public holidays");
    expect(html).not.toContain("No holidays on the calendar yet");
  });
  it("Policies", async () => {
    const { default: Page } = await import("./policies/page");
    const html = flat(await Page());
    expect(html).toContain("Could not load the policies");
    expect(html).not.toContain("No policies yet");
  });
  it("Letters", async () => {
    const { default: Page } = await import("./letters/page");
    const html = flat(await Page());
    expect(html).toContain("Could not load the letters");
    expect(html).not.toContain("No letters yet");
  });
  it("Audit log", async () => {
    const { default: Page } = await import("./audit-log/page");
    const html = flat(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Could not load the audit log");
    expect(html).not.toContain("No activity matches");
  });
  it("AI suggestions", async () => {
    const { default: Page } = await import("./ai-suggestions/page");
    const html = flat(await Page());
    expect(html).toContain("Could not load the AI suggestions");
    expect(html).not.toContain("No pending AI suggestions");
  });
  it("Companies", async () => {
    const { default: Page } = await import("./admin/companies/page");
    const html = flat(await Page());
    expect(html).toContain("Could not load the companies");
    expect(html).not.toContain("No companies yet");
  });
  it("Attendance clock offers no Clock in on an unknown state", async () => {
    tables = { __down__: down, employees: { data: { company_id: "c1", country_code: "AE" }, error: null } };
    const { default: Page } = await import("./attendance-clock/page");
    const html = flat(await Page());
    expect(html).toContain("Could not load your clock status");
    expect(html).not.toContain("Clock in");
  });
  it("Attendance register", async () => {
    const { default: Page } = await import("./attendance/page");
    const html = flat(await Page({ searchParams: Promise.resolve({}) } as never));
    expect(html).toContain("Could not load attendance");
  });
});
