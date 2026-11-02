import { describe, expect, it } from "vitest";
import { failing, fakeSupabase, rows } from "@/test/fake-supabase";
import { isQueueDecisionEligible, loadMyPendingApprovalCount } from "./pending";

const HR_ADMIN = [{ role: "hr_admin" as const, companyId: "c1" }];
const viewer = { userId: "u1", employeeId: "e-hr", grants: HR_ADMIN };
const asClient = (c: ReturnType<typeof fakeSupabase>) => c as never;

describe("isQueueDecisionEligible", () => {
  const base = { roles: ["hr_admin"], beneficiaryEmployeeId: "e-1", beneficiaryCompanyId: "c1", viewerEmployeeId: "e-hr", grants: HR_ADMIN };
  it("holds when the viewer has a deciding role in the beneficiary's company", () => expect(isQueueDecisionEligible(base)).toBe(true));
  it("never counts the viewer's own request", () => expect(isQueueDecisionEligible({ ...base, beneficiaryEmployeeId: "e-hr" })).toBe(false));
  it("does not hold for another company or a role the viewer lacks", () => {
    expect(isQueueDecisionEligible({ ...base, beneficiaryCompanyId: "c2" })).toBe(false);
    expect(isQueueDecisionEligible({ ...base, roles: ["ceo"] })).toBe(false);
    expect(isQueueDecisionEligible({ ...base, beneficiaryCompanyId: undefined })).toBe(false);
  });
  it("lets a company-wide grant (no company) decide anywhere", () => {
    expect(isQueueDecisionEligible({ ...base, beneficiaryCompanyId: "c2", grants: [{ role: "hr_admin", companyId: null }] })).toBe(true);
  });
});

describe("loadMyPendingApprovalCount", () => {
  const queueStep = (id: string, over: Record<string, unknown> = {}) => ({ approval_id: id, approver_id: null, queue_roles: ["hr_admin"], id: `r-${id}`, employee_id: "e-1", company_id: "c1", ...over });

  it("counts the steps routed by name AND the Recovery Leave queue steps the person decides now (D-21)", async () => {
    const db = fakeSupabase({ approvals: () => ({ data: [], error: null, count: 2 }) }, { recovery_decider_inbox: rows([queueStep("a1")]) });
    expect(await loadMyPendingApprovalCount(asClient(db), viewer)).toBe(3);
  });

  it("counts an HR Admin's request on the shared queue for a CEO who cannot read the request or the queue row (A15)", async () => {
    const db = fakeSupabase({ approvals: () => ({ data: [], error: null, count: 0 }) }, { recovery_decider_inbox: rows([queueStep("a9", { queue_roles: ["ceo", "cto"] })]) });
    expect(await loadMyPendingApprovalCount(asClient(db), { userId: "u-ceo" })).toBe(1);
  });

  it("does not count a step twice: a step assigned to the person by name is already in the first count", async () => {
    const db = fakeSupabase({ approvals: () => ({ data: [], error: null, count: 1 }) }, { recovery_decider_inbox: rows([queueStep("a1", { approver_id: "u1", queue_roles: null })]) });
    expect(await loadMyPendingApprovalCount(asClient(db), viewer)).toBe(1);
  });

  it("counts the same queue step once even if the database lists it twice", async () => {
    const db = fakeSupabase({ approvals: () => ({ data: [], error: null, count: 0 }) }, { recovery_decider_inbox: rows([queueStep("a1"), queueStep("a1")]) });
    expect(await loadMyPendingApprovalCount(asClient(db), viewer)).toBe(1);
  });

  it("counts nothing extra when the database offers this person no queue step (another company, their own request, a role they lack)", async () => {
    const db = fakeSupabase({ approvals: () => ({ data: [], error: null, count: 0 }) }, { recovery_decider_inbox: rows([]) });
    expect(await loadMyPendingApprovalCount(asClient(db), viewer)).toBe(0);
  });

  it("THROWS when a read fails: never a false zero", async () => {
    await expect(loadMyPendingApprovalCount(asClient(fakeSupabase({ approvals: failing() })), viewer)).rejects.toBeTruthy();
    const inboxFails = fakeSupabase({ approvals: () => ({ data: [], error: null, count: 3 }) }, { recovery_decider_inbox: failing() });
    await expect(loadMyPendingApprovalCount(asClient(inboxFails), viewer)).rejects.toBeTruthy();
  });

  it("returns the named-step count when there is no queue step", async () => {
    const db = fakeSupabase({ approvals: () => ({ data: [], error: null, count: 4 }) }, { recovery_decider_inbox: rows([]) });
    expect(await loadMyPendingApprovalCount(asClient(db), viewer)).toBe(4);
  });
});
