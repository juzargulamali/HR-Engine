import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
const rpc = vi.fn();
let stored: { data: Record<string, unknown> | null; error: { message: string } | null } = { data: null, error: null };
const from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => stored }) }) });
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { saveZohoReference } from "./crm";

const O = "22222222-2222-4222-8222-222222222222";
const SEEN = { seen_quoteRef: "QT-1", seen_quoteSentOn: "2026-11-02", seen_invoiceRef: "INV-1", seen_invoiceIssuedOn: "", seen_paymentReceivedOn: "", seen_paidAmount: "" };
const SAME = { quoteRef: "QT-1", quoteSentOn: "2026-11-02", invoiceRef: "INV-1", invoiceIssuedOn: "", paymentReceivedOn: "", paidAmount: "" };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries({ id: O, ...SEEN, ...SAME, ...o })) f.append(k, v); return f; };
const missing = { error: { code: "PGRST202", message: "Could not find the function public.crm_save_zoho_reference(p_expected, p_fields, p_opportunity_id) in the schema cache" } };
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: null, error: null }); stored = { data: null, error: null }; });

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

  describe("against a database that does not have the merge function yet (app released first)", () => {
    beforeEach(() => {
      stored = { data: { quote_ref: "QT-1", quote_sent_on: "2026-11-02", invoice_ref: "INV-1", invoice_issued_on: null, payment_received_on: "2026-11-20", paid_amount: 40 }, error: null };
      rpc.mockImplementation(async (name: string) => (name === "crm_save_zoho_reference" ? missing : { data: null, error: null }));
    });
    it("falls back to the old function with the STORED values filled in for every field the person did not change", async () => {
      expect(await saveZohoReference({ error: null }, fd({ invoiceRef: "INV-2" }))).toEqual({ error: null });
      expect(rpc).toHaveBeenLastCalledWith("crm_upsert_zoho_reference", {
        p_opportunity_id: O, p_quote_ref: "QT-1", p_quote_sent_on: "2026-11-02", p_invoice_ref: "INV-2", p_invoice_issued_on: null, p_payment_received_on: "2026-11-20", p_paid_amount: 40,
      });
    });
    it("an intentional clear still clears there (null for that field only)", async () => {
      await saveZohoReference({ error: null }, fd({ quoteRef: "" }));
      expect(rpc).toHaveBeenLastCalledWith("crm_upsert_zoho_reference", expect.objectContaining({ p_quote_ref: null, p_invoice_ref: "INV-1", p_payment_received_on: "2026-11-20", p_paid_amount: 40 }));
    });
    it("refuses a stale edit of the same field instead of overwriting it", async () => {
      stored = { data: { ...stored.data, invoice_ref: "INV-THEIRS" }, error: null };
      const r = await saveZohoReference({ error: null }, fd({ invoiceRef: "INV-2" }));
      expect(r.error).toMatch(/Someone else changed the invoice reference/);
      expect(rpc).not.toHaveBeenCalledWith("crm_upsert_zoho_reference", expect.anything());
    });
    it("does not write if the stored row cannot be read", async () => {
      stored = { data: null, error: { message: "timeout" } };
      expect((await saveZohoReference({ error: null }, fd({ invoiceRef: "INV-2" }))).error).toMatch(/nothing was saved/);
      expect(rpc).not.toHaveBeenCalledWith("crm_upsert_zoho_reference", expect.anything());
    });
  });
});
