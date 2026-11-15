import { describe, expect, it } from "vitest";
import {
  boardColumnFor, boardColumns, boardMoveCheck, boardMoveKind, boardMoveTargets, installOrShowDate, sortEnquiries, type EnquirySortKey, enquiryNeeds, needCounts, parseNeed,
  ENQUIRY_ALL_COLUMNS, ENQUIRY_DEFAULT_COLUMNS, enquiryCountSentence, enquiryFilterChips, enquiryRowAction,
} from "./enquiry-list";
import { stageMoveRequirement } from "@/app/(app)/sales/opportunities/[id]/helpers";
import type { OpportunityListItem } from "./data";

const item = (id: string, over: Partial<OpportunityListItem["opp"]> & { value?: number | null; due?: string | null; owner?: string; agency?: string | null; client?: string | null } = {}): OpportunityListItem =>
  ({
    opp: {
      id, reference: `OPP-${id}`, title: over.title ?? `Enquiry ${id}`, stage: over.stage ?? "new", currency: over.currency ?? "AED",
      install_start: over.install_start ?? null, event_start: over.event_start ?? null, created_at: over.created_at ?? "2026-01-01T00:00:00Z",
    },
    value: over.value ?? null,
    ownerName: over.owner ?? "Ann",
    agency: over.agency ? { name: over.agency } : null,
    client: over.client ? { name: over.client } : null,
    nextFollowUp: over.due ? { due_at: over.due } : null,
    openFollowUps: 0, companyName: "Co", availability: "unverified",
  }) as unknown as OpportunityListItem;

const ids = (xs: OpportunityListItem[]) => xs.map((x) => x.opp.id);
const sort = (xs: OpportunityListItem[], key: EnquirySortKey, dir: "asc" | "desc" = "asc") => ids(sortEnquiries(xs, { key, dir }));

describe("sortEnquiries", () => {
  const a = item("a", { title: "Zebra wall", due: "2026-05-02T08:00:00Z", owner: "Bo", stage: "qualified", install_start: "2026-06-01", agency: "Zeta" });
  const b = item("b", { title: "Apple tunnel", due: "2026-05-01T08:00:00Z", owner: "Al", stage: "new", event_start: "2026-05-20", client: "Acme" });
  const c = item("c", { title: "Mid", due: null, owner: "Cy", stage: "negotiation" });
  it("sorts by next action due with missing last in both directions", () => {
    expect(sort([a, b, c], "due")).toEqual(["b", "a", "c"]);
    expect(sort([a, b, c], "due", "desc")).toEqual(["a", "b", "c"]);
  });
  it("sorts by title, owner, party and stage order", () => {
    expect(sort([a, b, c], "enquiry")).toEqual(["b", "c", "a"]);
    expect(sort([a, b, c], "owner")).toEqual(["b", "a", "c"]);
    expect(sort([a, b, c], "party")).toEqual(["b", "a", "c"]);          // Acme, Zeta, then none
    expect(sort([a, b, c], "stage")).toEqual(["b", "a", "c"]);          // new, qualified, negotiation
  });
  it("sorts by installation, falling back to the show start", () => {
    expect(installOrShowDate({ install_start: "2026-06-01", event_start: "2026-05-20" })).toBe("2026-06-01");
    expect(installOrShowDate({ install_start: null, event_start: "2026-05-20" })).toBe("2026-05-20");
    expect(sort([a, b, c], "dates")).toEqual(["b", "a", "c"]);
  });
  it("never compares amounts across currencies, and puts unvalued records last", () => {
    const v1 = item("v1", { value: 900, currency: "AED" });
    const v2 = item("v2", { value: 100, currency: "EUR" });
    const v3 = item("v3", { value: 50, currency: "AED" });
    const v4 = item("v4", { value: null });
    expect(sort([v2, v1, v4, v3], "value")).toEqual(["v3", "v1", "v2", "v4"]);
    expect(sort([v2, v1, v4, v3], "value", "desc")).toEqual(["v1", "v3", "v2", "v4"]);
  });
  it("does not change the input", () => {
    const input = [a, b, c];
    sortEnquiries(input, { key: "enquiry", dir: "asc" });
    expect(ids(input)).toEqual(["a", "b", "c"]);
  });
});

describe("board", () => {
  it("has the pipeline stages, then on hold, then won and lost", () => {
    expect(boardColumns().map((c) => c.id)).toEqual(["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);   // Estimate sent is not a lane
    // ... unless an enquiry still holds the retired stage: then it gets its own lane after Proposal sent, labelled as no longer used, so it is shown where it really is.
    expect(boardColumns(["new", "won"]).map((c) => c.id)).not.toContain("estimate_sent");
    expect(boardColumns(["new", "estimate_sent"]).map((c) => c.id)).toEqual(["new", "qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    expect(boardColumns(["estimate_sent"]).find((c) => c.id === "estimate_sent")!.label).toBe("Estimate sent (stage no longer used)");
    expect(boardColumnFor("estimate_sent")).toBe("estimate_sent");
    expect(boardColumnFor("on_hold")).toBe("on_hold");
    expect(boardColumnFor("mystery")).toBe("new");
  });
  it("tells a plain move from one that needs a form", () => {
    expect(boardMoveKind("new", "qualified")).toBe("stage");
    expect(boardMoveKind("new", "on_hold")).toBe("hold");
    expect(boardMoveKind("negotiation", "won")).toBe("won");
    expect(boardMoveKind("negotiation", "lost")).toBe("lost");
    expect(boardMoveKind("on_hold", "qualified")).toBe("resume");
    expect(boardMoveKind("on_hold", "lost")).toBe("lost");
  });
  const base = { stageBeforeHold: null, canEdit: true, ownerName: "Ann" };
  it("offers a working card one step back or any step forward, hold, won and lost", () => {
    expect(boardMoveTargets({ ...base, stage: "qualified" }).moveTo).toEqual(["new", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    expect(boardMoveTargets({ ...base, stage: "new" }).moveTo).toEqual(["qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    // Estimate sent is retired: no card is ever offered it. A card still holding it is not stranded: it moves out like any card at that step, and can be held or closed.
    expect(boardMoveTargets({ ...base, stage: "estimate_sent" }).moveTo).toEqual(["proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    expect(boardMoveTargets({ ...base, stage: "proposal_sent" }).moveTo).toEqual(["proposal_prep", "quote_sent", "negotiation", "on_hold", "won", "lost"]);
    for (const stage of ["new", "qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation"]) expect(boardMoveTargets({ ...base, stage }).moveTo, stage).not.toContain("estimate_sent");
    expect(boardMoveTargets({ ...base, stage: "on_hold", stageBeforeHold: "estimate_sent" }).moveTo).toEqual(["lost"]);      // resuming into it is done from the enquiry's own page
    expect(boardMoveTargets({ ...base, stage: "quote_sent" }).moveTo).toEqual(["proposal_sent", "negotiation", "on_hold", "won", "lost"]);
  });
  it("lets a held card resume into the stage it came from or be lost, never won", () => {
    expect(boardMoveTargets({ ...base, stage: "on_hold", stageBeforeHold: "quote_sent" }).moveTo).toEqual(["quote_sent", "lost"]);
    expect(boardMoveTargets({ ...base, stage: "on_hold", stageBeforeHold: null }).moveTo).toEqual(["lost"]);
    expect(boardMoveTargets({ ...base, stage: "on_hold", stageBeforeHold: "won" }).moveTo).toEqual(["lost"]);
  });
  it("offers nothing for a closed card or to someone who may not edit, and says why", () => {
    const closed = boardMoveTargets({ ...base, stage: "won" });
    expect(closed.moveTo).toEqual([]);
    expect(closed.lockedReason).toMatch(/reopen/i);
    const other = boardMoveTargets({ ...base, stage: "new", canEdit: false, ownerName: "Bo" });
    expect(other.moveTo).toEqual([]);
    expect(other.lockedReason).toContain("Bo");
  });
});

describe("what an enquiry needs now (the quick filters)", () => {
  const NOW = new Date("2026-11-11T08:00:00Z");
  const row = (stage: string, over: { first?: string | null; due?: string | null; open?: number } = {}) => ({
    opp: { stage, first_response_at: over.first === undefined ? "2026-11-01T08:00:00Z" : over.first }, nextFollowUp: over.due ? { due_at: over.due } : null, openFollowUps: over.open ?? (over.due ? 1 : 0),
  });
  it("reads only the recorded follow-up and first response, with the My Day rules", () => {
    expect(enquiryNeeds(row("qualified", { due: "2026-11-05T06:00:00Z" }), NOW)).toEqual(["overdue"]);
    expect(enquiryNeeds(row("qualified", { due: "2026-11-11T12:00:00Z" }), NOW)).toEqual(["due_today"]);
    expect(enquiryNeeds(row("qualified", { due: "2026-11-20T06:00:00Z" }), NOW)).toEqual([]);
    expect(enquiryNeeds(row("new", { first: null, due: "2026-11-20T06:00:00Z" }), NOW)).toEqual(["no_first_response"]);
    expect(enquiryNeeds(row("estimate_sent"), NOW)).toEqual(["no_next_action"]);
    expect(enquiryNeeds(row("new", { first: null }), NOW)).toEqual(["no_first_response", "no_next_action"]);
  });
  it("on hold needs no next action; a closed enquiry needs nothing", () => {
    expect(enquiryNeeds(row("on_hold"), NOW)).toEqual([]);
    expect(enquiryNeeds(row("on_hold", { first: null }), NOW)).toEqual(["no_first_response"]);
    for (const s of ["won", "lost"]) expect(enquiryNeeds(row(s, { first: null, due: "2026-11-01T06:00:00Z" }), NOW)).toEqual([]);
  });
  it("counts each need over the rows given, and only known values are accepted from the address", () => {
    expect(needCounts([row("qualified", { due: "2026-11-05T06:00:00Z" }), row("new", { first: null }), row("negotiation")], NOW)).toEqual({ overdue: 1, due_today: 0, no_first_response: 1, no_next_action: 2 });
    expect(parseNeed("overdue")).toBe("overdue");
    expect(parseNeed("handover")).toBe("");
    expect(parseNeed("anything")).toBe("");
  });
});

describe("the line above the list (enquiryCountSentence)", () => {
  const base = { matched: 6, total: 11, status: "open" as const, companyName: "Fictional UAE", multiCompany: true, narrowed: false, handover: false, scope: null };
  it("default with the breakdown: exact reasons, in words", () => {
    expect(enquiryCountSentence({ ...base, scope: { inCompany: 9, won: 2, lost: 1 } })).toEqual({ shown: "Showing 6 open enquiries in Fictional UAE.", hidden: "5 more are not shown: 2 won and 1 lost in Fictional UAE, 2 in your other companies." });
    expect(enquiryCountSentence({ ...base, total: 9, scope: { inCompany: 9, won: 3, lost: 0 } }).hidden).toBe("3 more are not shown: 3 won in Fictional UAE.");
    expect(enquiryCountSentence({ ...base, matched: 1, total: 2, scope: { inCompany: 1, won: 0, lost: 0 } })).toEqual({ shown: "Showing 1 open enquiry in Fictional UAE.", hidden: "1 more is not shown: 1 in your other companies." });
  });
  it("without the breakdown it names the possible reasons and invents no number", () => {
    expect(enquiryCountSentence(base).hidden).toBe("5 more are won, lost or in your other companies.");
    expect(enquiryCountSentence({ ...base, multiCompany: false }).hidden).toBe("5 more are won or lost.");
    expect(enquiryCountSentence({ ...base, companyName: null })).toEqual({ shown: "Showing 6 open enquiries across all your companies.", hidden: "5 more are won or lost." });
    expect(enquiryCountSentence({ ...base, status: "closed", companyName: null }).hidden).toBe("5 more are open.");
    expect(enquiryCountSentence({ ...base, status: "all" }).hidden).toBe("5 more are in your other companies.");
  });
  it("a breakdown that does not add up to the rest (the two reads raced) is not used", () => {
    expect(enquiryCountSentence({ ...base, scope: { inCompany: 9, won: 1, lost: 1 } }).hidden).toBe("5 more are won, lost or in your other companies.");
    expect(enquiryCountSentence({ ...base, scope: { inCompany: 20, won: 2, lost: 1 } }).hidden).toBe("5 more are won, lost or in your other companies.");
  });
  it("nothing hidden says nothing more; filters say that they decide", () => {
    expect(enquiryCountSentence({ ...base, matched: 11, status: "all", companyName: null })).toEqual({ shown: "Showing all 11 enquiries across all your companies.", hidden: null });
    expect(enquiryCountSentence({ ...base, matched: 3, narrowed: true })).toEqual({ shown: "Showing 3 enquiries in Fictional UAE that match your filters.", hidden: "8 of the 11 enquiries you can see are not shown by these filters." });
    expect(enquiryCountSentence({ ...base, matched: 0, narrowed: true }).shown).toBe("No enquiries in Fictional UAE match your filters.");
    expect(enquiryCountSentence({ ...base, matched: 0 }).shown).toBe("No open enquiries in Fictional UAE.");
    expect(enquiryCountSentence({ ...base, matched: 2, handover: true }).shown).toBe("Showing 2 of your won enquiries in Fictional UAE whose handover is not accepted yet.");
  });
});

describe("filter chips, the row action and the default columns", () => {
  it("one removable chip per filter in use; the default has none", () => {
    expect(enquiryFilterChips({ q: "", stageLabel: "", ownerLabel: "", status: "open", need: "", handover: false })).toEqual([]);
    expect(enquiryFilterChips({ q: "expo", stageLabel: "Qualified", ownerLabel: "mine", status: "closed", need: "overdue", handover: false }).map((c) => [c.label, c.clear])).toEqual([
      ["Search: expo", ["q"]], ["Owner: mine", ["owner", "mine"]], ["Stage: Qualified", ["stage"]], ["Show: won and lost", ["status"]], ["Overdue", ["need"]],
    ]);
    expect(enquiryFilterChips({ q: "x", stageLabel: "", ownerLabel: "", status: "open", need: "", handover: true }).map((c) => c.label)).toEqual(["My won: handover open"]);
  });
  it("the due time is inside Next action by default; Due stays available as its own column", () => {
    expect(ENQUIRY_DEFAULT_COLUMNS).toEqual(["enquiry", "party", "owner", "stage", "next", "dates"]);
    expect(ENQUIRY_ALL_COLUMNS).toContain("due");
  });
  it("one action per row: late first, then a missing next action, then the first response, then the stage", () => {
    const now = new Date("2026-11-14T08:00:00Z");
    const row = (stage: string, o: { due?: string; responded?: boolean } = {}) => ({ opp: { stage, first_response_at: o.responded === false ? null : "2026-11-01T00:00:00Z" }, nextFollowUp: o.due ? { due_at: o.due } : null, openFollowUps: o.due ? 1 : 0 });
    expect(enquiryRowAction(row("qualified", { due: "2026-11-01T08:00:00Z", responded: false }), now)).toEqual({ label: "Follow up now", tab: "", tone: "red" });
    expect(enquiryRowAction(row("qualified"), now)).toEqual({ label: "Plan next action", tab: "", tone: "amber" });
    expect(enquiryRowAction(row("new", { due: "2026-12-01T08:00:00Z", responded: false }), now)).toEqual({ label: "Log first response", tab: "activity", tone: "amber" });
    expect(enquiryRowAction(row("proposal_prep", { due: "2026-12-01T08:00:00Z" }), now)).toEqual({ label: "Prepare proposal", tab: "proposals", tone: null });
    expect(enquiryRowAction(row("negotiation", { due: "2026-12-01T08:00:00Z" }), now).label).toBe("Open");
    expect(enquiryRowAction(row("on_hold"), now).label).toBe("Review hold");
    expect(enquiryRowAction(row("won"), now).label).toBe("View");
  });
});

describe("the board's check before a move (the same rule as the Move stage dialog)", () => {
  const none = { hasSentProposal: false, hasQuoteRef: false };
  it("says what is missing for the two stages that need evidence, and where to record it", () => {
    for (const to of ["proposal_sent", "quote_sent"]) expect(boardMoveCheck(to, none)?.message).toBe(stageMoveRequirement(to, none));
    expect(boardMoveCheck("proposal_sent", none)).toMatchObject({ tab: "proposals" });
    expect(boardMoveCheck("quote_sent", none)).toMatchObject({ tab: "commercial", message: expect.stringMatching(/Zoho/) });
  });
  it("each stage needs its OWN evidence, and an estimate recorded as sent is evidence for neither (the evidence has no such fact)", () => {
    expect(Object.keys(none)).toEqual(["hasSentProposal", "hasQuoteRef"]);
    expect(boardMoveCheck("proposal_sent", { ...none, hasQuoteRef: true })).not.toBeNull();
    expect(boardMoveCheck("quote_sent", { ...none, hasSentProposal: true })).not.toBeNull();
    expect(boardMoveCheck("proposal_sent", { ...none, hasSentProposal: true })).toBeNull();
    expect(boardMoveCheck("quote_sent", { ...none, hasQuoteRef: true })).toBeNull();
  });
  it("stages without an evidence rule are never stopped here, and unknown evidence assumes nothing (the database decides)", () => {
    for (const to of ["new", "qualified", "proposal_prep", "negotiation"]) expect(boardMoveCheck(to, none)).toBeNull();
    expect(boardMoveCheck("quote_sent", null)).toBeNull();
    expect(boardMoveCheck("quote_sent", undefined)).toBeNull();
  });
});
