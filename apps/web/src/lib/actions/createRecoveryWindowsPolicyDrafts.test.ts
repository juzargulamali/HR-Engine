import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, rpc } = vi.hoisted(() => ({ revalidatePath: vi.fn(), rpc: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
let grants: { role: string; companyId: string | null; countryCode: string | null }[] = [];
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => ({ userId: "u1", employeeId: "e1", email: null, fullName: "HR", grants }) }));

import { createRecoveryWindowsPolicyDrafts } from "./recoveryWindows";

beforeEach(() => { rpc.mockReset(); revalidatePath.mockReset(); grants = [{ role: "hr_admin", companyId: null, countryCode: null }]; });

describe("createRecoveryWindowsPolicyDrafts", () => {
  it("calls seed_recovery_windows_policy_drafts for an HR Admin whose role covers all three countries, and maps the results", async () => {
    rpc.mockResolvedValue({ data: [{ country_code: "AE", version_no: 3, action: "created" }], error: null });
    const result = await createRecoveryWindowsPolicyDrafts();
    expect(rpc).toHaveBeenCalledWith("seed_recovery_windows_policy_drafts");
    expect(result).toEqual({ error: null, results: [{ countryCode: "AE", versionNo: 3, action: "created" }] });
    expect(revalidatePath).toHaveBeenCalledWith("/policies");
  });

  it("also accepts one unscoped HR Admin grant per country", async () => {
    grants = ["AE", "SA", "PL"].map((countryCode) => ({ role: "hr_admin", companyId: null, countryCode }));
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await createRecoveryWindowsPolicyDrafts()).error).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses, with the explanation and without calling the database, a single-country or company-only HR Admin and anyone without the HR Admin role", async () => {
    for (const g of [[{ role: "hr_admin", companyId: null, countryCode: "PL" }], [{ role: "hr_admin", companyId: "c1", countryCode: null }], [{ role: "employee", companyId: "c1", countryCode: null }], []]) {
      grants = g;
      const result = await createRecoveryWindowsPolicyDrafts();
      expect(result.error).toContain("need an HR Admin role that covers all three countries");
      expect(result.results).toEqual([]);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
