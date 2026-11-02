import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let tables: Record<string, FakeResult | (() => FakeResult)> = {};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase(tables) }));

import { getCurrentSession } from "./session";

beforeEach(() => {
  tables = {
    profiles: row({ full_name: "Aisha Khan" }),
    user_roles: rows([{ role: "hr_admin", company_id: "c1", country_code: null }]),
    employees: row({ id: "e1" }),
  };
});

describe("getCurrentSession", () => {
  it("healthy: roles and employee record are read, and nothing is flagged", async () => {
    const s = await getCurrentSession();
    expect(s?.grants).toEqual([{ role: "hr_admin", companyId: "c1", countryCode: null }]);
    expect(s?.employeeId).toBe("e1");
    expect(s?.loadFailed).toBeUndefined();
  });
  it("a person with genuinely no role and no employee record is not a load failure", async () => {
    tables = { ...tables, user_roles: rows([]), employees: row(null) };
    const s = await getCurrentSession();
    expect(s).toMatchObject({ grants: [], employeeId: null });
    expect(s?.loadFailed).toBeUndefined();
  });
  it("a failed roles read flags the failure and opens nothing up (grants stay empty)", async () => {
    tables = { ...tables, user_roles: failing() };
    const s = await getCurrentSession();
    expect(s?.loadFailed).toBe(true);
    expect(s?.grants).toEqual([]);
  });
  it("a failed employee read flags the failure instead of looking like 'no employee record'", async () => {
    tables = { ...tables, employees: failing() };
    const s = await getCurrentSession();
    expect(s?.loadFailed).toBe(true);
    expect(s?.employeeId).toBeNull();
  });
});
