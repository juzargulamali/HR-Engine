import { describe, expect, it } from "vitest";
import type { ModuleGrantRef, RoleGrant } from "@enginious-hr/domain";
import { buildOnboarding, normalisePlan, planSchema, type AccessSnapshot, type OnboardingInput, type OnboardingPlan } from "./onboarding";

const CO_A = "00000000-0000-4000-8000-00000000000a";
const CO_B = "00000000-0000-4000-8000-00000000000b";
const names = new Map([[CO_A, "Enginious UAE"], [CO_B, "Enginious Europe"]]);
const g = (role: RoleGrant["role"], companyId: string | null = null): RoleGrant => ({ role, companyId, countryCode: null });
const HR_A = [g("hr_admin", CO_A)];
const SYS_GLOBAL = [g("hr_admin", CO_A), g("sys_admin")];
const SYS_SCOPED = [g("hr_admin", CO_A), g("sys_admin", CO_A)];   // what a System Administrator grant limited to one company looks like
const noMods: ModuleGrantRef[] = [];
const salesManager: ModuleGrantRef[] = [{ module: "sales", companyId: CO_A, capabilities: ["manage_access"] }];
const plan = (p: Partial<OnboardingPlan> = {}): OnboardingPlan => ({ inviteEmail: "new.hire@example.test", hrRoles: [], modules: [], ...p });
const snap = (p: Partial<AccessSnapshot> = {}): AccessSnapshot => ({ account: { status: "invited", active: true, email: "new.hire@example.test" }, roles: [], modules: [], ...p });
const base = (o: Partial<OnboardingInput> = {}): OnboardingInput => ({
  employee: { id: "e1", companyId: CO_A, fullName: "Riya Rigger", removed: false, terminated: false, linkedUserId: null },
  companyNames: names, setup: [], plan: plan(), snapshot: null, accountExistsForEmail: false,
  viewer: { grants: HR_A, moduleGrants: noMods }, ...o,
});
const step = (m: ReturnType<typeof buildOnboarding>, k: string) => m.steps.find((s) => s.key === k)!;

describe("plan", () => {
  it("normalises: one entry per role+company and module+company, capabilities limited to the module's own vocabulary, stable order", () => {
    const n = normalisePlan({ inviteEmail: null, hrRoles: [{ role: "employee", companyId: CO_A }, { role: "employee", companyId: CO_A }], modules: [{ module: "sales", companyId: CO_A, capabilities: ["assign_owner", "assign_owner", "not_a_right"], note: "  " }] });
    expect(n.hrRoles).toHaveLength(1);
    expect(n.modules[0]).toEqual({ module: "sales", companyId: CO_A, capabilities: ["assign_owner"], note: null });
  });
  it("rejects a bad email, an unknown role and a non-uuid company", () => {
    expect(planSchema.safeParse({ inviteEmail: "nope", hrRoles: [], modules: [] }).success).toBe(false);
    expect(planSchema.safeParse({ inviteEmail: null, hrRoles: [{ role: "boss", companyId: CO_A }], modules: [] }).success).toBe(false);
    expect(planSchema.safeParse({ inviteEmail: null, hrRoles: [{ role: "employee", companyId: "x" }], modules: [] }).success).toBe(false);
  });
});

describe("onboarding steps: what is done, what is blocked, who can finish it, the next action", () => {
  it("a new employee with an HR Admin viewer: the employee step is done, the profile is next, and the HR Admin can send the invitation", () => {
    const m = buildOnboarding(base({ setup: [{ key: "contract", label: "Contract", status: "todo", detail: "", href: "/x", actionLabel: "Add contract" }] }));
    expect(step(m, "employee").status).toBe("done");
    expect(step(m, "profile")).toMatchObject({ status: "ready", viewerCan: true, nextAction: "Add contract" });
    expect(step(m, "account")).toMatchObject({ status: "ready", viewerCan: true, nextAction: "Invite and link" });
    expect(step(m, "account").who).toMatch(/HR Admin of the employee's company/);
    expect(m.next?.key).toBe("profile");
  });
  it("who can invite: an HR Admin of the employee's own company (alone, or with a company-limited System Administrator or Finance grant, as Saeed holds), or an unrestricted System Administrator; nobody else, and the screen says who", () => {
    const FIN_A = g("finance", CO_A);
    expect(step(buildOnboarding(base({ viewer: { grants: HR_A, moduleGrants: noMods } })), "account")).toMatchObject({ status: "ready", viewerCan: true, nextAction: "Invite and link" });
    expect(step(buildOnboarding(base({ viewer: { grants: [...SYS_SCOPED, FIN_A], moduleGrants: noMods } })), "account")).toMatchObject({ status: "ready", viewerCan: true, nextAction: "Invite and link" });   // Saeed's set
    expect(step(buildOnboarding(base({ viewer: { grants: SYS_GLOBAL, moduleGrants: noMods } })), "account")).toMatchObject({ status: "ready", viewerCan: true, nextAction: "Invite and link" });
    // an unrestricted System Administrator who is not an HR Admin of the company sends the invitation; an HR Admin of the company links the account
    expect(step(buildOnboarding(base({ viewer: { grants: [g("sys_admin")], moduleGrants: noMods } })), "account")).toMatchObject({ status: "ready", viewerCan: true, nextAction: "Send the invitation" });
    expect(step(buildOnboarding(base({ accountExistsForEmail: true, viewer: { grants: [g("sys_admin")], moduleGrants: noMods } })), "account")).toMatchObject({ status: "blocked", viewerCan: false });
    // a System Administrator limited to one company who is NOT an HR Admin of it, and an HR Admin of ANOTHER company, cannot
    const scopedOnly = step(buildOnboarding(base({ viewer: { grants: [g("sys_admin", CO_A)], moduleGrants: noMods } })), "account");
    expect(scopedOnly).toMatchObject({ status: "blocked", viewerCan: false });
    expect(scopedOnly.who).toMatch(/HR Admin of the employee's company, or a System Administrator/);
    expect(step(buildOnboarding(base({ viewer: { grants: [g("hr_admin", CO_B)], moduleGrants: noMods } })), "account")).toMatchObject({ status: "blocked", viewerCan: false });
  });
  it("an account that already exists for the address is linked without a second invitation, by an HR Admin", () => {
    const s = step(buildOnboarding(base({ accountExistsForEmail: true })), "account");
    expect(s).toMatchObject({ status: "ready", viewerCan: true, nextAction: "Link the account" });
    expect(s.detail).toMatch(/no second invitation/);
  });
  it("without an email the invitation waits for it; with a linked login the step is done, invited or active; a deactivated account blocks and names who", () => {
    expect(step(buildOnboarding(base({ plan: plan({ inviteEmail: null }) })), "account")).toMatchObject({ status: "waiting", nextAction: "Add the email address" });
    const linked = { linkedUserId: "u1", fullName: "Riya Rigger", id: "e1", companyId: CO_A, removed: false, terminated: false };
    expect(step(buildOnboarding(base({ employee: linked, snapshot: snap() })), "account").detail).toMatch(/not set a password/);
    expect(step(buildOnboarding(base({ employee: linked, snapshot: snap({ account: { status: "active", active: true, email: null } }) })), "account").status).toBe("done");
    expect(step(buildOnboarding(base({ employee: linked, snapshot: snap({ account: { status: "deactivated", active: false, email: null } }) })), "account")).toMatchObject({ status: "blocked" });
  });
  it("roles: waiting for the account; then ready for an HR Admin of the company (Employee and Reporting Manager, that company only); privileged roles and other companies need an unrestricted System Administrator; applied roles are done on a retry", () => {
    const linked = { linkedUserId: "u1", fullName: "Riya Rigger", id: "e1", companyId: CO_A, removed: false, terminated: false };
    const both = plan({ hrRoles: [{ role: "employee", companyId: CO_A }, { role: "line_manager", companyId: CO_A }] });
    expect(step(buildOnboarding(base({ plan: both })), "roles").status).toBe("waiting");
    // HR Admin of A (also Saeed's set): both roles are theirs to apply
    for (const grants of [HR_A, SYS_SCOPED, [...SYS_SCOPED, g("finance", CO_A)]]) {
      const hr = buildOnboarding(base({ employee: linked, plan: both, snapshot: snap(), viewer: { grants, moduleGrants: noMods } }));
      expect(step(hr, "roles")).toMatchObject({ status: "ready", viewerCan: true });
      expect(hr.roles.every((r) => r.canApply)).toBe(true);
      expect(hr.roles[0]!.who).toMatch(/An HR Admin of Enginious UAE/);
      expect(hr.canApplyAny).toBe(true);
    }
    // a privileged role, and a role for another company, are an unrestricted System Administrator's: shown with who can apply them
    const privileged = plan({ hrRoles: [{ role: "hr_admin", companyId: CO_A }, { role: "finance", companyId: CO_A }, { role: "line_manager", companyId: CO_B }] });
    const hrOnly = buildOnboarding(base({ employee: linked, plan: privileged, snapshot: snap() }));
    expect(hrOnly.roles.map((r) => r.canApply)).toEqual([false, false, false]);
    expect(step(hrOnly, "roles")).toMatchObject({ status: "blocked", viewerCan: false });
    expect(step(hrOnly, "roles").who).toMatch(/System Administrator/);
    expect(hrOnly.canApplyAny).toBe(false);
    const mixed = buildOnboarding(base({ employee: linked, plan: plan({ hrRoles: [{ role: "line_manager", companyId: CO_A }, { role: "finance", companyId: CO_A }] }), snapshot: snap() }));
    expect(step(mixed, "roles")).toMatchObject({ status: "ready", viewerCan: true });
    expect(step(mixed, "roles").detail).toMatch(/1 of 2 waiting roles you can apply; the rest need: A System Administrator/);
    const sys = buildOnboarding(base({ employee: linked, plan: privileged, snapshot: snap(), viewer: { grants: SYS_GLOBAL, moduleGrants: noMods } }));
    expect(sys.roles.every((r) => r.canApply)).toBe(true);
    expect(step(sys, "roles")).toMatchObject({ status: "ready", viewerCan: true });
    // a retry: what is held is done
    const again = buildOnboarding(base({ employee: linked, plan: both, snapshot: snap({ roles: [{ role: "employee", companyId: CO_A }, { role: "line_manager", companyId: CO_A }] }) }));
    expect(step(again, "roles").status).toBe("done");
    expect(again.roles.every((r) => r.applied)).toBe(true);
  });
  it("a privileged role is flagged in the review so it is read twice", () => {
    const m = buildOnboarding(base({ plan: plan({ hrRoles: [{ role: "hr_admin", companyId: CO_A }, { role: "employee", companyId: CO_A }] }) }));
    expect(m.roles.find((r) => r.role === "hr_admin")!.privileged).toBe(true);
    expect(m.roles.find((r) => r.role === "employee")!.privileged).toBe(false);
  });
  it("module access: an access manager can apply ordinary rights for THEIR module and company only, never founder or access-management rights; a plain HR Admin cannot; the line names who can", () => {
    const linked = { linkedUserId: "u1", fullName: "Riya Rigger", id: "e1", companyId: CO_A, removed: false, terminated: false };
    const p = plan({ modules: [{ module: "sales", companyId: CO_A, capabilities: ["assign_owner"] }, { module: "sales", companyId: CO_B, capabilities: ["assign_owner"] }, { module: "sales", companyId: CO_A, capabilities: ["manage_access"] }] });
    const m = buildOnboarding(base({ employee: linked, plan: p, snapshot: snap(), viewer: { grants: HR_A, moduleGrants: salesManager } }));
    // (the plan keeps one entry per module+company: the last write for sales/CO_A wins, here manage_access)
    const a = m.modules.find((x) => x.companyId === CO_A)!;
    const b = m.modules.find((x) => x.companyId === CO_B)!;
    expect(a.canApply).toBe(false);
    expect(a.reason).toMatch(/founder/);
    expect(b.canApply).toBe(false);
    expect(b.who).toBe("A Sales & CRM founder or access manager for Enginious Europe");
    const ordinary = buildOnboarding(base({ employee: linked, plan: plan({ modules: [{ module: "sales", companyId: CO_A, capabilities: ["assign_owner"] }] }), snapshot: snap(), viewer: { grants: HR_A, moduleGrants: salesManager } }));
    expect(ordinary.modules[0]!.canApply).toBe(true);
    expect(step(ordinary, "modules")).toMatchObject({ status: "ready", viewerCan: true });
    const plainHr = buildOnboarding(base({ employee: linked, plan: plan({ modules: [{ module: "sales", companyId: CO_A, capabilities: ["assign_owner"] }] }), snapshot: snap() }));
    expect(plainHr.modules[0]!.canApply).toBe(false);
    expect(step(plainHr, "modules")).toMatchObject({ status: "blocked", viewerCan: false });
  });
  it("applying only ever adds rights: a held right the plan does not list is not removed, and a held-plus-planned set is judged as the union", () => {
    const linked = { linkedUserId: "u1", fullName: "Riya Rigger", id: "e1", companyId: CO_A, removed: false, terminated: false };
    const m = buildOnboarding(base({ employee: linked, plan: plan({ modules: [{ module: "sales", companyId: CO_A, capabilities: ["assign_owner"] }] }), snapshot: snap({ modules: [{ module: "sales", companyId: CO_A, capabilities: ["reopen_closed"] }] }), viewer: { grants: HR_A, moduleGrants: salesManager } }));
    expect(m.modules[0]).toMatchObject({ held: ["reopen_closed"], missing: ["assign_owner"], applied: false, canApply: true });
  });
  it("review: nothing planned is optional; everything in place is done; the progress counts only required steps", () => {
    expect(step(buildOnboarding(base()), "review").status).toBe("optional");
    const linked = { linkedUserId: "u1", fullName: "Riya Rigger", id: "e1", companyId: CO_A, removed: false, terminated: false };
    const done = buildOnboarding(base({ employee: linked, plan: plan({ hrRoles: [{ role: "employee", companyId: CO_A }] }), snapshot: snap({ roles: [{ role: "employee", companyId: CO_A }] }) }));
    expect(step(done, "review").status).toBe("done");
    expect(done.progress.done).toBe(done.progress.total);
    expect(done.next).toBeNull();
  });
  it("a removed or terminated record has nothing to invite", () => {
    const m = buildOnboarding(base({ employee: { id: "e1", companyId: CO_A, fullName: "Riya Rigger", removed: true, terminated: false, linkedUserId: null } }));
    expect(step(m, "account").status).toBe("optional");
  });
});
