import { describe, expect, it } from "vitest";
import {
  BUDGETARY_NOTICE, ESTIMATE_FORMAT_MARKER, ESTIMATE_NOTICES, UNSECTIONED_TITLE, calculateQuotation, clausesToNotes, estimateFormatVersion, estimateNumbering,
  isEstimateFormat, isUnsectionedTitle, addressLines, normaliseWebsiteUrl, salesContact, lineDisplayNumber, noteParagraphs, notesToClauses, reviewPricingSentence, sectionDisplayNumber, unsectionedFirst, validateClientNotes,
} from "../src";

describe("the mandatory budgetary notice", () => {
  it("is the owner's wording, exactly, in every format version", () => {
    expect(BUDGETARY_NOTICE).toBe("This is a budgetary estimate for planning purposes only. It is not a quotation or an offer, does not reserve any equipment, stock or dates, and is not an agreement to supply. Prices and availability are subject to review and written confirmation.");
    expect(ESTIMATE_NOTICES[1]).toBe(BUDGETARY_NOTICE);
  });
  it("is recognised only by the server-set marker, never by anything else", () => {
    expect(estimateFormatVersion(ESTIMATE_FORMAT_MARKER)).toBe(2);
    expect(estimateFormatVersion("estimate-format:1")).toBe(1);
    expect(isEstimateFormat("estimate-format:1")).toBe(true);
    for (const v of [null, undefined, "", "Standard terms (working draft, pending legal review)", "estimate-format:3", "estimate-format:0", "estimate-format:", " estimate-format:1", "estimate-format:1 "]) expect(isEstimateFormat(v)).toBe(false);
  });
  it("review pricing is never worded as a guarantee", () => {
    expect(reviewPricingSentence("2026-12-31")).toBe("Pricing to be reviewed after 2026-12-31. This is not a price guarantee.");
    expect(reviewPricingSentence("2026-12-31")).not.toMatch(/valid|guarantee(d)? until|honou?r/i);
  });
});

describe("client notes", () => {
  it("round-trip through the two reserved clauses; empty notes are not stored; other clauses never reach a client file", () => {
    expect(notesToClauses({ assumptions: "  A1\n\nA2 ", nextSteps: "" })).toEqual([{ title: "Assumptions", body: "A1\n\nA2" }]);
    expect(notesToClauses({ assumptions: "", nextSteps: "" })).toEqual([]);
    const stored = [{ title: "Start of work", body: "Work begins after written acceptance of the quotation." }, { title: "Next steps", body: "Review the budget." }];
    expect(clausesToNotes(stored)).toEqual({ assumptions: "", nextSteps: "Review the budget." });
    expect(clausesToNotes(null)).toEqual({ assumptions: "", nextSteps: "" });
  });
  it("splits paragraphs on blank lines and keeps single line breaks inside a paragraph", () => {
    expect(noteParagraphs("One\nstill one\n\n\n  Two \r\n\r\nThree")).toEqual(["One\nstill one", "Two", "Three"]);
    expect(noteParagraphs("   ")).toEqual([]);
  });
  it("refuses a note over the database limit", () => {
    expect(validateClientNotes({ assumptions: "x".repeat(3000), nextSteps: "" })).toBeNull();
    expect(validateClientNotes({ assumptions: "x".repeat(3001), nextSteps: "" })).toMatch(/Assumptions are too long/);
    expect(validateClientNotes({ assumptions: "", nextSteps: "x".repeat(3001) })).toMatch(/Next steps are too long/);
  });
});

describe("numbering with optional sections", () => {
  it("sectioned only: identical to the historical numbering (1.1, 1.2, 2.1; 1.10 stays text)", () => {
    const n = estimateNumbering([{ unsectioned: false, lineCount: 2 }, { unsectioned: false, lineCount: 1 }]);
    expect(n).toEqual({ section: ["1", "2"], lines: [["1.1", "1.2"], ["2.1"]] });
    expect(n.lines[0]).toEqual([lineDisplayNumber(0, 0), lineDisplayNumber(0, 1)]);
    expect(n.section[1]).toBe(sectionDisplayNumber(1));
    expect(estimateNumbering([{ unsectioned: false, lineCount: 10 }]).lines[0]![9]).toBe("1.10");
  });
  it("unsectioned only: 1, 2, 3 and no section number", () => {
    expect(estimateNumbering([{ unsectioned: true, lineCount: 3 }])).toEqual({ section: [null], lines: [["1", "2", "3"]] });
  });
  it("mixed: loose items come first as 1, 2; titled sections are numbered among themselves with 1.1, 1.2, 2.1", () => {
    const n = estimateNumbering([{ unsectioned: true, lineCount: 2 }, { unsectioned: false, lineCount: 2 }, { unsectioned: false, lineCount: 1 }]);
    expect(n).toEqual({ section: [null, "1", "2"], lines: [["1", "2"], ["1.1", "1.2"], ["2.1"]] });
  });
  it("the hidden default section is recognised case-insensitively and always sorted first", () => {
    expect(isUnsectionedTitle(UNSECTIONED_TITLE)).toBe(true);
    expect(isUnsectionedTitle("  (No Section) ")).toBe(true);
    expect(isUnsectionedTitle("Fabrication")).toBe(false);
    expect(unsectionedFirst([{ title: "AV" }, { title: UNSECTIONED_TITLE }, { title: "Stage" }]).map((s) => s.title)).toEqual([UNSECTIONED_TITLE, "AV", "Stage"]);
  });
  it("calculateQuotation numbers a mixed estimate the same way and totals include the loose items", () => {
    const q = calculateQuotation({
      currency: "AED", vat: { kind: "rate", rate: "5", label: "5%" },
      sections: [
        { title: UNSECTIONED_TITLE, unsectioned: true, lines: [{ quantity: 1, unitPrice: 100 }, { quantity: 2, unitPrice: 50 }] },
        { title: "AV", lines: [{ quantity: 1, unitPrice: 10 }] },
      ],
    });
    expect(q.sections.flatMap((s) => s.lines.map((l) => l.number))).toEqual(["1", "2", "1.1"]);
    expect(q.sections[0]!.unsectioned).toBe(true);
    expect(q.sections[1]!.unsectioned).toBeUndefined();
    expect([q.net, q.vat, q.gross]).toEqual(["210.00", "10.50", "220.50"]);
  });
});

describe("issuer branding: sales enquiries line, website link, address lines", () => {
  it("normalises a website to an absolute https URL (fictional values)", () => {
    expect(normaliseWebsiteUrl("www.fictional.example")).toBe("https://www.fictional.example");
    expect(normaliseWebsiteUrl("https://www.fictional.example")).toBe("https://www.fictional.example");
    expect(normaliseWebsiteUrl("  HTTP://www.fictional.example/en ")).toBe("https://www.fictional.example/en");
    expect(normaliseWebsiteUrl("www.fictional.example:8443/x")).toBe("https://www.fictional.example:8443/x");
  });
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "ftp://files.fictional.example", "mailto:a@fictional.example", "//www.fictional.example", "https://user:pw@www.fictional.example", "www.fictional example", "localhost", "https://", "", "   ", null, undefined])("never links %j", (v) => {
    expect(normaliseWebsiteUrl(v as string)).toBeNull();
  });
  it("builds the sales line from what is stored, omitting missing parts and their separators", () => {
    const all = salesContact({ phone: "+000 11 222333", email: "sales@fictional.example", website: "www.fictional.example" })!;
    expect(all.text).toBe("Sales enquiries: +000 11 222333 \u00b7 sales@fictional.example \u00b7 www.fictional.example");
    expect(all.parts.map((p) => p.href)).toEqual([null, null, "https://www.fictional.example"]);
    expect(salesContact({ phone: " +000 ", email: null, website: "www.fictional.example" })!.text).toBe("Sales enquiries: +000 \u00b7 www.fictional.example");
    expect(salesContact({ phone: null, email: "", website: "  " })).toBeNull();
    expect(salesContact({ email: "a@fictional.example" })!.text).toBe("Sales enquiries: a@fictional.example");
    const unsafe = salesContact({ website: "javascript:alert(1)" })!;
    expect(unsafe.text).toBe("Sales enquiries: javascript:alert(1)");
    expect(unsafe.parts[0]!.href).toBeNull();
  });
  it("keeps the address lines as stored", () => {
    expect(addressLines("Line one\r\n  Line two  \n\n")).toEqual(["Line one", "Line two"]);
    expect(addressLines(null)).toEqual([]);
  });
});
