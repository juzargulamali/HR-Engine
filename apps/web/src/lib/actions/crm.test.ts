import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
class Redirect extends Error { constructor(public to: string) { super(`redirect:${to}`); } }
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirect(to); } }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { friendlyCrmError } from "@/lib/crm/errors";
import {
  addLink, checkDuplicates, completeFollowUp, createOpportunity, grantCrmAccess, markWon, moveStage, saveCrmSettings, updateOpportunity,
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

beforeEach(() => rpc.mockReset().mockResolvedValue({ data: "new-id", error: null }));

describe("friendlyCrmError", () => {
  it("never shows raw database wording for permission and constraint failures", () => {
    expect(friendlyCrmError('permission denied for table crm_opportunities')).toBe("You are not allowed to do that.");
    expect(friendlyCrmError('new row violates row-level security policy')).toBe("You are not allowed to do that.");
    expect(friendlyCrmError('violates check constraint "crm_files_file_shape"')).toMatch(/not allowed/);
    expect(friendlyCrmError("Only the owner of this opportunity or a founder can do this")).toMatch(/Only the owner/);
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
