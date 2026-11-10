import { describe, expect, it } from "vitest";
import { applyWritten, buildDraftPayload, initialDetails, isBlankNewRow, isRowDirty, liveCalc, rowIssue, rowsFromServer, splitRows, type RowState } from "./builder-state";
import type { QuotationHeader, QuotationLineRow, QuotationSectionRow, VatChoiceRow } from "./model";

const H: QuotationHeader = {
  proposal_id: "p1", opportunity_id: "o1", company_id: "c1", reference: "QUO-X-2026-0001", revision: 1, previous_proposal_id: null, currency: null, vat_choice_id: null,
  vat_kind: null, vat_label: null, vat_rate: null, bill_to_org_id: null, validity_date: null, issue_date: null, milestones: [], terms_label: null, terms: [], exclusions: [], internal_notes: null,
  content_changed_at: "2026-01-02T00:00:00Z", issued_at: null, issued_by: null,
};
const VAT5: VatChoiceRow = { id: "v5", company_id: "c1", label: "5%", kind: "rate", rate: 5, position: 1, active: true };
const row = (o: Partial<RowState> = {}): RowState => ({ key: "new-1", id: null, sectionId: null, description: "Stage deck", unit: "m2", quantity: "3", unitPrice: "33.33", vatChoiceId: "", saved: null, ...o });
const SECS: QuotationSectionRow[] = [{ id: "sx", proposal_id: "p1", position: 1, title: "(no section)" }, { id: "s1", proposal_id: "p1", position: 2, title: "AV" }];

describe("builder rows", () => {
  it("a blank new row is ignored; a new row with text is dirty; a saved row is dirty only when a field changed", () => {
    expect(isBlankNewRow(row({ description: "", quantity: "", unitPrice: "" }))).toBe(true);
    expect(isRowDirty(row({ description: "", quantity: "", unitPrice: "" }))).toBe(false);
    expect(isRowDirty(row())).toBe(true);
    const saved = row({ id: "l1", key: "l1", saved: { description: "Stage deck", unit: "m2", quantity: "3", unitPrice: "33.33", vatChoiceId: "" } });
    expect(isRowDirty(saved)).toBe(false);
    expect(isRowDirty({ ...saved, unitPrice: "34" })).toBe(true);
  });
  it("says what is wrong with a row in words: description, quantity above zero, price zero or more", () => {
    expect(rowIssue(row({ description: " " }))).toMatch(/Describe/);
    for (const q of ["0", "-1", "abc", "1e3", ""]) expect(rowIssue(row({ quantity: q })), q).toMatch(/Quantity/);
    for (const p of ["-5", "abc", ""]) expect(rowIssue(row({ unitPrice: p })), p).toMatch(/unit price/);
    expect(rowIssue(row({ unitPrice: "0" }))).toBeNull();
    expect(rowIssue(row())).toBeNull();
  });
  it("rows from the server: items of the hidden default section have no section, everything is clean, loose items come first", () => {
    const lines = [
      { id: "b", proposal_id: "p1", section_id: "s1", position: 1, description: "LED wall", image_file_id: null, unit: null, quantity: "7", unit_price: "0.35", vat_choice_id: null, vat_kind: null, vat_label: null, vat_rate: null },
      { id: "a", proposal_id: "p1", section_id: "sx", position: 1, description: "Loose", image_file_id: null, unit: "pcs", quantity: 2, unit_price: 5, vat_choice_id: "v5", vat_kind: null, vat_label: null, vat_rate: null },
    ] as QuotationLineRow[];
    const rows = rowsFromServer(lines, SECS);
    expect(rows.map((r) => [r.id, r.sectionId])).toEqual([["a", null], ["b", "s1"]]);
    expect(rows.every((r) => !isRowDirty(r))).toBe(true);
    expect(rows[0]).toMatchObject({ quantity: "2", unitPrice: "5", vatChoiceId: "v5" });
  });
});

describe("live figures", () => {
  it("unsectioned rows are numbered 1, 2; sectioned 1.1; totals use the shared calculation with the chosen VAT", () => {
    const rows = [row({ key: "k1" }), row({ key: "k2", description: "Second", quantity: "1", unitPrice: "10" }), row({ key: "k3", sectionId: "s1", description: "LED", quantity: "7", unitPrice: "0.35" })];
    const vat = { kind: "rate" as const, rate: "5", label: "5%" };
    const { calc, numbers } = liveCalc(rows, SECS, "EUR", vat, [VAT5]);
    expect([numbers.get("k1"), numbers.get("k2"), numbers.get("k3")]).toEqual(["1", "2", "1.1"]);
    expect([calc.net, calc.vat, calc.gross]).toEqual(["112.44", "5.62", "118.06"]);
    expect(calc.currency).toBe("EUR");
  });
  it("a row that cannot be calculated yet counts as zero instead of breaking the page, a per-row VAT choice is honoured, and no VAT chosen shows no VAT", () => {
    const bad = row({ key: "bad", quantity: "abc", unitPrice: "1" });
    const { calc } = liveCalc([bad, row({ key: "ok", quantity: "1", unitPrice: "100", vatChoiceId: "v5" })], SECS, "AED", null, [VAT5]);
    expect(calc.net).toBe("100.00");
    expect(calc.vat).toBe("5.00");
    expect(calc.vatChosen).toBe(false);
    const none = liveCalc([], SECS, "", null, []);
    expect(none.calc.gross).toBe("0.00");
  });
});

describe("Save draft payload and its outcome", () => {
  const notes = { internalNotes: "", assumptions: "", nextSteps: "", exclusions: [], milestones: [] };
  const d = initialDetails(H, "org-a", "EUR");
  it("sends only new or changed rows, the typed details (the suggested recipient and currency included), blank rows never", () => {
    const clean = row({ key: "l1", id: "l1", saved: { description: "Stage deck", unit: "m2", quantity: "3", unitPrice: "33.33", vatChoiceId: "" } });
    const p = buildDraftPayload({ opportunityId: "o1", proposalId: "p1" }, d, notes, [clean, row(), row({ key: "new-2", description: "", quantity: "", unitPrice: "" })]);
    expect(p.details).toEqual({ billToOrgId: "org-a", currency: "EUR", vatChoiceId: null, reviewPricingAfter: null });
    expect(p.lines.map((l) => l.key)).toEqual(["new-1"]);
  });
  const payloadOf = (rows: RowState[]) => buildDraftPayload({ opportunityId: "o1", proposalId: "p1" }, d, notes, rows);
  it("after a save a new row takes its id but KEEPS its key (no remount, no lost focus); a blank new row stays untouched", () => {
    const rows = [row(), row({ key: "new-2", description: "", quantity: "", unitPrice: "" })];
    const next = applyWritten(rows, payloadOf(rows).lines, { "new-1": "L9" });
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: "L9", key: "new-1" });
    expect(isRowDirty(next[0]!)).toBe(false);
    expect(next[1]).toMatchObject({ id: null, key: "new-2" });
  });
  it("the baseline is what was SENT: an edit typed while the save was running is still unsaved afterwards", () => {
    const sentRows = [row({ key: "a", quantity: "3" })];
    const sent = payloadOf(sentRows).lines;
    const typedMeanwhile = [row({ key: "a", quantity: "30" })];
    const next = applyWritten(typedMeanwhile, sent, { a: "L1" });
    expect(next[0]).toMatchObject({ id: "L1", quantity: "30" });
    expect(isRowDirty(next[0]!)).toBe(true);
    expect(payloadOf(next).lines.map((l) => [l.key, l.id, l.quantity])).toEqual([["a", "L1", "30"]]);
  });
  it("after a PARTLY failed save only the rows the server wrote get ids, so saving again cannot create them twice", () => {
    const rows = [row({ key: "a" }), row({ key: "b", description: "Second" })];
    const next = applyWritten(rows, payloadOf(rows).lines, { a: "L1" });
    expect(next[0]).toMatchObject({ id: "L1" });
    expect(isRowDirty(next[0]!)).toBe(false);
    expect(next[1]).toMatchObject({ id: null, key: "b" });
    expect(payloadOf(next).lines.map((l) => [l.key, l.id])).toEqual([["b", null]]);
  });
  it("incomplete changed rows are set aside (kept on screen with a sentence) and the complete ones are ready; unchanged rows are neither", () => {
    const clean = row({ key: "l1", id: "l1", saved: { description: "Stage deck", unit: "m2", quantity: "3", unitPrice: "33.33", vatChoiceId: "" } });
    const half = row({ key: "half", description: "Truss", quantity: "", unitPrice: "" });
    const blank = row({ key: "blank", description: "", quantity: "", unitPrice: "" });
    const r = splitRows([clean, half, row({ key: "ok" }), blank]);
    expect(r.incomplete.map((x) => x.row.key)).toEqual(["half"]);
    expect(r.incomplete[0]!.issue).toMatch(/Quantity/);
    expect(r.ready.map((x) => x.key)).toEqual(["l1", "ok", "blank"]);
    expect(payloadOf(r.ready).lines.map((l) => l.key)).toEqual(["ok"]);
  });
});
