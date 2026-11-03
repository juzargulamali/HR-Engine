/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";
import { createPhase2bPolicyDrafts } from "@/lib/actions/policies";
import { createRecoveryWindowsPolicyDrafts } from "@/lib/actions/recoveryWindows";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/policies", useSearchParams: () => new URLSearchParams(), redirect: vi.fn() }));

let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
let rpcCalls: string[] = [];
const tables: Record<string, FakeResult> = { policy_versions: rows([]), countries: rows([{ code: "AE", name: "United Arab Emirates" }]), policy_leave_types: rows([]) };
const THREE = [{ code: "AE", name: "United Arab Emirates" }, { code: "SA", name: "Saudi Arabia" }, { code: "PL", name: "Poland" }];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const base = fakeSupabase(tables, { preflight_phase2b_v2_policy_status: rows([{ country_code: "AE", status: "not_created" }]), seed_phase2b_policy_drafts: rows([]), seed_recovery_windows_policy_drafts: rows([]) });
    return { ...base, rpc: (name: string) => { rpcCalls.push(name); return base.rpc(name); } };
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "Person", grants }) }));

import PoliciesPage from "./page";

beforeEach(() => { grants = []; rpcCalls = []; tables.countries = rows(THREE); });

// The "Create ... drafts" buttons run seed_phase2b_policy_drafts() / seed_recovery_windows_policy_drafts(), which refuse unless the person holds the HR Admin role for ALL of AE, SA and PL,
// unscoped by company. The page offers them on exactly that test (canSeedPolicyDrafts) and so do the two server actions.
// The opening tag with the class list removed (it holds Tailwind's "disabled:" variants), so "disabled" can only be the attribute.
const buttonTag = (html: string, label: string) => (html.match(new RegExp(`<button[^>]*>${label}`))?.[0] ?? "").replace(/class="[^"]*"/, "");
const EXPLANATION = "need an HR Admin role that covers all three countries and is not limited to one company";
const hr = (countryCode: string | null, companyId: string | null = null) => ({ role: "hr_admin", companyId, countryCode });

describe("The 'Create ... drafts' buttons offer only what the database will accept", () => {
  const BUTTONS = ["Create corrected Phase 2B drafts", "Create Recovery Leave \\(windows\\) drafts"];
  const render = async () => renderToStaticMarkup((await PoliciesPage()) as never);

  it("an HR Admin whose role covers all three countries sees both buttons enabled and no explanation", async () => {
    tables.countries = rows(THREE);
    for (const g of [[hr(null)], [hr("AE"), hr("SA"), hr("PL")]]) {
      grants = g;
      const html = await render();
      for (const b of BUTTONS) {
        expect(buttonTag(html, b), b).not.toBe("");
        expect(buttonTag(html, b), b).not.toContain("disabled");
      }
      expect(html).not.toContain(EXPLANATION);
    }
  });

  it("a single-country HR Admin (or two countries) sees both buttons disabled and one sentence saying why; the per-country 'Draft a policy' link stays", async () => {
    tables.countries = rows(THREE);
    for (const g of [[hr("AE")], [hr("AE"), hr("SA")]]) {
      grants = g;
      const html = await render();
      for (const b of BUTTONS) expect(buttonTag(html, b), b).toContain("disabled");
      expect(html.split(EXPLANATION)).toHaveLength(2); // exactly one explanation
      expect(html).toContain("Draft a policy"); // drafting one country's policy by hand is unchanged
    }
  });

  it("a company-only HR Admin sees them disabled with the same sentence", async () => {
    tables.countries = rows(THREE);
    grants = [hr(null, "c1")];
    const html = await render();
    for (const b of BUTTONS) expect(buttonTag(html, b), b).toContain("disabled");
    expect(html).toContain(EXPLANATION);
  });

  it("someone with no HR Admin role (employee, CEO, nobody) sees no buttons and no explanation", async () => {
    tables.countries = rows(THREE);
    for (const g of [[], [{ role: "employee", companyId: "c1", countryCode: null }], [{ role: "ceo", companyId: null, countryCode: null }]]) {
      grants = g;
      const html = await render();
      expect(html).not.toMatch(/Create (corrected|Recovery)/);
      expect(html).not.toContain(EXPLANATION);
    }
  });

  it("the screen and the server cannot drift: for every one of these roles the button is enabled exactly when the server action goes on to call the database", async () => {
    tables.countries = rows(THREE);
    const cases = [[], [hr(null)], [hr("AE")], [hr("AE"), hr("SA")], [hr("AE"), hr("SA"), hr("PL")], [hr(null, "c1")], [hr("AE"), hr(null, "c1")], [{ role: "ceo", companyId: null, countryCode: null }]];
    for (const g of cases) {
      grants = g;
      const html = await render();
      const offered = buttonTag(html, BUTTONS[0]!) !== "" && !buttonTag(html, BUTTONS[0]!).includes("disabled");
      for (const [fn, rpc] of [[createPhase2bPolicyDrafts, "seed_phase2b_policy_drafts"], [createRecoveryWindowsPolicyDrafts, "seed_recovery_windows_policy_drafts"]] as const) {
        rpcCalls = [];
        const result = await fn();
        expect(rpcCalls.includes(rpc), `${JSON.stringify(g)} ${rpc}`).toBe(offered);
        if (!offered) expect(result.error).toContain(EXPLANATION);
      }
    }
  });
});
