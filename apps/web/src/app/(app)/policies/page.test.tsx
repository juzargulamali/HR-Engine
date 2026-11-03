/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/policies", useSearchParams: () => new URLSearchParams(), redirect: vi.fn() }));

let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
let rpcCalls: string[] = [];
const tables: Record<string, FakeResult> = { policy_versions: rows([]), countries: rows([{ code: "AE", name: "United Arab Emirates" }]), policy_leave_types: rows([]), employees: { data: { country_code: "AE" }, error: null } };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const base = fakeSupabase(tables, { preflight_phase2b_v2_policy_status: rows([{ country_code: "AE", status: "draft" }]) });
    return { ...base, rpc: (name: string) => { rpcCalls.push(name); return base.rpc(name); } };
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Person", grants }) }));

import PoliciesPage from "./page";

beforeEach(() => { grants = []; rpcCalls = []; tables.policy_versions = rows([]); tables.countries = rows([{ code: "AE", name: "United Arab Emirates" }]); });

const version = (id: string, country_code: string, policy_type: string, status: string, over: Record<string, unknown> = {}) => ({ id, country_code, policy_type, version_no: 1, status, effective_from: "2026-01-01", effective_to: null, created_by: "x", payload: { default_days: 30 }, ...over });

describe("Policies page for staff (U-22)", () => {
  const withPolicies = () => {
    tables.policy_versions = rows([
      version("p-ae", "AE", "leave_rules", "active"), version("p-ae-draft", "AE", "notice_period", "draft"), version("p-pl", "PL", "probation_rules", "active"), version("p-old", "AE", "overtime_rules", "superseded"),
    ]);
    tables.countries = rows([{ code: "AE", name: "United Arab Emirates" }, { code: "PL", name: "Poland" }]);
  };
  it("reads in plain words: the rules in force, own country first, other countries folded, no console and no raw values", async () => {
    withPolicies();
    grants = [{ role: "employee", companyId: "c1", countryCode: null }];
    const html = renderToStaticMarkup((await PoliciesPage()) as never);
    expect(html).toContain("United Arab Emirates");
    expect(html).toContain("Leave rules");
    expect(html).toContain("In force since 1 January 2026");
    expect(html).toContain("Other countries (1)");
    expect(html.indexOf("United Arab Emirates")).toBeLessThan(html.indexOf("Other countries"));
    expect(html).not.toContain("Notice periods"); // a draft is never shown, whatever was returned
    expect(html).not.toContain("Overtime and Recovery Leave"); // nor a superseded version
    for (const hr of ["Draft a policy", "All policy versions you can see", "Show older versions", "superseded"]) expect(html).not.toContain(hr);
    expect(html).not.toMatch(/phase2b|"default_days"/);
  });
  it("HR keeps the console exactly as it was", async () => {
    withPolicies();
    grants = [{ role: "hr_admin", companyId: null, countryCode: null }];
    const html = renderToStaticMarkup((await PoliciesPage()) as never);
    expect(html).toContain("All policy versions you can see");
    expect(html).toContain("Draft a policy");
  });
  it("lists every country when the person's own country cannot be read", async () => {
    withPolicies();
    tables.employees = { data: null, error: { message: "down" } };
    grants = [{ role: "employee", companyId: "c1", countryCode: null }];
    const html = renderToStaticMarkup((await PoliciesPage()) as never);
    expect(html).toContain("All countries (2)");
    expect(html).toContain("is not recorded on your employee record");
    tables.employees = { data: { country_code: "AE" }, error: null };
  });
});

describe("Policies page and the seeded-draft status function (A16)", () => {
  it("does not ask for the draft status at all when the viewer may not draft (the database would answer nobody else anyway)", async () => {
    grants = [{ role: "employee", companyId: "c1", countryCode: null }];
    const html = renderToStaticMarkup((await PoliciesPage()) as never);
    expect(rpcCalls).toEqual([]);
    expect(html).not.toContain("Draft a policy");
  });

  it("asks for it once, for an HR Admin who may draft, and offers the draft buttons", async () => {
    grants = [{ role: "hr_admin", companyId: null, countryCode: null }];
    const html = renderToStaticMarkup((await PoliciesPage()) as never);
    expect(rpcCalls).toEqual(["preflight_phase2b_v2_policy_status"]);
    expect(html).toContain("Draft a policy");
  });

  it("company-only HR Admin (intended restriction, same rule as the database): the read-only list stays, no draft link, no draft-status request, and the draft buttons are disabled with the reason", async () => {
    grants = [{ role: "hr_admin", companyId: "c1", countryCode: null }];
    const html = renderToStaticMarkup((await PoliciesPage()) as never);
    expect(rpcCalls).toEqual([]);
    expect(html).toContain("Country policies");
    expect(html).toContain("All policy versions you can see");
    expect(html).not.toContain("Draft a policy");
    expect(html.match(/<button[^>]*>Create corrected Phase 2B drafts/)?.[0].replace(/class="[^"]*"/, "")).toContain("disabled");
    expect(html).toContain("need an HR Admin role that covers all three countries");
  });

  it("a country-wide CEO sees the list and no drafting buttons (activation only)", async () => {
    grants = [{ role: "ceo", companyId: null, countryCode: null }];
    const html = renderToStaticMarkup((await PoliciesPage()) as never);
    expect(rpcCalls).toEqual([]);
    expect(html).not.toContain("Draft a policy");
  });
});
