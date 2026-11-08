import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
type Grant = { companyId: string; capabilities: string[] };
let grants: Grant[] = [];
vi.mock("@/lib/crm/context", () => ({ getCrmContext: async () => ({ userId: "44444444-4444-4444-8444-444444444444", fullName: "U", grants, companies: [], people: [], personName: () => "x", companyName: () => "x" }) }));

import { assignAccountOwner, createAccount, createAccountFollowUp, reassignFollowUp, saveAccountProfile } from "./clients-agencies";

const CO = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";
const SARA = "44444444-4444-4444-8444-444444444444";
const OMAR = "55555555-5555-4555-8555-555555555555";
const FU = "66666666-6666-4666-8666-666666666666";
const fd = (o: Record<string, string | string[]>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x); return f; };

beforeEach(() => { grants = []; rpc.mockReset().mockResolvedValue({ data: "new-id", error: null }); });

describe("assigning the account owner", () => {
  it("is refused on the server, without calling the database, for someone without the assign owners right", async () => {
    grants = [{ companyId: CO, capabilities: [] }];
    const r = await assignAccountOwner({ error: null }, fd({ orgId: ORG, companyId: CO, ownerId: SARA }));
    expect(r.error).toMatch(/Only a founder/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not accept a right held for another company (company boundary)", async () => {
    grants = [{ companyId: OTHER, capabilities: ["founder"] }];
    expect((await assignAccountOwner({ error: null }, fd({ orgId: ORG, companyId: CO, ownerId: SARA }))).error).toMatch(/Only a founder/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("calls only the account-owner function (never a follow-up or inquiry-owner function) for a delegate, and Unassigned is a null owner", async () => {
    grants = [{ companyId: CO, capabilities: ["assign_owner"] }];
    expect(await assignAccountOwner({ error: null }, fd({ orgId: ORG, companyId: CO, ownerId: SARA }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("crm_assign_account_owner", { p_org: ORG, p_company: CO, p_new_owner: SARA });
    rpc.mockClear();
    await assignAccountOwner({ error: null }, fd({ orgId: ORG, companyId: CO, ownerId: "" }));
    expect(rpc).toHaveBeenCalledWith("crm_assign_account_owner", { p_org: ORG, p_company: CO, p_new_owner: null });
  });
  it("shows the database's own refusal (an ineligible person) in words", async () => {
    grants = [{ companyId: CO, capabilities: ["founder"] }];
    rpc.mockResolvedValue({ data: null, error: { message: "The chosen owner has no Sales access for this company" } });
    expect((await assignAccountOwner({ error: null }, fd({ orgId: ORG, companyId: CO, ownerId: OMAR }))).error).toMatch(/no Sales access for this company/);
  });
});

describe("reassigning a follow-up", () => {
  it("calls only the follow-up function: the account owner is never touched", async () => {
    grants = [{ companyId: CO, capabilities: [] }];
    expect(await reassignFollowUp({ error: null }, fd({ followUpId: FU, assigneeId: OMAR }))).toEqual({ error: null });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["crm_reassign_follow_up"]);
    expect(rpc).toHaveBeenCalledWith("crm_reassign_follow_up", { p_follow_up_id: FU, p_new_assignee: OMAR });
  });
  it("shows the database's refusal when the caller may not hand it to that person", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only the owner or a founder can assign follow-ups to others" } });
    expect((await reassignFollowUp({ error: null }, fd({ followUpId: FU, assigneeId: OMAR }))).error).toMatch(/Only the owner or a founder/);
  });
});

describe("editing and creating", () => {
  it("passes an edit to the database, which refuses someone who may not edit (shown, nothing else called)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only the person who added this organisation, a founder, or the owner of an opportunity it is on can change it" } });
    const r = await saveAccountProfile({ error: null }, fd({ orgId: ORG, companyId: CO, name: "Fictional Aurora", roles: ["agency", "technology"], country: "AE" }));
    expect(r.error).toMatch(/Only the person who added/);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["crm_update_organisation"]);
  });
  it("saves the shared record and this company's lead source in two steps, with several roles on the one record", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const r = await saveAccountProfile({ error: null }, fd({ orgId: ORG, companyId: CO, name: "Fictional Aurora", roles: ["agency", "technology"], country: "uae", website: "aurora.example", leadSource: "exhibition", exhibition: "Gulf Expo (fictional)" }));
    expect(r).toEqual({ error: null });
    expect(rpc).toHaveBeenNthCalledWith(1, "crm_update_organisation", { p_org: ORG, p_patch: { name: "Fictional Aurora", roles: ["agency", "technology"], country_code: "AE", website: "aurora.example", place: null, note: null, vat_trn: null, trade_licence_no: null } });
    expect(rpc).toHaveBeenNthCalledWith(2, "crm_save_account_profile", { p_org: ORG, p_company: CO, p_patch: { lead_source: "exhibition", exhibition: "Gulf Expo (fictional)" } });
  });
  it("saves identifiers trimmed, with leading zeros kept, and refuses one that is too long before calling the database", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveAccountProfile({ error: null }, fd({ orgId: ORG, companyId: CO, name: "Fictional Aurora", vatTrn: "  00123456  ", tradeLicence: "0045" }));
    expect(rpc).toHaveBeenNthCalledWith(1, "crm_update_organisation", { p_org: ORG, p_patch: expect.objectContaining({ vat_trn: "00123456", trade_licence_no: "0045" }) });
    rpc.mockClear();
    expect((await saveAccountProfile({ error: null }, fd({ orgId: ORG, companyId: CO, name: "Fictional Aurora", vatTrn: "9".repeat(41) }))).error).toMatch(/at most 40/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects an unknown role or country before calling the database", async () => {
    expect((await saveAccountProfile({ error: null }, fd({ orgId: ORG, companyId: CO, name: "X", roles: ["sponsor"] }))).error).toMatch(/roles/);
    expect((await saveAccountProfile({ error: null }, fd({ orgId: ORG, companyId: CO, name: "X", country: "Atlantis" }))).error).toMatch(/not recognised/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("creates an account from the name alone, and refuses an owner choice from someone without the assign owners right", async () => {
    grants = [{ companyId: CO, capabilities: [] }];
    expect(await createAccount({ error: null }, fd({ companyId: CO, name: "Fictional Imported Co" }))).toEqual({ error: null, id: "new-id" });
    expect(rpc).toHaveBeenCalledWith("crm_create_organisation_profile", expect.objectContaining({ p_name: "Fictional Imported Co", p_roles: [], p_owner_id: null, p_company_id: CO }));
    rpc.mockClear();
    expect((await createAccount({ error: null }, fd({ companyId: CO, name: "X", ownerId: SARA }))).error).toMatch(/Only a founder/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires a name", async () => {
    expect((await createAccount({ error: null }, fd({ companyId: CO, name: "  " }))).error).toMatch(/name/i);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("a dated follow-up on an account with no inquiry", () => {
  const form = (over: Record<string, string> = {}) => fd({ orgId: ORG, companyId: CO, title: "Call the account", date: "2026-12-01", time: "10:30", ...over });
  it("calls only the account follow-up function (never an owner function), with a Dubai due time, for the selected company", async () => {
    grants = [{ companyId: CO, capabilities: [] }];
    expect(await createAccountFollowUp({ error: null }, form({ assignedTo: SARA }))).toEqual({ error: null });   // SARA is the signed-in test user: their own list
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["crm_create_account_follow_up"]);
    expect(rpc).toHaveBeenCalledWith("crm_create_account_follow_up", { p_org: ORG, p_company: CO, p_title: "Call the account", p_due_at: "2026-12-01T06:30:00.000Z", p_kind: "other", p_assigned_to: SARA });
  });
  it("giving it to someone else is refused on the server without the assign owners right, and not with a right held for another company", async () => {
    grants = [{ companyId: CO, capabilities: [] }];
    expect((await createAccountFollowUp({ error: null }, form({ assignedTo: OMAR }))).error).toMatch(/Only a founder/);
    grants = [{ companyId: OTHER, capabilities: ["founder"] }];
    expect((await createAccountFollowUp({ error: null }, form({ assignedTo: OMAR }))).error).toMatch(/Only a founder/);
    expect(rpc).not.toHaveBeenCalled();
    grants = [{ companyId: CO, capabilities: ["assign_owner"] }];
    expect(await createAccountFollowUp({ error: null }, form({ assignedTo: OMAR }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_create_account_follow_up", expect.objectContaining({ p_assigned_to: OMAR }));
  });
  it("needs a title and a date, and shows the database's refusals in words (company boundary, ineligible assignee)", async () => {
    grants = [{ companyId: CO, capabilities: ["assign_owner"] }];
    expect((await createAccountFollowUp({ error: null }, form({ title: " " }))).error).toMatch(/Say what to do/);
    expect((await createAccountFollowUp({ error: null }, form({ date: "" }))).error).toMatch(/Choose a date/);
    rpc.mockResolvedValue({ data: null, error: { message: "You do not have Sales access for this company" } });
    expect((await createAccountFollowUp({ error: null }, form())).error).toMatch(/Sales access for this company/);
    rpc.mockResolvedValue({ data: null, error: { message: "The assignee has no Sales access for this company" } });
    expect((await createAccountFollowUp({ error: null }, form({ assignedTo: OMAR }))).error).toMatch(/assignee has no Sales access/);
  });
});
