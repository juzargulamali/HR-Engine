import { beforeEach, describe, expect, it, vi } from "vitest";
import { ESTIMATE_FORMAT_MARKER, UNSECTIONED_TITLE } from "@enginious-hr/domain";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
const rpc = vi.fn();
type Res = { data: unknown; error: { message: string } | null };
let tables: Record<string, Res> = {};
/** A chainable, awaitable stand-in for supabase.from(table).select(..).eq(..)[.maybeSingle()]. */
const from = (t: string) => {
  const res = (): Res => tables[t] ?? { data: [], error: null };
  const q: Record<string, unknown> = {};
  Object.assign(q, { select: () => q, eq: () => q, maybeSingle: async () => res(), then: (ok: (r: Res) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad) });
  return q;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

let bundle: unknown;
vi.mock("@/lib/crm/quotations/data", () => ({ loadQuotation: async () => bundle }));
const pinAssets = vi.fn();
vi.mock("@/lib/crm/quotations/pin-assets", () => ({ pinAssets: (...a: unknown[]) => pinAssets(...a) }));

import { createQuotation, decideQuotationApproval, issueQuotation, requestQuotationApproval, saveEstimateDraft, saveQuotationSection, deleteQuotationLine, type EstimateDraftInput } from "./quotations";

const OPP = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";
const L1 = "55555555-5555-4555-8555-555555555555";
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const NOTES = { internalNotes: "", assumptions: "", nextSteps: "", exclusions: [], milestones: [] };
const DETAILS = { billToOrgId: null, currency: null, vatChoiceId: null, reviewPricingAfter: null };
const item = (o: Record<string, unknown> = {}) => ({ key: "k1", id: null, sectionId: S, description: "Stage deck", unit: "m2", quantity: "3", unitPrice: "33.33", vatChoiceId: null, ...o });
const draft = (o: Partial<EstimateDraftInput> = {}): EstimateDraftInput => ({ opportunityId: OPP, proposalId: P, details: DETAILS, notes: NOTES, lines: [], ...o } as EstimateDraftInput);
const calls = (name: string) => rpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
const MARKED = { data: { terms_label: ESTIMATE_FORMAT_MARKER, terms: [] }, error: null };

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: P, error: null });
  tables = { crm_quotations: MARKED, crm_quotation_sections: { data: [], error: null }, crm_quotation_lines: { data: [], error: null } };
  bundle = { header: { opportunity_id: OPP, internal_notes: null }, sections: [], lines: [], files: [], issuer: { logo_path: null } };
  pinAssets.mockReset().mockResolvedValue({ assets: { logo: null, lines: {} } });
});

describe("creating and saving an estimate draft", () => {
  it("creating a draft calls the database function, marks it as an estimate with the standard terms cleared, and opens its editor", async () => {
    await expect(createQuotation({ error: null }, fd({ opportunityId: OPP }))).rejects.toThrow(`REDIRECT:/sales/opportunities/${OPP}/quotations/${P}`);
    expect(rpc).toHaveBeenNthCalledWith(1, "crm_quote_create", { p_opportunity: OPP });
    expect(rpc).toHaveBeenNthCalledWith(2, "crm_quote_save_header", { p_proposal: P, p_patch: { terms_label: ESTIMATE_FORMAT_MARKER, terms: [] } });
  });
  it("a failed clean-up of the copied terms does not lose the new draft (every later save, approval request and finalise repeats it)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rpc.mockResolvedValueOnce({ data: P, error: null }).mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(createQuotation({ error: null }, fd({ opportunityId: OPP }))).rejects.toThrow(/REDIRECT/);
  });
  it("a refusal from the database is shown in words (not the owner / a founder) and no item is attempted", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Only the owner of this opportunity or a founder can do this" } });
    const r = await saveEstimateDraft(draft({ lines: [item()] }));
    expect(r.error).toMatch(/Only the owner/);
    expect(calls("crm_quote_save_line")).toHaveLength(0);
  });
  it("refuses a negative, zero or malformed quantity or price before calling the database, naming the item", async () => {
    for (const bad of [{ quantity: "-1" }, { quantity: "0" }, { quantity: "1e3" }, { unitPrice: "-5" }, { unitPrice: "abc" }, { description: "  " }]) {
      const r = await saveEstimateDraft(draft({ lines: [item(bad)] }));
      expect(r.error).toBeTruthy();
      expect(r.created).toEqual({});
    }
    expect((await saveEstimateDraft(draft({ lines: [item({ unitPrice: "-5" })] }))).error).toMatch(/^Item “Stage deck”: /);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends the details and notes in ONE header call with the format marker, and the item exactly as typed (decimal strings, no float)", async () => {
    const r = await saveEstimateDraft(draft({
      details: { billToOrgId: S, currency: "EUR", vatChoiceId: null, reviewPricingAfter: "2026-12-31" },
      notes: { internalNotes: "team only", assumptions: " One site visit. ", nextSteps: "", exclusions: [{ title: "Civil works", body: "Not included." }], milestones: [{ label: "Instalment 1", kind: "percent", value: "40", due: "" }] },
      lines: [item({ id: L1 })],
    }));
    expect(r).toEqual({ error: null, created: { k1: P } });   // the mocked rpc returns P for the saved item id
    expect(calls("crm_quote_save_header")).toEqual([{
      p_proposal: P,
      p_patch: {
        currency: "EUR", vat_choice_id: null, bill_to_org_id: S, validity_date: "2026-12-31", internal_notes: "team only",
        milestones: [{ label: "Instalment 1", kind: "percent", value: "40", due: null }], exclusions: [{ title: "Civil works", body: "Not included." }],
        terms: [{ title: "Assumptions", body: "One site visit." }], terms_label: ESTIMATE_FORMAT_MARKER,
      },
    }]);
    expect(calls("crm_quote_save_line")).toEqual([{ p_proposal: P, p_line: L1, p_section: S, p_patch: { description: "Stage deck", unit: "m2", quantity: "3", unit_price: "33.33", vat_choice_id: null } }]);
  });
  it("one currency from the short list; an empty choice is a draft left open (null), never a default; notes over the limit are refused", async () => {
    expect((await saveEstimateDraft(draft({ details: { ...DETAILS, currency: "GBP" } }))).error).toMatch(/AED, SAR, PLN, EUR or USD/);
    expect((await saveEstimateDraft(draft({ notes: { ...NOTES, assumptions: "x".repeat(3001) } }))).error).toMatch(/Assumptions are too long/);
    expect((await saveEstimateDraft(draft({ notes: { ...NOTES, exclusions: [{ title: "", body: "x" }] } }))).error).toMatch(/title/);
    expect((await saveEstimateDraft(draft({ notes: { ...NOTES, milestones: [{ label: "", kind: "percent", value: "10" }] } }))).error).toMatch(/label/);
    expect(rpc).not.toHaveBeenCalled();
    expect(await saveEstimateDraft(draft())).toEqual({ error: null, created: {} });
    expect(calls("crm_quote_save_header")[0]).toMatchObject({ p_patch: { currency: null, vat_choice_id: null, bill_to_org_id: null, validity_date: null } });
  });
  it("an item with no section goes into ONE hidden default section, created once and reused; an existing one is reused without creating another", async () => {
    rpc.mockImplementation(async (name: string) => (name === "crm_quote_save_section" ? { data: S, error: null } : { data: L1, error: null }));
    const r = await saveEstimateDraft(draft({ lines: [item({ sectionId: null, key: "a" }), item({ sectionId: null, key: "b", description: "Second" })] }));
    expect(r.error).toBeNull();
    expect(calls("crm_quote_save_section")).toEqual([{ p_proposal: P, p_section: null, p_title: UNSECTIONED_TITLE }]);
    expect(calls("crm_quote_save_line").map((c) => (c as { p_section: string }).p_section)).toEqual([S, S]);
    rpc.mockClear();
    tables.crm_quotation_sections = { data: [{ id: L1, title: "  (No Section) " }, { id: S, title: "AV" }], error: null };
    await saveEstimateDraft(draft({ lines: [item({ sectionId: null })] }));
    expect(calls("crm_quote_save_section")).toHaveLength(0);
    expect(calls("crm_quote_save_line")[0]).toMatchObject({ p_section: L1 });
  });
  it("a failure on one item says it could not save, never claims saved, and returns the ids already written so Save again cannot duplicate them", async () => {
    rpc.mockImplementation(async (name: string, args: { p_patch?: { description?: string } }) =>
      name === "crm_quote_save_line" && args.p_patch?.description === "Bad one" ? { data: null, error: { message: "Quantity must be a number above zero (at most 3 decimals)" } } : { data: L1, error: null });
    const r = await saveEstimateDraft(draft({ lines: [item({ key: "ok" }), item({ key: "bad", description: "Bad one" }), item({ key: "later", description: "Never reached" })] }));
    expect(r.error).toMatch(/^Item “Bad one” could not be saved: /);
    expect(r.created).toEqual({ ok: L1 });
    expect(calls("crm_quote_save_line")).toHaveLength(2);
  });
  it("a finalised estimate cannot be saved: the database's refusal is shown in estimate wording", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "An issued quotation cannot be edited. Create a revision instead." } });
    expect((await saveEstimateDraft(draft())).error).toBe("A finalised estimate cannot be edited. Create a revision instead.");
  });
  it("section names: the reserved hidden-section name is refused", async () => {
    const r = await saveQuotationSection({ error: null }, fd({ opportunityId: OPP, proposalId: P, sectionId: "", title: " (No Section) " }));
    expect(r.error).toMatch(/reserved/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("deleting the last item of the hidden default section removes the empty section so finalising is not blocked", async () => {
    tables.crm_quotation_sections = { data: [{ id: S, title: UNSECTIONED_TITLE }], error: null };
    tables.crm_quotation_lines = { data: [], error: null };
    await deleteQuotationLine(OPP, P, L1);
    expect(calls("crm_quote_delete_line")).toEqual([{ p_line: L1 }]);
    expect(calls("crm_quote_delete_section")).toEqual([{ p_section: S }]);
  });
});

describe("finalising and approval", () => {
  it("finalising is one database call after the format check, and its refusals reach the person in estimate wording", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Choose the VAT treatment before issuing" } });
    expect((await issueQuotation(OPP, P)).error).toBe("Choose the VAT treatment before finalising");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("crm_quote_issue", { p_proposal: P, p_assets: { logo: null, lines: {} } });
  });
  it("an old draft (legacy label, standard terms copied in) is brought into the estimate format BEFORE it is finalised: only the two notes survive", async () => {
    tables.crm_quotations = { data: { terms_label: "Standard terms (working draft, pending legal review)", terms: [{ title: "Start of work", body: "Work begins after written acceptance." }, { title: "Next steps", body: "Review." }] }, error: null };
    await issueQuotation(OPP, P);
    expect(rpc).toHaveBeenNthCalledWith(1, "crm_quote_save_header", { p_proposal: P, p_patch: { terms_label: ESTIMATE_FORMAT_MARKER, terms: [{ title: "Next steps", body: "Review." }] } });
    expect(rpc).toHaveBeenNthCalledWith(2, "crm_quote_issue", expect.anything());
  });
  it("nothing is finalised when the format cannot be checked, or when a picture cannot be pinned", async () => {
    tables.crm_quotations = { data: null, error: { message: "down" } };
    expect((await issueQuotation(OPP, P)).error).toMatch(/Could not check the estimate/);
    expect(rpc).not.toHaveBeenCalled();
    tables.crm_quotations = MARKED;
    pinAssets.mockResolvedValue({ error: "The picture of item 1.1 could not be read from storage, so nothing was finalised." });
    expect((await issueQuotation(OPP, P)).error).toMatch(/item 1\.1/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("finalising only freezes: it calls crm_quote_issue and nothing else (no stage move, no sent status, no follow-up, no reservation)", async () => {
    await issueQuotation(OPP, P);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["crm_quote_issue"]);
  });
  it("approval is requested for THIS version (after the format check) and decided with the hash the screen was rendered with", async () => {
    await requestQuotationApproval(OPP, P);
    expect(rpc).toHaveBeenCalledWith("crm_quote_request_approval", { p_proposal: P });
    await decideQuotationApproval(OPP, P, S, "approved", " ", "abc123");
    expect(rpc).toHaveBeenCalledWith("crm_quote_decide_approval", { p_approval: S, p_state: "approved", p_instruction: null, p_seen_hash: "abc123" });
    rpc.mockResolvedValue({ data: null, error: { message: "This quotation changed after you opened it. Review the latest version; a fresh approval request is needed" } });
    expect((await decideQuotationApproval(OPP, P, S, "approved", "", "old")).error).toBe("This estimate changed after you opened it. Review the latest version; a fresh approval request is needed");
  });
});
