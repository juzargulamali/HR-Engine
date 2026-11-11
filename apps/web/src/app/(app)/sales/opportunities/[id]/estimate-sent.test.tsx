/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/workspace/unsaved", () => ({ useUnsavedChanges: () => undefined }));
vi.mock("@/lib/actions/quotations", () => ({ createQuotation: vi.fn() }));
const recordEstimateSent = vi.fn();
vi.mock("@/lib/actions/crm", () => ({ recordEstimateSent: (...a: unknown[]) => recordEstimateSent(...a) }));
let list: unknown[] = [];
vi.mock("@/lib/crm/quotations/data", () => ({ loadQuotationList: async () => list }));

import type { DetailSection } from "@/lib/crm/data";
import { RecordEstimateSentButton } from "./estimate-sent-form";
import { describeEvent, stageMoveRequirement } from "./helpers";
import { QuotationsPanel } from "./quotations-panel";
import { buildOppView } from "./view";

HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
afterEach(() => { cleanup(); recordEstimateSent.mockReset(); list = []; });

// Fictional data only.
const baseOpp = {
  id: "o1", company_id: "c1", owner_id: "u1", reference: "OPP-X-2026-0001", title: "Fictional launch", stage: "qualified", currency: "AED", value: 100, source: "website", brief: null, created_at: "2026-11-01T00:00:00Z", created_by: "u1",
  stage_changed_at: "2026-11-01T00:00:00Z", first_response_at: null, availability_state: "unverified", availability_covers: null, technologies: [], version: 7, budget_note: null, evidence_type: null, evidence_reference: null, evidence_date: null,
};
const founder = { userId: "u1", grants: [{ companyId: "c1", capabilities: ["founder"] }], companies: [{ id: "c1", name: "Fictional Co", countryCode: "AE", settings: { approval_policy: "not_configured" } }], people: [], personName: () => "Fictional Owner", companyName: () => "Fictional Co" };
const colleague = { ...founder, userId: "u2", grants: [{ companyId: "c1", capabilities: [] }] };
const item = (id: string, revision: number, o: { issued?: boolean; status?: string } = {}) => ({
  header: { proposal_id: id, reference: "EST-X-2026-0001", revision, issued_at: o.issued === false ? null : "2026-11-05T08:00:00Z", issue_date: o.issued === false ? null : "2026-11-05", content_changed_at: "2026-11-04T08:00:00Z", currency: "AED" },
  proposal: { id, version: revision, status: o.status ?? "draft" }, totalGross: null,
});
const panel = async (o: { stage?: string; ctx?: unknown; sends?: unknown[]; installed?: boolean; failed?: DetailSection[] } = {}) => {
  const opp = { ...baseOpp, stage: o.stage ?? "qualified", ...(o.stage === "on_hold" ? { stage_before_hold: "qualified" } : {}) };
  const detail = {
    item: { opp, value: 100, companyName: "Fictional Co", ownerName: "Fictional Owner", agency: null, client: null, nextFollowUp: null, openFollowUps: 0, availability: "unverified" },
    contacts: [], activities: [], followUps: [], events: [], files: [], proposals: [], zoho: null, approvals: [], handover: null, closures: [], estimateSends: o.sends ?? [], estimateSendsInstalled: o.installed ?? true,
  };
  return renderToStaticMarkup(await QuotationsPanel({ view: buildOppView((o.ctx ?? founder) as never, detail as never, new Set(o.failed ?? [])) }) as React.ReactElement);
};
const offers = (h: string) => (h.match(/Record estimate as sent/g) ?? []).length;

describe("Estimates tab: Record estimate as sent", () => {
  it("is offered on a finalised revision only: not on a draft, not on one replaced by a later revision", async () => {
    list = [item("p3", 3, { issued: false }), item("p2", 2), item("p1", 1, { status: "superseded" })];
    const h = await panel();
    expect(offers(h)).toBe(1);
    expect(h).toContain("After you have sent a finalised estimate to the client yourself, record it as sent here.");
    list = [item("p1", 1, { issued: false })];
    expect(offers(await panel())).toBe(0);
  });
  it("shows a recorded revision with its sent date and does not offer it again", async () => {
    list = [item("p2", 2)];
    const h = await panel({ sends: [{ id: "s1", proposal_id: "p2", opportunity_id: "o1", company_id: "c1", reference: "EST-X-2026-0001", revision: 2, sent_on: "2026-11-06", recorded_by: "u1", recorded_at: "2026-11-06T09:00:00Z" }] });
    expect(h).toMatch(/Sent to client 6 Nov 2026/);
    expect(offers(h)).toBe(0);
  });
  it("is not offered to someone who is not the owner or a founder, on a closed enquiry, or when the database does not have it yet", async () => {
    list = [item("p2", 2)];
    expect(offers(await panel({ ctx: colleague }))).toBe(0);
    expect(offers(await panel({ stage: "lost" }))).toBe(0);
    expect(offers(await panel({ stage: "won" }))).toBe(0);
    expect(offers(await panel({ installed: false }))).toBe(0);
  });
  it("a failed read of the records says so and offers nothing (never 'not sent')", async () => {
    list = [item("p2", 2)];
    const h = await panel({ failed: ["estimateSends"] });
    expect(h).toContain("Could not load which estimates were recorded as sent");
    expect(offers(h)).toBe(0);
  });
});

describe("the confirmation", () => {
  const posted = () => Object.fromEntries((recordEstimateSent.mock.calls[0]![1] as FormData).entries());
  const open = (offerMove: boolean, stageNote: string | null = null) => {
    render(<RecordEstimateSentButton proposalId="p2" opportunityId="o1" version={7} label="EST-X-2026-0001 · revision 2" issueDate="2026-11-05" offerMove={offerMove} stageNote={stageNote} />);
    fireEvent.click(screen.getByRole("button", { name: /Record estimate as sent/ }));
  };
  it("asks for the sent date (not before it was finalised, not in the future) and offers the move, ticked, when it is not a step backwards", async () => {
    recordEstimateSent.mockResolvedValue({ error: null });
    open(true);
    const date = screen.getByLabelText("Date it was sent") as HTMLInputElement;
    expect(date.required).toBe(true);
    expect(date.min).toBe("2026-11-05");
    expect(date.max).toBe(date.value);                                   // today, and today is the latest allowed
    expect(screen.getByText(/Enginious OS does not send it\. Finalising or downloading an estimate does not record it as sent/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Move the enquiry to Estimate sent/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(date, { target: { value: "2026-11-06" } });
    fireEvent.click(screen.getByRole("button", { name: "Record as sent" }));
    await waitFor(() => expect(recordEstimateSent).toHaveBeenCalled());
    expect(posted()).toEqual({ proposalId: "p2", opportunityId: "o1", version: "7", sentOn: "2026-11-06", move: "on" });
  });
  it("unticked, it records only; past Estimate sent there is no move to tick and it says the stage stays", async () => {
    recordEstimateSent.mockResolvedValue({ error: null });
    open(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Move the enquiry to Estimate sent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Record as sent" }));
    await waitFor(() => expect(recordEstimateSent).toHaveBeenCalled());
    expect(posted().move).toBeUndefined();
    cleanup();
    open(false, "The enquiry is at Quote sent, so its stage stays as it is. Only the estimate is recorded as sent.");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("note").textContent).toMatch(/Quote sent, so its stage stays as it is/);
  });
  it("a refusal stays on screen in words", async () => {
    recordEstimateSent.mockResolvedValue({ error: "The sent date cannot be before the estimate was finalised (2026-11-05)" });
    open(true);
    fireEvent.click(screen.getByRole("button", { name: "Record as sent" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/before the estimate was finalised/);
    expect(screen.getByLabelText("Date it was sent")).toBeTruthy();
  });
  it("the stage note on the tab follows the stage", async () => {
    list = [item("p2", 2)];
    // The note is passed to the (closed) dialog; the tab offers the action at every open stage.
    for (const stage of ["new", "qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation", "on_hold"]) expect(offers(await panel({ stage })), stage).toBe(1);
  });
});

describe("move hints and history wording", () => {
  it("Estimate sent needs an estimate recorded as sent; the Proposal sent and Quote sent hints are unchanged and independent", () => {
    const none = { hasSentProposal: false, hasQuoteRef: false, hasSentEstimate: false };
    expect(stageMoveRequirement("estimate_sent", none)).toBe("Record an estimate as sent first (Estimates tab).");
    expect(stageMoveRequirement("estimate_sent", { ...none, hasSentEstimate: true })).toBeNull();
    expect(stageMoveRequirement("estimate_sent", { ...none, hasSentProposal: true })).toBe("Record an estimate as sent first (Estimates tab).");   // a sent proposal does not unlock it
    expect(stageMoveRequirement("proposal_sent", { ...none, hasSentEstimate: true })).toBe("Record a proposal as sent first (Proposals & files tab).");   // nor the other way round
    expect(stageMoveRequirement("quote_sent", { ...none, hasSentEstimate: true, hasSentProposal: true })).toBe("Record the Zoho Books quote reference first (Commercial tab).");
    expect(stageMoveRequirement("quote_sent", { ...none, hasQuoteRef: true })).toBeNull();
  });
  it("the timeline names the exact revision and the date, and the stage by its label", () => {
    const name = () => "Someone";
    expect(describeEvent({ kind: "proposal", from_value: null, to_value: "Estimate EST-UAE-2026-0007 rev 2 recorded as sent on 2026-11-06", reason: "p2" }, name)).toBe("Estimate EST-UAE-2026-0007 revision 2 recorded as sent to the client on 2026-11-06.");
    expect(describeEvent({ kind: "stage_changed", from_value: "qualified", to_value: "estimate_sent", reason: null }, name)).toBe("Stage changed from Qualified to Estimate sent.");
    expect(describeEvent({ kind: "proposal", from_value: null, to_value: "EST-UAE-2026-0007 rev 2 issued", reason: null }, name)).toBe("Estimate EST-UAE-2026-0007 revision 2 finalised.");
  });
});
