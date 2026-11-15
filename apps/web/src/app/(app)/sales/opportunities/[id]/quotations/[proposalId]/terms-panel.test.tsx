// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BUDGETARY_NOTICE, termsReview } from "@enginious-hr/domain";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
import { TermsPanel } from "./terms-panel";

afterEach(cleanup);
const SIX = ["Site access and readiness", "Site services and other trades", "Changes", "Start of work", "Scope exclusions", "Confidentiality"].map((title) => ({ title, body: `${title} text.` }));
const LABEL = "Standard terms (working draft, pending legal review)";
const QUOTATION = { proposal_id: "p1", revision: 1, termsLabel: LABEL, termClauses: 6 };
const ESTIMATE = { proposal_id: "p1", revision: 1, termsLabel: "estimate-format:2", termClauses: 0 };

describe("where a draft's terms come from", () => {
  it("INHERITED: names the revision they were copied from, lists the clauses, says what replacing them does, and that nothing goes out until confirmed", () => {
    render(<TermsPanel review={termsReview(LABEL, SIX)} revisedFrom={QUOTATION} opportunityId="o1" action={<button type="button">Replace with the current estimate format</button>} />);
    const box = screen.getByTestId("terms-review");
    expect(box.getAttribute("data-terms")).toBe("inherited");
    const t = box.textContent ?? "";
    expect(t).toContain("Inherited.");
    expect(t).toContain("copied from revision 1, which was issued as a quotation before estimates replaced quotations. That revision keeps them exactly as issued.");
    expect(t).toContain(`Label stored with them: ${LABEL}`);
    expect(t).toContain("The 6 carried-over clauses: Site access and readiness, Site services and other trades, Changes, Start of work, Scope exclusions, Confidentiality");
    expect(t).toContain("Removed from this draft: the 6 clauses above and their label.");
    expect(t).toContain(BUDGETARY_NOTICE);
    expect(t).toContain("Not changed: revision 1 and its files.");
    expect(t).toContain("Until this is confirmed, the draft cannot be finalised or sent for approval. Saving the draft does not replace these terms.");
    expect(screen.getByRole("link", { name: "revision 1" }).getAttribute("href")).toBe("/sales/opportunities/o1/quotations/p1");
    expect(screen.getByRole("button", { name: "Replace with the current estimate format" })).toBeTruthy();
    expect(screen.queryByTestId("terms-origin")).toBeNull();
  });
  it("INHERITED, read only: someone who may not change the estimate sees the same facts and no button", () => {
    render(<TermsPanel review={termsReview(LABEL, SIX)} revisedFrom={QUOTATION} opportunityId="o1" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("terms-review").textContent).toContain("Only the enquiry owner or a founder can replace them.");
  });
  it("SELECTED after a quotation: says the current format was chosen in place of that revision's terms, which it keeps", () => {
    render(<TermsPanel review={termsReview("estimate-format:2", [])} revisedFrom={QUOTATION} opportunityId="o1" />);
    const line = screen.getByTestId("terms-origin");
    expect(line.getAttribute("data-terms")).toBe("selected");
    expect(line.textContent).toBe("Terms: current estimate format (selected). It was chosen in place of the terms of revision 1, which was issued as a quotation and keeps its own terms exactly as issued. The client file prints the budgetary estimate notice and no terms clauses.");
    expect(screen.queryByTestId("terms-review")).toBeNull();
  });
  it("SELECTED for a revision of an estimate and for a first draft: nothing was inherited, and it says so", () => {
    render(<TermsPanel review={termsReview("estimate-format:2", [{ title: "Next steps", body: "Review." }])} revisedFrom={ESTIMATE} opportunityId="o1" />);
    expect(screen.getByTestId("terms-origin").textContent).toBe("Terms: current estimate format (selected). The same format as revision 1, which this draft was copied from. The client file prints the budgetary estimate notice and no terms clauses.");
    cleanup();
    render(<TermsPanel review={termsReview("estimate-format:2", [])} revisedFrom={null} opportunityId="o1" />);
    expect(screen.getByTestId("terms-origin").textContent).toBe("Terms: current estimate format (selected). The client file prints the budgetary estimate notice and no terms clauses.");
  });
  it("INHERITED on a first draft that was never marked as an estimate: says they were copied when it was created", () => {
    render(<TermsPanel review={termsReview(LABEL, SIX.slice(0, 1))} revisedFrom={null} opportunityId="o1" />);
    const t = screen.getByTestId("terms-review").textContent ?? "";
    expect(t).toContain("These terms were copied into this draft when it was created.");
    expect(t).toContain("Removed from this draft: the clause above and their label.");
    expect(t).not.toContain("Not changed: revision");
  });
});
