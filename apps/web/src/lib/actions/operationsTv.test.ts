import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
const createUser = vi.fn(); const deleteUser = vi.fn(); const updateUserById = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ auth: { admin: { createUser, deleteUser, updateUserById } } }) }));

import { createDisplayAccount, revokeDisplayAccount } from "./operationsTv";

const CO = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const D = "33333333-3333-4333-8333-333333333333";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const form = { companyId: CO, label: "Office TV", email: " Office.TV@Example.AE ", officeTz: "Asia/Dubai" };

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
  createUser.mockReset().mockResolvedValue({ data: { user: { id: U } }, error: null });
  deleteUser.mockReset().mockResolvedValue({ error: null });
  updateUserById.mockReset().mockResolvedValue({ error: null });
});

describe("createDisplayAccount", () => {
  it("checks the caller's access first, creates a flagged account with a generated password, registers it for the company, and returns the password once", async () => {
    const r = await createDisplayAccount({ error: null }, fd(form));
    expect(r.error).toBeNull();
    expect(rpc.mock.calls[0]).toEqual(["ops_tv_list_displays", { p_company_id: CO }]);
    const arg = createUser.mock.calls[0]![0];
    expect(arg).toMatchObject({ email: "office.tv@example.ae", email_confirm: true, app_metadata: { ops_tv: true }, user_metadata: { full_name: "Office board: Office TV" } });
    expect(arg.password.length).toBeGreaterThanOrEqual(24);
    expect(rpc).toHaveBeenLastCalledWith("ops_tv_register_display", { p_user_id: U, p_company_id: CO, p_label: "Office TV", p_office_tz: "Asia/Dubai" });
    expect(r.created).toEqual({ email: "office.tv@example.ae", password: arg.password, label: "Office TV" });
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("creates nothing for someone who is not this company's Operations Manager", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not allowed" } });
    const r = await createDisplayAccount({ error: null }, fd(form));
    expect(r.error).toMatch(/Operations Manager/); expect(createUser).not.toHaveBeenCalled(); expect(r.created).toBeUndefined();
  });
  it("rejects a bad e-mail, an empty name and an unknown zone before touching anything", async () => {
    for (const bad of [{ email: "nope" }, { label: "  " }, { officeTz: "Mars/Base" }]) {
      const r = await createDisplayAccount({ error: null }, fd({ ...form, ...bad }));
      expect(r.error).toBeTruthy();
    }
    expect(rpc).not.toHaveBeenCalled(); expect(createUser).not.toHaveBeenCalled();
  });
  it("deletes the new sign-in again when registering fails, so no orphan account is left", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { code: "42883", message: "function does not exist" } });
    const r = await createDisplayAccount({ error: null }, fd(form));
    expect(deleteUser).toHaveBeenCalledWith(U);
    expect(r.error).toMatch(/not installed/); expect(r.warning ?? null).toBeNull(); expect(r.created).toBeUndefined();
  });
  it("tells the operator to remove the account by hand when even the clean-up fails", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    deleteUser.mockResolvedValue({ error: { message: "nope" } });
    const r = await createDisplayAccount({ error: null }, fd(form));
    expect(r.error).toBeTruthy(); expect(r.warning).toMatch(/Supabase dashboard/);
  });
  it("does not echo the Auth service's own message and never creates a registry row when sign-in creation fails", async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: "secret internal detail" } });
    const r = await createDisplayAccount({ error: null }, fd(form));
    expect(r.error).not.toMatch(/secret internal/); expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("revokeDisplayAccount", () => {
  it("revokes in the database first, then blocks the sign-in", async () => {
    const order: string[] = [];
    rpc.mockImplementation(async (fn: string) => { order.push(fn); return { data: null, error: null }; });
    updateUserById.mockImplementation(async () => { order.push("ban"); return { error: null }; });
    const r = await revokeDisplayAccount({ error: null }, fd({ displayId: D, userId: U }));
    expect(r).toEqual({ error: null }); expect(order).toEqual(["ops_tv_revoke_display", "ban"]);
    expect(rpc).toHaveBeenCalledWith("ops_tv_revoke_display", { p_display_id: D });
    expect(updateUserById).toHaveBeenCalledWith(U, { ban_duration: "876600h" });
  });
  it("does not block anything when the database refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "x" } });
    const r = await revokeDisplayAccount({ error: null }, fd({ displayId: D, userId: U }));
    expect(r.error).toMatch(/Operations Manager/); expect(updateUserById).not.toHaveBeenCalled();
  });
  it("reports a failed block as a warning, the display being revoked already, and a retry on a revoked display re-blocks", async () => {
    updateUserById.mockResolvedValueOnce({ error: { message: "x" } });
    const r = await revokeDisplayAccount({ error: null }, fd({ displayId: D, userId: U }));
    expect(r.error).toBeNull(); expect(r.warning).toMatch(/revoked/);
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "display already revoked" } });
    const again = await revokeDisplayAccount({ error: null }, fd({ displayId: D, userId: U }));
    expect(again).toEqual({ error: null }); expect(updateUserById).toHaveBeenCalledTimes(2);
  });
  it("rejects ids that are not ids", async () => {
    const r = await revokeDisplayAccount({ error: null }, fd({ displayId: "x", userId: U }));
    expect(r.error).toBeTruthy(); expect(rpc).not.toHaveBeenCalled();
  });
});
