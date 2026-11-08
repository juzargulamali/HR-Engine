import { describe, expect, it } from "vitest";
import { calculate, hasValidApproval, issueBlockers, quotationState, type QuotationHeader, type QuotationLineRow, type QuotationSectionRow } from "./model";

const H: QuotationHeader = {
  proposal_id: "p1", opportunity_id: "o1", company_id: "c1", reference: "QUO-FIX-2026-0001", revision: 1, previous_proposal_id: null, currency: null, vat_choice_id: null,
  vat_kind: null, vat_label: null, vat_rate: null, bill_to_org_id: null, validity_date: null, issue_date: null, milestones: [], terms_label: null, terms: [], internal_notes: null,
  content_changed_at: "2026-01-02T00:00:00Z", issued_at: null, issued_by: null,
};
const S: QuotationSectionRow[] = [{ id: "s1", proposal_id: "p1", position: 2, title: "AV" }, { id: "s2", proposal_id: "p1", position: 1, title: "Fabrication" }];
const L = (id: string, section_id: string, position: number, quantity: number | string, unit_price: number | string, extra: Partial<QuotationLineRow> = {}): QuotationLineRow =>
  ({ id, proposal_id: "p1", section_id, position, description: id, image_file_id: null, unit: null, quantity, unit_price, vat_choice_id: null, vat_kind: null, vat_label: null, vat_rate: null, ...extra });

describe("quotation model", () => {
  it("state: draft, awaiting approval, issued, superseded", () => {
    expect(quotationState({ issued_at: null }, "draft", false)).toBe("draft");
    expect(quotationState({ issued_at: null }, "draft", true)).toBe("awaiting_approval");
    expect(quotationState({ issued_at: "x" }, "draft", false)).toBe("issued");
    expect(quotationState({ issued_at: "x" }, "sent", false)).toBe("issued");
    expect(quotationState({ issued_at: "x" }, "superseded", false)).toBe("superseded");
  });
  it("calculates in section then line order whatever the stored order, numbering across the document", () => {
    const h = { ...H, currency: "AED", vat_kind: "rate" as const, vat_label: "5%", vat_rate: 5 };
    const q = calculate(h, S, [L("a", "s1", 1, 7, 0.35), L("b", "s2", 2, "3", "33.33"), L("c", "s2", 1, 1, 10)]);
    expect(q.sections.map((s) => s.title)).toEqual(["Fabrication", "AV"]);
    expect(q.sections.flatMap((s) => s.lines.map((l) => [l.id, l.number]))).toEqual([["c", 1], ["b", 2], ["a", 3]]);
    expect(q.net).toBe("112.44");
  });
  it("lists what blocks issuing, and an approval counts only when given after the last change", () => {
    expect(issueBlockers(H, [], [], [], "not_required", "2026-06-01")).toEqual(["Choose the currency.", "Choose the VAT treatment.", "Choose who the quotation is billed to.", "Add at least one item."]);
    const ready = { ...H, currency: "EUR", vat_kind: "out_of_scope" as const, vat_label: "Out of scope", bill_to_org_id: "org" };
    const lines = [L("a", "s2", 1, 1, 10)];
    expect(issueBlockers(ready, [S[1]!], lines, [], "not_required", "2026-06-01")).toEqual([]);
    expect(issueBlockers(ready, [S[1]!], lines, [], "required", "2026-06-01")[0]).toMatch(/Request a founder/);
    const pending = [{ proposal_id: "p1", state: "pending" as const, decided_at: null, requested_at: "x" }];
    expect(issueBlockers(ready, [S[1]!], lines, pending, "required", "2026-06-01")[0]).toMatch(/Waiting/);
    const early = [{ proposal_id: "p1", state: "approved" as const, decided_at: "2026-01-01T00:00:00Z", requested_at: "x" }];
    const late = [{ proposal_id: "p1", state: "approved" as const, decided_at: "2026-01-03T00:00:00Z", requested_at: "x" }];
    expect(hasValidApproval(H, early)).toBe(false);
    expect(hasValidApproval(H, late)).toBe(true);
    expect(issueBlockers(ready, [S[1]!], lines, late, "required", "2026-06-01")).toEqual([]);
    expect(issueBlockers({ ...ready, validity_date: "2026-01-01" }, [S[1]!], lines, [], "not_required", "2026-06-01")).toEqual(["The validity date is in the past."]);
  });
  it("flags an inconsistent milestone schedule", () => {
    const ready = { ...H, currency: "EUR", vat_kind: "out_of_scope" as const, vat_label: "Out of scope", bill_to_org_id: "org", milestones: [{ label: "a", kind: "percent" as const, value: "60" }] };
    expect(issueBlockers(ready, [S[1]!], [L("a", "s2", 1, 1, 10)], [], "not_required", "2026-06-01")[0]).toMatch(/not 100/);
  });
});
