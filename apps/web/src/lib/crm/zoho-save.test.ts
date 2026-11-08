import { describe, expect, it } from "vitest";
import { diffZohoForm, staleFields, ZOHO_FIELDS } from "./zoho-save";

const seen = { seen_quoteRef: "QT-1", seen_quoteSentOn: "2026-11-02", seen_invoiceRef: "INV-1", seen_invoiceIssuedOn: "", seen_paymentReceivedOn: "", seen_paidAmount: "12.50" };
const same = { quoteRef: "QT-1", quoteSentOn: "2026-11-02", invoiceRef: "INV-1", invoiceIssuedOn: "", paymentReceivedOn: "", paidAmount: "12.5" };

describe("which Zoho fields did the person change", () => {
  it("sends nothing when nothing changed (12.5 equals 12.50, blanks equal empty)", () => {
    expect(diffZohoForm({ ...seen, ...same })).toBeNull();
    expect(diffZohoForm({ ...seen, ...same, invoiceRef: "  INV-1  " })).toBeNull();
  });
  it("sends only the changed field, with the value seen", () => {
    expect(diffZohoForm({ ...seen, ...same, invoiceRef: "INV-2" })).toEqual({ fields: { invoice_ref: "INV-2" }, expected: { invoice_ref: "INV-1" } });
  });
  it("an emptied field is an explicit clear (null), not an omitted one", () => {
    expect(diffZohoForm({ ...seen, ...same, quoteRef: "", paidAmount: "" })).toEqual({ fields: { quote_ref: null, paid_amount: null }, expected: { quote_ref: "QT-1", paid_amount: 12.5 } });
  });
  it("a field that was empty and is filled in is a change", () => {
    expect(diffZohoForm({ ...seen, ...same, paymentReceivedOn: "2026-12-01" })).toEqual({ fields: { payment_received_on: "2026-12-01" }, expected: { payment_received_on: null } });
  });
  it("covers every column", () => {
    expect(ZOHO_FIELDS).toHaveLength(6);
  });
  it("finds the fields somebody else changed meanwhile (old database only)", () => {
    const change = diffZohoForm({ ...seen, ...same, quoteRef: "QT-MINE", invoiceRef: "INV-2" })!;
    expect(staleFields(change, { quote_ref: "QT-1", invoice_ref: "INV-THEIRS" })).toEqual(["invoice_ref"]);
    expect(staleFields(change, { quote_ref: "QT-1", invoice_ref: "INV-1" })).toEqual([]);
    expect(staleFields(change, null)).toEqual(["quote_ref", "invoice_ref"]);
  });
});
