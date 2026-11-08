import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

let bundle: unknown;
vi.mock("@/lib/crm/quotations/data", () => ({ loadQuotation: async () => bundle }));
const pinAssets = vi.fn();
vi.mock("@/lib/crm/quotations/pin-assets", () => ({ pinAssets: (...a: unknown[]) => pinAssets(...a) }));

import { createQuotation, decideQuotationApproval, issueQuotation, requestQuotationApproval, saveQuotationDetails, saveQuotationLine, saveQuotationTerms, saveTermsTemplate } from "./quotations";

const OPP = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";
const CO = "44444444-4444-4444-8444-444444444444";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const line = (o: Record<string, string> = {}) => fd({ opportunityId: OPP, proposalId: P, sectionId: S, lineId: "", description: "Stage deck", unit: "m2", quantity: "3", unitPrice: "33.33", vatChoiceId: "", ...o });

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: P, error: null });
  bundle = { header: { opportunity_id: OPP }, sections: [], lines: [], files: [], issuer: { logo_path: null } };
  pinAssets.mockReset().mockResolvedValue({ assets: { logo: null, lines: {} } });
});

describe("estimate actions", () => {
  it("creating a draft calls the database function and opens its editor", async () => {
    await expect(createQuotation({ error: null }, fd({ opportunityId: OPP }))).rejects.toThrow(`REDIRECT:/sales/opportunities/${OPP}/quotations/${P}`);
    expect(rpc).toHaveBeenCalledWith("crm_quote_create", { p_opportunity: OPP });
  });
  it("a refusal from the database is shown in words (not the owner / a founder)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only the owner of this opportunity or a founder can do this" } });
    expect((await saveQuotationLine({ error: null }, line())).error).toMatch(/Only the owner/);
  });
  it("refuses a negative, zero or malformed quantity or price before calling the database", async () => {
    for (const bad of [{ quantity: "-1" }, { quantity: "0" }, { quantity: "1e3" }, { unitPrice: "-5" }, { unitPrice: "abc" }] as Record<string, string>[]) {
      expect((await saveQuotationLine({ error: null }, line(bad))).error).toBeTruthy();
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the item exactly as typed (decimal strings, no float) with the VAT override or null", async () => {
    expect(await saveQuotationLine({ error: null }, line())).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_quote_save_line", { p_proposal: P, p_line: null, p_section: S, p_patch: { description: "Stage deck", unit: "m2", quantity: "3", unit_price: "33.33", vat_choice_id: null } });
  });
  it("details: one currency from the short list; an empty choice is a draft left open (null), never a default", async () => {
    const base = { opportunityId: OPP, proposalId: P, currency: "", vatChoiceId: "", billToOrgId: "", validityDate: "", internalNotes: "" };
    expect((await saveQuotationDetails({ error: null }, fd({ ...base, currency: "GBP" }))).error).toMatch(/AED, SAR, PLN, EUR or USD/);
    expect(rpc).not.toHaveBeenCalled();
    expect(await saveQuotationDetails({ error: null }, fd(base))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("crm_quote_save_header", { p_proposal: P, p_patch: { currency: null, vat_choice_id: null, bill_to_org_id: null, validity_date: null, internal_notes: "" } });
  });
  it("milestones and clauses must be well formed lists", async () => {
    const ok = fd({ opportunityId: OPP, proposalId: P, milestones: JSON.stringify([{ label: "Deposit", kind: "percent", value: "40", due: "" }]), clauses: JSON.stringify([{ title: "A", body: "B" }]) });
    expect(await saveQuotationTerms({ error: null }, ok)).toEqual({ error: null });
    expect((await saveQuotationTerms({ error: null }, fd({ opportunityId: OPP, proposalId: P, milestones: "[]", clauses: JSON.stringify([{ title: "", body: "x" }]) }))).error).toMatch(/title/);
    expect((await saveQuotationTerms({ error: null }, fd({ opportunityId: OPP, proposalId: P, milestones: "not json", clauses: "[]" }))).error).toBeTruthy();
  });
  it("issuing is one database call and its refusals (VAT missing, approval missing) reach the person", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Choose the VAT treatment before issuing" } });
    expect((await issueQuotation(OPP, P)).error).toBe("Choose the VAT treatment before issuing");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("crm_quote_issue", { p_proposal: P, p_assets: { logo: null, lines: {} } });
  });
  it("issuing pins the pictures first and issues nothing when one cannot be pinned", async () => {
    pinAssets.mockResolvedValue({ error: "The picture of item 1.1 could not be read from storage, so nothing was issued." });
    expect((await issueQuotation(OPP, P)).error).toMatch(/item 1\.1/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("approval is requested for THIS version and decided with the hash the screen was rendered with", async () => {
    await requestQuotationApproval(OPP, P);
    expect(rpc).toHaveBeenCalledWith("crm_quote_request_approval", { p_proposal: P });
    await decideQuotationApproval(OPP, P, S, "approved", " ", "abc123");
    expect(rpc).toHaveBeenCalledWith("crm_quote_decide_approval", { p_approval: S, p_state: "approved", p_instruction: null, p_seen_hash: "abc123" });
    rpc.mockResolvedValue({ data: null, error: { message: "This quotation changed after you opened it. Review the latest version" } });
    expect((await decideQuotationApproval(OPP, P, S, "approved", "", "old")).error).toMatch(/changed after you opened it/);
  });
  it("the company terms template needs at least one clause", async () => {
    expect((await saveTermsTemplate({ error: null }, fd({ companyId: CO, label: "x", clauses: "[]" }))).error).toMatch(/at least one/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
