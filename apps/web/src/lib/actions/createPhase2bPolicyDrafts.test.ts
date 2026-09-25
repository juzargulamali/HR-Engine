import { describe, expect, it, vi } from "vitest";

const { revalidatePath, rpc } = vi.hoisted(() => ({ revalidatePath: vi.fn(), rpc: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { createPhase2bPolicyDrafts } from "./policies";

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
});
