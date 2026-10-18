import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
class Redirect extends Error { constructor(public to: string) { super(`redirect:${to}`); } }
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirect(to); } }));
const rpc = vi.fn();
// `current` is the version the (mocked) database holds for the enquiry; null = no such row, so the stale check stays silent.
let current: number | null = null;
const from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: current === null ? null : { version: current } }) }) }) });
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { friendlyCrmError } from "@/lib/crm/errors";
import {
  addLink, checkDuplicates, completeFollowUp, createAndLinkContact, createOpportunity, grantCrmAccess, linkContact, markWon, moveStage, reopenOpportunity,
  saveCrmSettings, unlinkContact, updateContact, updateOpportunity,
} from "./crm";

const U = "33333333-3333-4333-8333-333333333333";
const C = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const fd = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const base = { companyId: C, title: "Floor projection", source: "agency_call", agencyOrgId: O, nextTitle: "Call agency", nextDate: "2026-10-20", nextTime: "11:00" };

beforeEach(() => { current = null; rpc.mockReset().mockResolvedValue({ data: "new-id", error: null }); });

describe("friendlyCrmError", () => {
  it("never shows raw database wording for permission and constraint failures", () => {
    expect(friendlyCrmError('permission denied for table crm_opportunities')).toBe("You are not allowed to do that.");
    expect(friendlyCrmError('new row violates row-level security policy')).toBe("You are not allowed to do that.");
    expect(friendlyCrmError('violates check constraint "crm_files_file_shape"')).toMatch(/not allowed/);
    expect(friendlyCrmError("Only the owner of this opportunity or a founder can do this")).toMatch(/Only the owner/);
    expect(friendlyCrmError("TimeoutError: The operation was aborted due to timeout")).toMatch(/did not finish in time/);
  });
});

describe("createOpportunity", () => {
  it("requires an agency or an end client", async () => {
    const r = await createOpportunity({ error: null }, fd({ ...base, agencyOrgId: "" }));
    expect(r.error).toMatch(/agency, an end client/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires a next action with a date", async () => {
    expect((await createOpportunity({ error: null }, fd({ ...base, nextTitle: "" }))).error).toMatch(/next action/);
    expect((await createOpportunity({ error: null }, fd({ ...base, nextDate: "" }))).error).toMatch(/date of the next action/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the next action as a UTC instant converted from Dubai time, then redirects to the opportunity", async () => {
    await expect(createOpportunity({ error: null }, fd(base))).rejects.toThrow("redirect:/sales/opportunities/new-id");
    expect(rpc).toHaveBeenCalledWith("crm_create_opportunity", expect.objectContaining({ p_next_due: "2026-10-20T07:00:00.000Z", p_agency_org_id: O, p_client_org_id: null, p_owner_id: null }));
  });
  it("passes another quotation currency and parses technologies", async () => {
    await expect(createOpportunity({ error: null }, fd({ ...base, currency: "usd", technologies: JSON.stringify([{ name: "LED", qty: "2" }]) }))).rejects.toThrow(/redirect/);
    expect(rpc).toHaveBeenCalledWith("crm_create_opportunity", expect.objectContaining({ p_currency: "usd", p_technologies: [{ name: "LED", qty: 2 }] }));
  });
  it("rejects malformed technologies and a bad currency", async () => {
    expect((await createOpportunity({ error: null }, fd({ ...base, technologies: "not json" }))).error).toBeTruthy();
    expect((await createOpportunity({ error: null }, fd({ ...base, currency: "DIRHAM" }))).error).toMatch(/3-letter/);
  });
  it("turns the database's refusal into a plain sentence and does not redirect", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function crm_create_opportunity" } });
    expect(await createOpportunity({ error: null }, fd(base))).toEqual({ error: "You are not allowed to do that." });
  });
});

describe("updateOpportunity", () => {
  it("sends only the fields present, clearing empty ones, with the version the user saw", async () => {
    const r = await updateOpportunity({ error: null }, fd({ id: O, expectedVersion: "4", value: "90000", payment_terms: "" }));
    expect(r.error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("crm_update_opportunity", { p_id: O, p_expected_version: 4, p_patch: { value: 90000, payment_terms: null } });
  });
  it("answers a stale edit in words, at once, without calling the database function (which would not answer)", async () => {
    current = 5;
    const r = await updateOpportunity({ error: null }, fd({ id: O, expectedVersion: "4", value: "90000" }));
    expect(r.error).toMatch(/changed by someone else/);
    expect(rpc).not.toHaveBeenCalled();
    expect((await moveStage(O, "qualified", 4)).error).toMatch(/changed by someone else/);
    current = 4;
    expect((await moveStage(O, "qualified", 4)).error).toBeNull();
  });
  it("refuses a negative value and an empty patch", async () => {
    expect((await updateOpportunity({ error: null }, fd({ id: O, value: "-5" }))).error).toMatch(/zero or more/);
    expect((await updateOpportunity({ error: null }, fd({ id: O }))).error).toMatch(/Nothing to save/);
  });
});

describe("stage, won and follow-up actions", () => {
  it("moves stage with the expected version", async () => {
    expect(await moveStage(O, "qualified", 3)).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_move_stage", { p_id: O, p_to: "qualified", p_expected_version: 3 });
    expect((await moveStage("nope", "qualified", 1)).error).toBeTruthy();
  });
  it("won needs a known confirmation type, a reference and a date", async () => {
    expect((await markWon({ error: null }, fd({ id: O, evidenceType: "whatsapp", evidenceReference: "x", evidenceDate: "2026-10-01" }))).error).toBeTruthy();
    expect((await markWon({ error: null }, fd({ id: O, evidenceType: "purchase_order", evidenceReference: "", evidenceDate: "2026-10-01" }))).error).toMatch(/PO number/);
    expect(rpc).not.toHaveBeenCalled();
    await expect(markWon({ error: null }, fd({ id: O, evidenceType: "purchase_order", evidenceReference: "PO-9", evidenceDate: "2026-10-01" }))).rejects.toThrow(/redirect/);
  });
  it("completing needs an outcome and, when asked for a next action or hold, the details", async () => {
    const F = "44444444-4444-4444-8444-444444444444";
    expect((await completeFollowUp({ error: null }, fd({ followUpId: F, outcome: "" }))).error).toMatch(/what came of it/i);
    expect((await completeFollowUp({ error: null }, fd({ followUpId: F, outcome: "Spoke", next: "follow_up" }))).error).toMatch(/next action is and when/);
    expect((await completeFollowUp({ error: null }, fd({ followUpId: F, outcome: "Spoke", next: "hold", holdReason: "x" }))).error).toMatch(/review date/);
    expect(rpc).not.toHaveBeenCalled();
    await completeFollowUp({ error: null }, fd({ followUpId: F, outcome: "Spoke", next: "follow_up", nextTitle: "Send options", nextDate: "2026-10-21", nextTime: "10:00" }));
    expect(rpc).toHaveBeenCalledWith("crm_complete_follow_up", expect.objectContaining({ p_next_title: "Send options", p_next_due: "2026-10-21T06:00:00.000Z", p_hold_reason: null }));
  });
});

describe("links, access and settings", () => {
  it("accepts https links only", async () => {
    expect((await addLink({ error: null }, fd({ id: O, url: "http://insecure.example" }))).error).toMatch(/https/);
    expect((await addLink({ error: null }, fd({ id: O, url: "https://www.canva.com/design/x", purpose: "proposal" }))).error).toBeNull();
  });
  it("drops unknown capabilities before granting access", async () => {
    await grantCrmAccess({ error: null }, fd({ userId: U, companyId: C, capabilities: ["assign_owner", "superuser"] }));
    expect(rpc).toHaveBeenCalledWith("crm_grant_access", expect.objectContaining({ p_capabilities: ["assign_owner"] }));
  });
  it("stores a working calendar only when complete; otherwise leaves it not configured", async () => {
    const common = { companyId: C, referenceCode: "uae", currency: "aed" };
    await saveCrmSettings({ error: null }, fd(common));
    expect(rpc).toHaveBeenLastCalledWith("crm_upsert_settings", expect.objectContaining({ p_reference_code: "UAE", p_default_quote_currency: "AED", p_working_calendar: null, p_response_target_hours: null, p_owner_email_enabled: false, p_approval_policy: null }));
    await saveCrmSettings({ error: null }, fd({ ...common, workdays: ["1", "2"], workStart: "09:00", workEnd: "18:00", responseTargetHours: "4", ownerEmailEnabled: "on" }));
    expect(rpc).toHaveBeenLastCalledWith("crm_upsert_settings", expect.objectContaining({ p_working_calendar: { workdays: [1, 2], start: "09:00", end: "18:00", holidays: [] }, p_response_target_hours: 4, p_owner_email_enabled: true }));
    expect((await saveCrmSettings({ error: null }, fd({ ...common, workdays: ["1"], workStart: "18:00", workEnd: "09:00" }))).error).toMatch(/end after/);
    expect((await saveCrmSettings({ error: null }, fd({ ...common, referenceCode: "u" }))).error).toMatch(/2 to 5/);
  });
});

describe("checkDuplicates", () => {
  it("never flags an enquiry that only shares the agency", async () => {
    rpc.mockResolvedValue({ data: [{ opportunity_id: "o1", company_id: C, reference: "OPP-UAE-2026-0001", title: "Museum guide", stage: "qualified", owner_id: U, agency_org_id: O, client_org_id: null, event_start: "2027-03-01", event_end: null, install_start: null, location: "Abu Dhabi", technologies: [], created_at: "2026-10-01T00:00:00Z" }], error: null });
    expect(await checkDuplicates({ agencyOrgId: O, title: "Floor projection showroom launch", eventStart: "2026-11-24", location: "Dubai Mall" })).toEqual([]);
  });
});

describe("contacts on an opportunity", () => {
  const CT = "55555555-5555-4555-8555-555555555555";
  it("links an existing shared contact with an optional role, and unlinks without deleting anything", async () => {
    expect(await linkContact({ error: null }, fd({ opportunityId: O, contactId: CT, role: "Approver" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_link_contact", { p_opportunity_id: O, p_contact_id: CT, p_role: "Approver" });
    expect(await unlinkContact(O, CT)).toEqual({ error: null });
    expect(rpc).toHaveBeenLastCalledWith("crm_unlink_contact", { p_opportunity_id: O, p_contact_id: CT });
    expect(rpc).not.toHaveBeenCalledWith("crm_update_contact", expect.anything());
    expect((await linkContact({ error: null }, fd({ opportunityId: O, contactId: "nope" }))).error).toBeTruthy();
    expect((await unlinkContact("nope", CT)).error).toBeTruthy();
  });
  it("shows the database's refusal in words", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only the owner of this opportunity or a founder can do this" } });
    expect((await linkContact({ error: null }, fd({ opportunityId: O, contactId: CT }))).error).toMatch(/Only the owner/);
  });
  it("creates a person then links them; if linking is refused it says the contact was still added", async () => {
    rpc.mockResolvedValueOnce({ data: CT, error: null }).mockResolvedValueOnce({ data: null, error: null });
    expect(await createAndLinkContact({ error: null }, fd({ opportunityId: O, name: "Hana", email: "hana@zeta.example", role: "Producer" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenNthCalledWith(1, "crm_create_contact", expect.objectContaining({ p_name: "Hana", p_email: "hana@zeta.example" }));
    expect(rpc).toHaveBeenNthCalledWith(2, "crm_link_contact", { p_opportunity_id: O, p_contact_id: CT, p_role: "Producer" });
    rpc.mockReset().mockResolvedValueOnce({ data: CT, error: null }).mockResolvedValueOnce({ data: null, error: { message: "A lost opportunity can no longer be changed (reopen it first)" } });
    const r = await createAndLinkContact({ error: null }, fd({ opportunityId: O, name: "Omar" }));
    expect(r.error).toMatch(/added to Clients but could not be put on this opportunity.*reopen it first/);
  });
  it("validates a new contact (name, email) before calling the database", async () => {
    expect((await createAndLinkContact({ error: null }, fd({ opportunityId: O, name: "" }))).error).toBeTruthy();
    expect((await createAndLinkContact({ error: null }, fd({ opportunityId: O, name: "A", email: "not-an-email" }))).error).toMatch(/email/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("edits the shared record with only the four editable fields", async () => {
    expect(await updateContact({ error: null }, fd({ contactId: CT, opportunityId: O, name: "Hana A.", roleTitle: "Senior Producer", email: "", phone: "+971 50" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_update_contact", { p_contact_id: CT, p_patch: { name: "Hana A.", role_title: "Senior Producer", email: null, phone: "+971 50" } });
    expect((await updateContact({ error: null }, fd({ contactId: CT, name: "" }))).error).toBeTruthy();
  });
});

describe("reopenOpportunity", () => {
  const base = { id: O, reason: "Client asked to revise the scope", nextTitle: "Call the client", nextDate: "2026-10-21", nextTime: "10:00" };
  it("needs a reason and a new next action with a date before it asks the database", async () => {
    expect((await reopenOpportunity({ error: null }, fd({ ...base, reason: "" }))).error).toMatch(/why it is being reopened/);
    expect((await reopenOpportunity({ error: null }, fd({ ...base, nextTitle: "" }))).error).toMatch(/new next action/);
    expect((await reopenOpportunity({ error: null }, fd({ ...base, nextDate: "" }))).error).toBeTruthy();
    expect((await reopenOpportunity({ error: null }, fd({ ...base, toStage: "won" }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the new next action as a UTC instant from Dubai time, the optional target stage and the version seen", async () => {
    expect(await reopenOpportunity({ error: null }, fd({ ...base, toStage: "negotiation", expectedVersion: "7" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_reopen_opportunity", expect.objectContaining({ p_id: O, p_next_due: "2026-10-21T06:00:00.000Z", p_to_stage: "negotiation", p_expected_version: 7, p_reason: "Client asked to revise the scope" }));
  });
  it("lets the database decide who may reopen and shows its message", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only a founder, or someone a founder gave the reopen right to, can reopen a closed opportunity" } });
    expect((await reopenOpportunity({ error: null }, fd(base))).error).toMatch(/Only a founder/);
  });
});
