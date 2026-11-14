/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
const moveStage = vi.fn();
vi.mock("@/lib/actions/crm", () => ({ moveStage: (...a: unknown[]) => moveStage(...a) }));
vi.mock("./[id]/stage-actions", () => ({ CloseDialog: () => <div>close form</div>, HoldDialog: () => <div>hold form</div>, ResumeDialog: () => <div>resume form</div> }));

import { EnquiryBoard, type BoardMeta } from "./enquiry-board";

// A move is rendered through a transition, which React may leave for later when the machine is busy (a full parallel run): the default one second was sometimes too short.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => { cleanup(); moveStage.mockReset(); });

const columns = ["new", "qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"].map((id) => ({ id, label: id }));
const none = { hasSentProposal: false, hasQuoteRef: false, hasSentEstimate: false };
const show = (evidence: BoardMeta["evidence"]) => {
  const meta: Record<string, BoardMeta> = { e1: { stage: "proposal_prep", version: 4, stageBeforeHold: null, valueText: "AED 100", hasValue: true, openFollowUps: 1, evidence } };
  const items = [{ id: "e1", columnId: "proposal_prep", title: "Fictional roadshow room", card: <span>Fictional roadshow room</span>, moveTo: ["qualified", "proposal_sent", "estimate_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"] }];
  render(<EnquiryBoard columns={columns} items={items} meta={meta} />);
};
const move = (to: string) => fireEvent.change(screen.getByLabelText("Move Fictional roadshow room to"), { target: { value: to } });
/**
 * A move has FINISHED when the board announces its outcome: that is set in the same update that lets the next move start. The board ignores a move while
 * another is still pending, so a test that moves again must wait for this, not for something that appears earlier (the refusal text, or the action being called).
 */
const settled = (words: RegExp) => waitFor(() => expect(screen.getByRole("status").textContent).toMatch(words));
const lane = (id: string) => screen.getByRole("heading", { name: new RegExp(`^${id}`) }).closest("section") as HTMLElement;

describe("Enquiries board: a move is checked against the detail page's evidence rules before it is sent", () => {
  it("a move that needs evidence is not sent: the card stays in its lane, says what is missing and links to where it is recorded", async () => {
    show(none);
    move("quote_sent");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Record the Zoho Books quote reference first/));
    expect(moveStage).not.toHaveBeenCalled();
    expect(within(lane("proposal_prep")).getByText("Fictional roadshow room")).toBeTruthy();
    expect(within(lane("quote_sent")).queryByText("Fictional roadshow room")).toBeNull();
    // The reason (the board's alert) and the card's own "Not moved" line are two updates and need not land in the same render: wait for the line itself.
    expect(await screen.findByText(/Not moved to Quote sent/)).toBeTruthy();
    expect(within(lane("proposal_prep")).getByText(/Not moved to Quote sent/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Commercial to record it" }).getAttribute("href")).toBe("/sales/opportunities/e1?tab=commercial");
  });
  it("Proposal sent and Estimate sent each ask for their own record, with their own link", async () => {
    show({ ...none, hasSentProposal: true });
    move("estimate_sent");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Record an estimate as sent first/));
    expect((await screen.findByRole("link", { name: "Open Estimates to record it" })).getAttribute("href")).toBe("/sales/opportunities/e1?tab=quotations");
    expect(moveStage).not.toHaveBeenCalled();
  });
  it("a move whose evidence is recorded, or that needs none, goes to the same action as before; the refusal of an earlier try is gone", async () => {
    moveStage.mockResolvedValue({ error: null });
    show({ ...none, hasSentProposal: true });
    move("quote_sent");
    await settled(/was not moved/);
    expect(await screen.findByText(/Not moved to Quote sent/)).toBeTruthy();
    move("proposal_sent");
    await settled(/moved to proposal_sent/);
    expect(moveStage).toHaveBeenCalledWith("e1", "proposal_sent", 4);
    await waitFor(() => expect(screen.queryByText(/Not moved to/)).toBeNull());
    move("negotiation");
    await waitFor(() => expect(moveStage).toHaveBeenCalledWith("e1", "negotiation", 4));
  });
  it("evidence that could not be read assumes nothing: the move is sent and the database's own refusal is shown, card in place", async () => {
    moveStage.mockResolvedValue({ error: "Record the Zoho Books quote reference before moving to Quote sent" });
    show(null);
    move("quote_sent");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Zoho Books quote reference before moving/));
    expect(moveStage).toHaveBeenCalledWith("e1", "quote_sent", 4);
    expect(within(lane("proposal_prep")).getByText("Fictional roadshow room")).toBeTruthy();
    expect(screen.queryByText(/Not moved to/)).toBeNull();
  });
  it("Hold, Won and Lost still open their forms and send nothing", async () => {
    show(none);
    move("won");
    await waitFor(() => expect(screen.getByText("close form")).toBeTruthy());
    expect(moveStage).not.toHaveBeenCalled();
  });
});
