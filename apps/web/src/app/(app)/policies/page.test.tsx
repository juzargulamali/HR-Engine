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
const tables: Record<string, FakeResult> = { policy_versions: rows([]), countries: rows([{ code: "AE", name: "United Arab Emirates" }]), policy_leave_types: rows([]) };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const base = fakeSupabase(tables, { preflight_phase2b_v2_policy_status: rows([{ country_code: "AE", status: "draft" }]) });
    return { ...base, rpc: (name: string) => { rpcCalls.push(name); return base.rpc(name); } };
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Person", grants }) }));

import PoliciesPage from "./page";

beforeEach(() => { grants = []; rpcCalls = []; });

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
