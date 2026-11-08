import { describe, expect, it } from "vitest";
import { calculateLine, calculateQuotation, lineDisplayNumber, sectionDisplayNumber, milestoneAmounts, QuotationInputError, validateMilestones, validateQuotationImageMeta } from "../src/quotations";

const rate = (r: string) => ({ kind: "rate" as const, rate: r, label: `${r}%` });
const oos = { kind: "out_of_scope" as const, label: "Out of scope" };

describe("quotation calculation (decimal, no float drift)", () => {
  it("3 x 33.33 is 99.99 and VAT is rounded per line", () => {
    expect(calculateLine("3", "33.33", rate("5"))).toEqual({ net: 9999n, vat: 500n }); // 4.9995 -> 5.00
  });
  it("rounds half up at the minor unit", () => {
    expect(calculateLine("1", "0.005", null).net).toBe(1n); // 0.005 -> 0.01
    expect(calculateLine("0.001", "10", null).net).toBe(1n); // 0.01
    expect(calculateLine("1", "0.0049", null).net).toBe(0n);
    expect(calculateLine("1", "10.10", rate("0.05")).vat).toBe(1n); // 0.00505 -> 0.01
  });
  it("0% and Out of scope both add no VAT but stay distinct choices", () => {
    expect(calculateLine("2", "100", rate("0")).vat).toBe(0n);
    expect(calculateLine("2", "100", oos).vat).toBe(0n);
    const q = calculateQuotation({ currency: "AED", vat: oos, sections: [{ title: "A", lines: [{ quantity: 2, unitPrice: 100 }] }] });
    expect(q.sections[0]!.lines[0]!.vat).toEqual(oos);
    expect(q.vatChosen).toBe(true);
  });
  it("handles high quantities exactly", () => {
    const r = calculateLine("99999999999", "999999999999.9999", rate("100"));
    expect(r.net).toBe((99999999999000n * 9999999999999999n + 50000n) / 100000n);
    expect(r.vat).toBe(r.net);
  });
  it("refuses negative, zero quantity, exponent and junk", () => {
    for (const bad of ["-1", "1e3", "abc", "", "1.2345", "1,5"]) expect(() => calculateLine(bad, "1", null)).toThrow(QuotationInputError);
    expect(() => calculateLine("0", "1", null)).toThrow(QuotationInputError);
    expect(() => calculateLine("1", "-0.01", null)).toThrow(QuotationInputError);
    expect(() => calculateLine(1e21, "1", null)).toThrow(QuotationInputError);
    expect(() => calculateLine("1", "1", rate("101"))).toThrow(QuotationInputError);
  });
  const doc = (order: number[]) => {
    const secs = [
      { title: "Fabrication", lines: [{ quantity: "3", unitPrice: "33.33" }, { quantity: "1.5", unitPrice: "19.99", vat: rate("15") }] },
      { title: "AV", lines: [{ quantity: "7", unitPrice: "0.35" }] },
      { title: "Content", lines: [{ quantity: "1", unitPrice: "1000.005" }] },
    ];
    return calculateQuotation({ currency: "EUR", vat: rate("5"), sections: order.map((i) => secs[i]!) });
  };
  it("numbers lines per section (1.1, 1.2, 2.1 ...) and totals are the sum of rounded lines", () => {
    const q = doc([0, 1, 2]);
    expect(q.sections.flatMap((s) => s.lines.map((l) => l.number))).toEqual(["1.1", "1.2", "2.1", "3.1"]);
    expect([lineDisplayNumber(0, 9), sectionDisplayNumber(11)]).toEqual(["1.10", "12"]);
    expect(q.net).toBe("1132.44"); // 99.99 + 29.99 (1.5 x 19.99 = 29.985) + 2.45 + 1000.01
    expect(q.vat).toBe("59.62");
    expect(q.gross).toBe("1192.06");
    expect(q.sections[0]!.net).toBe("129.98");
  });
  it("totals do not change when sections are reordered", () => {
    const a = doc([0, 1, 2]);
    const b = doc([2, 0, 1]);
    expect([b.net, b.vat, b.gross]).toEqual([a.net, a.vat, a.gross]);
    expect(b.sections[0]!.lines[0]!.number).toBe("1.1");
  });
  it("an unchosen VAT charges nothing and says so", () => {
    const q = calculateQuotation({ currency: null, vat: null, sections: [{ title: "A", lines: [{ quantity: 1, unitPrice: 10 }] }] });
    expect(q.vatChosen).toBe(false);
    expect(q.vat).toBe("0.00");
  });
});

describe("payment milestones", () => {
  it("percentages must add up to 100 and amounts to the total incl. VAT", () => {
    expect(validateMilestones([{ label: "a", kind: "percent", value: "50" }, { label: "b", kind: "percent", value: "50" }], "100.00")).toBeNull();
    expect(validateMilestones([{ label: "a", kind: "percent", value: "50" }, { label: "b", kind: "percent", value: "40.5" }], "100.00")).toMatch(/not 100/);
    expect(validateMilestones([{ label: "a", kind: "amount", value: "60.00" }, { label: "b", kind: "amount", value: "40.01" }], "100.00")).toMatch(/not the total/);
    expect(validateMilestones([{ label: "a", kind: "amount", value: "100" }, { label: "b", kind: "percent", value: "5" }], "100.00")).toMatch(/not both/);
    expect(validateMilestones([], "100.00")).toBeNull();
  });
  it("computes percent amounts with half-up rounding", () => {
    expect(milestoneAmounts([{ label: "a", kind: "percent", value: "33.33" }], "100.02")).toEqual(["33.34"]);
  });
});

describe("quotation pictures", () => {
  it("accepts small images only", () => {
    expect(validateQuotationImageMeta({ name: "a.png", size: 1000, type: "image/png" })).toBeNull();
    expect(validateQuotationImageMeta({ name: "a.pdf", size: 1000, type: "application/pdf" })).toMatch(/JPEG, PNG or WebP/);
    expect(validateQuotationImageMeta({ name: "a.png", size: 6 * 1024 * 1024, type: "image/png" })).toMatch(/5 MB/);
  });
});
