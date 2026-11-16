/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleGrantRef, RoleGrant } from "@enginious-hr/domain";
import { buildOnboarding, type AccessSnapshot, type OnboardingPlan } from "@/lib/hr/onboarding";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/onboarding", () => ({ saveOnboardingPlan: vi.fn(), inviteAndLinkEmployee: vi.fn(), applyOnboardingAccess: vi.fn() }));
let loaded: unknown;
vi.mock("@/lib/hr/onboarding-data", () => ({ loadOnboarding: async () => loaded }));

import OnboardingPage from "./page";

const CO = "00000000-0000-4000-8000-00000000000a";
const CO2 = "00000000-0000-4000-8000-00000000000b";
const g = (role: RoleGrant["role"], companyId: string | null = null): RoleGrant => ({ role, companyId, countryCode: null });
const plan: OnboardingPlan = {
  inviteEmail: "riya@example.test",
  hrRoles: [{ role: "line_manager", companyId: CO }, { role: "hr_admin", companyId: CO2 }],
  modules: [{ module: "sales", companyId: CO, capabilities: ["assign_owner"], note: null }],
};
const snapshot: AccessSnapshot = { account: { status: "invited", active: true, email: "riya@example.test" }, roles: [], modules: [] };

function make(grants: RoleGrant[], moduleGrants: ModuleGrantRef[], opts: { linked?: boolean } = {}) {
  const linked = opts.linked ?? true;
  const model = buildOnboarding({
    employee: { id: "e1", companyId: CO, fullName: "Riya Rigger", removed: false, terminated: false, linkedUserId: linked ? "u1" : null },
    companyNames: new Map([[CO, "Enginious UAE"], [CO2, "Enginious Europe"]]),
    setup: [], plan, snapshot: linked ? snapshot : null, accountExistsForEmail: false, viewer: { grants, moduleGrants },
  });
  return {
    kind: "ok",
    employee: { id: "e1", companyId: CO, companyName: "Enginious UAE", fullName: "Riya Rigger", employeeNumber: "E010", jobTitle: "Technician", removed: false, terminated: false, linkedUserId: linked ? "u1" : null },
    model, plan, planSaved: true, reviewedAt: null, failed: [],
    companies: [{ id: CO, name: "Enginious UAE" }, { id: CO2, name: "Enginious Europe" }],
    viewer: { isSysAdmin: grants.some((x) => x.role === "sys_admin" && x.companyId === null), hrHere: true },
  };
}
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await OnboardingPage({ params: Promise.resolve({ id: "e1" }), searchParams: Promise.resolve(sp) }));

beforeEach(() => { loaded = undefined; });

describe("Onboarding page", () => {
  it("an HR Admin of the employee's company: can apply the Reporting Manager role themselves, sees the privileged role as someone else's (who), and the Sales right as a pending grant with who can apply it; the review lists the exact companies, roles and rights", async () => {
    loaded = make([g("hr_admin", CO)], []);
    const html = await render();
    expect(html).toContain("Onboarding: Riya Rigger");
    expect(html).toContain("Enginious UAE");
    expect(html).toContain('data-testid="onboarding-steps"');
    expect(html).toMatch(/data-testid="onboarding-step-roles"[^>]*data-status="ready"/);
    expect(html).toMatch(/data-testid="onboarding-step-modules"[^>]*data-status="blocked"/);
    expect(html).toContain("A Sales &amp; CRM founder or access manager for Enginious UAE");       // the exact grant pending and who can apply it
    expect(html).toContain("the rest need: A System Administrator");                               // the privileged role and the other company's role
    // the exact list, before anything is applied
    expect(html).toContain("Reporting Manager for Enginious UAE");
    expect(html).toContain("Needs: A System Administrator");
    expect(html).toContain("HR Admin for Enginious Europe");
    expect(html).toContain("wide access");
    expect(html).toContain("assign owner");
    expect(html).toContain("You can apply this.");
    expect(html).not.toContain("Nothing in the list can be applied by you yet");
    expect(html).toContain("Apply what I can");
  });
  it("an unrestricted System Administrator can apply the roles but not the Sales right; the list says so line by line", async () => {
    loaded = make([g("hr_admin", CO), g("sys_admin")], []);
    const html = await render();
    expect(html).toMatch(/data-testid="onboarding-step-roles"[^>]*data-status="ready"/);
    expect(html).toContain("You can apply this.");
    expect(html).toMatch(/data-testid="onboarding-step-modules"[^>]*data-status="blocked"/);
    expect(html).not.toContain("Nothing in the list can be applied by you yet");
  });
  it("a Sales access manager of that company can apply the Sales right too: then the review has nothing left that is only someone else's except the privileged role", async () => {
    const mods: ModuleGrantRef[] = [{ module: "sales", companyId: CO, capabilities: ["manage_access"] }];
    loaded = make([g("hr_admin", CO)], mods);
    const html = await render();
    expect(html).toMatch(/data-testid="onboarding-step-modules"[^>]*data-status="ready"/);
    expect(html).toMatch(/data-testid="onboarding-step-roles"[^>]*data-status="ready"/);
  });
  it("before the account exists the HR Admin can send the invitation (Invite and link), and the roles and rights wait for it", async () => {
    loaded = make([g("hr_admin", CO)], [], { linked: false });
    const html = await render();
    expect(html).toMatch(/data-testid="onboarding-step-account"[^>]*data-status="ready"/);
    expect(html).toContain("Invite and link");
    expect(html).toMatch(/data-testid="onboarding-step-roles"[^>]*data-status="waiting"/);
    expect(html).toMatch(/data-testid="onboarding-step-modules"[^>]*data-status="waiting"/);
  });
  it("someone who is neither an HR Admin of the company nor an unrestricted System Administrator is told who can send the invitation, and the address stays in the plan", async () => {
    loaded = make([g("sys_admin", CO)], [], { linked: false });
    const html = await render();
    expect(html).toMatch(/data-testid="onboarding-step-account"[^>]*data-status="blocked"/);
    expect(html).toContain("Only an HR Admin of this company or a System Administrator can send the invitation");
  });
  it("the created notice appears once after Add employee; a failed read is named, not hidden", async () => {
    loaded = { ...make([g("hr_admin", CO)], []), failed: ["the account and access now on record"] };
    const html = await render({ created: "1" });
    expect(html).toContain("Employee created. Finish onboarding below.");
    expect(html).toContain("Could not read: the account and access now on record");
  });
  it("shows the access notice to someone who may not onboard, and nothing for a signed-out visitor", async () => {
    loaded = { kind: "denied" };
    const denied = (await OnboardingPage({ params: Promise.resolve({ id: "e1" }), searchParams: Promise.resolve({}) })) as { props: { children: unknown } } | null;
    expect(JSON.stringify(denied?.props.children)).toContain("Onboarding is for an HR Admin");
    loaded = { kind: "signed-out" };
    expect(await OnboardingPage({ params: Promise.resolve({ id: "e1" }), searchParams: Promise.resolve({}) })).toBeNull();
  });
});
