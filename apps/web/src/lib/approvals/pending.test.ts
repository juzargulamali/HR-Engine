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
  const queueRow = { entity_id: "r1", workflow_id: null, step_order: 1, queue_roles: ["hr_admin"] };

  it("counts the steps routed by name AND the Recovery Leave queue steps the viewer may decide (D-21)", async () => {
    const db = fakeSupabase({
      approvals: () => ({ data: [queueRow], error: null, count: 2 }),
      recovery_credit_requests: rows([{ id: "r1", employee_id: "e-1" }]),
      employees: rows([{ id: "e-1", company_id: "c1" }]),
    });
    expect(await loadMyPendingApprovalCount(asClient(db), viewer)).toBe(3);
  });

  it("does not count a queue step for the viewer's own request, or for a role they lack", async () => {
    const own = fakeSupabase({
      approvals: () => ({ data: [queueRow], error: null, count: 0 }),
      recovery_credit_requests: rows([{ id: "r1", employee_id: "e-hr" }]),
      employees: rows([{ id: "e-hr", company_id: "c1" }]),
    });
    expect(await loadMyPendingApprovalCount(asClient(own), viewer)).toBe(0);
    const noRole = fakeSupabase({
      approvals: () => ({ data: [queueRow], error: null, count: 0 }),
      recovery_credit_requests: rows([{ id: "r1", employee_id: "e-1" }]),
      employees: rows([{ id: "e-1", company_id: "c1" }]),
    });
    expect(await loadMyPendingApprovalCount(asClient(noRole), { ...viewer, grants: [] })).toBe(0);
  });

  it("reads the role of a legacy role_queue step from its workflow step", async () => {
    const db = fakeSupabase({
      approvals: () => ({ data: [{ ...queueRow, queue_roles: null, workflow_id: "w1" }], error: null, count: 0 }),
      recovery_credit_requests: rows([{ id: "r1", employee_id: "e-1" }]),
      approval_workflow_steps: rows([{ workflow_id: "w1", step_order: 1, approver_type: "role_queue:hr_admin" }]),
      employees: rows([{ id: "e-1", company_id: "c1" }]),
    });
    expect(await loadMyPendingApprovalCount(asClient(db), viewer)).toBe(1);
  });

  it("THROWS when a read fails: never a false zero", async () => {
    await expect(loadMyPendingApprovalCount(asClient(fakeSupabase({ approvals: failing() })), viewer)).rejects.toBeTruthy();
    const queueFails = fakeSupabase({ approvals: () => ({ data: [queueRow], error: null, count: 0 }), recovery_credit_requests: failing() });
    await expect(loadMyPendingApprovalCount(asClient(queueFails), viewer)).rejects.toBeTruthy();
    const employeesFail = fakeSupabase({ approvals: () => ({ data: [queueRow], error: null, count: 0 }), recovery_credit_requests: rows([{ id: "r1", employee_id: "e-1" }]), employees: failing() });
    await expect(loadMyPendingApprovalCount(asClient(employeesFail), viewer)).rejects.toBeTruthy();
  });

  it("returns the named-step count without more reads when there is no queue", async () => {
    const db = fakeSupabase({ approvals: () => ({ data: [], error: null, count: 4 }), recovery_credit_requests: failing() });
    expect(await loadMyPendingApprovalCount(asClient(db), viewer)).toBe(4);
  });
});
