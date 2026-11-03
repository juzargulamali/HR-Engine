import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, rpc } = vi.hoisted(() => ({ revalidatePath: vi.fn(), rpc: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [{ role: "hr_admin", companyId: null, countryCode: null }];
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "HR", grants }) }));

import { createPhase2bPolicyDrafts } from "./policies";

beforeEach(() => { rpc.mockReset(); grants = [{ role: "hr_admin", companyId: null, countryCode: null }]; });

describe("createPhase2bPolicyDrafts", () => {
  it("calls seed_phase2b_policy_drafts with no actor argument, maps the results, and refreshes the Policies page", async () => {
    rpc.mockResolvedValue({
      data: [
        { country_code: "AE", policy_type: "leave_rules", version_no: 2, action: "created" },
        { country_code: "PL", policy_type: "leave_rules", version_no: null, action: "skipped_already_seeded" },
      ],
      error: null,
    });

    const result = await createPhase2bPolicyDrafts();

    expect(rpc).toHaveBeenCalledWith("seed_phase2b_policy_drafts"); // no second argument — no actor is ever passed from the client
    expect(result.error).toBeNull();
    expect(result.results).toEqual([
      { countryCode: "AE", policyType: "leave_rules", versionNo: 2, action: "created" },
      { countryCode: "PL", policyType: "leave_rules", versionNo: null, action: "skipped_already_seeded" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/policies");
  });

  it("refuses, with the explanation and without calling the database, an HR Admin whose role does not cover UAE, Saudi Arabia and Poland unscoped by company (the function would refuse them)", async () => {
    for (const g of [[{ role: "hr_admin", companyId: null, countryCode: "AE" }], [{ role: "hr_admin", companyId: "c1", countryCode: null }], [{ role: "ceo", companyId: null, countryCode: null }], []]) {
      grants = g;
      const result = await createPhase2bPolicyDrafts();
      expect(result.error).toContain("need an HR Admin role that covers all three countries");
      expect(result.results).toEqual([]);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
