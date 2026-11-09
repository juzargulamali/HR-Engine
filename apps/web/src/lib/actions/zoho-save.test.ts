import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
const rpc = vi.fn();
let fromCalls = 0;
const from = () => { fromCalls += 1; return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }; };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { saveZohoReference } from "./crm";
import { ZOHO_SAVE_UNAVAILABLE } from "@/lib/crm/zoho-save";

const O = "22222222-2222-4222-8222-222222222222";
const SEEN = { seen_quoteRef: "QT-1", seen_quoteSentOn: "2026-11-02", seen_invoiceRef: "INV-1", seen_invoiceIssuedOn: "", seen_paymentReceivedOn: "", seen_paidAmount: "" };
const SAME = { quoteRef: "QT-1", quoteSentOn: "2026-11-02", invoiceRef: "INV-1", invoiceIssuedOn: "", paymentReceivedOn: "", paidAmount: "" };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries({ id: O, ...SEEN, ...SAME, ...o })) f.append(k, v); return f; };
const missing = { error: { code: "PGRST202", message: "Could not find the function public.crm_save_zoho_reference(p_expected, p_fields, p_opportunity_id) in the schema cache" } };
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: null, error: null }); fromCalls = 0; });

describe("saving the Zoho Books references", () => {
  it("sends ONLY the field that changed, with the value seen, to the merge function", async () => {
    expect(await saveZohoReference({ error: null }, fd({ invoiceRef: "INV-2" }))).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("crm_save_zoho_reference", { p_opportunity_id: O, p_fields: { invoice_ref: "INV-2" }, p_expected: { invoice_ref: "INV-1" } });
  });
  it("an emptied field is sent as an explicit clear; the untouched ones are not sent at all", async () => {
    await saveZohoReference({ error: null }, fd({ quoteRef: "" }));
    expect(rpc).toHaveBeenCalledWith("crm_save_zoho_reference", { p_opportunity_id: O, p_fields: { quote_ref: null }, p_expected: { quote_ref: "QT-1" } });
  });
  it("saving without any change calls nothing and says so", async () => {
    const r = await saveZohoReference({ error: null }, fd({}));
    expect(r.error).toBeNull();
    expect(r.warning).toMatch(/Nothing was changed/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database's own refusal (a stale edit of the same field) and keeps nothing hidden", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "Someone else changed the quote reference since you opened this form. Reload to see their change, then try again." } });
    expect((await saveZohoReference({ error: null }, fd({ quoteRef: "QT-MINE" }))).error).toMatch(/Someone else changed the quote reference/);
  });
  it("refuses a negative amount or a malformed date before calling anything", async () => {
    expect((await saveZohoReference({ error: null }, fd({ paidAmount: "-3" }))).error).toMatch(/zero or more/);
    expect((await saveZohoReference({ error: null }, fd({ invoiceIssuedOn: "31/12/2026" }))).error).toMatch(/valid date/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's refusal to clear a quote reference at Quote sent, Negotiation or Won as it is (a validation refusal, not 'unavailable')", async () => {
    const refusal = "The Zoho Books quote reference cannot be cleared once the enquiry has reached Quote sent (Quote sent, Negotiation, Won, or on hold from one of them). Replace it with the correct reference instead.";
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: refusal } });
    const r = await saveZohoReference({ error: null }, fd({ quoteRef: "" }));
    expect(r.error).toBe(refusal);
    expect(r.error).not.toBe(ZOHO_SAVE_UNAVAILABLE);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  describe("against a database that does not have the save function (app released before the database update): NO fallback", () => {
    const messages: [string, { code?: string; message: string }][] = [
      ["PostgREST PGRST202", missing.error],
      ["Postgres 42883", { code: "42883", message: "function crm_save_zoho_reference(uuid, jsonb, jsonb) does not exist" }],
      ["only the message", { message: "Could not find the function public.crm_save_zoho_reference in the schema cache" }],
    ];
    beforeEach(() => { rpc.mockImplementation(async (name: string) => (name === "crm_save_zoho_reference" ? { data: null, error: messages[0]![1] } : { data: null, error: null })); });
    it.each(messages)("%s: shows 'temporarily unavailable', makes no other call, and does not read or write anything else", async (_n, err) => {
      rpc.mockResolvedValue({ data: null, error: err });
      const r = await saveZohoReference({ error: null }, fd({ invoiceRef: "INV-2" }));
      expect(r).toEqual({ error: ZOHO_SAVE_UNAVAILABLE });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("crm_save_zoho_reference", expect.anything());
      expect(rpc).not.toHaveBeenCalledWith("crm_upsert_zoho_reference", expect.anything());
      expect(fromCalls).toBe(0);
    });
    it("the message says nothing was saved, does not suggest retrying, and differs from a validation refusal and a stale-edit refusal", () => {
      expect(ZOHO_SAVE_UNAVAILABLE).toMatch(/temporarily unavailable/);
      expect(ZOHO_SAVE_UNAVAILABLE).toMatch(/nothing was saved/);
      expect(ZOHO_SAVE_UNAVAILABLE).toMatch(/Trying again will not help/);
      expect(ZOHO_SAVE_UNAVAILABLE).not.toMatch(/could not save|try again\./i);
      expect(ZOHO_SAVE_UNAVAILABLE).not.toMatch(/Someone else changed|cannot be cleared|zero or more|valid date/);
    });
  });
});
