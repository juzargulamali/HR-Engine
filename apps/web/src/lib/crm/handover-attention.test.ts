import { describe, expect, it } from "vitest";
import { ACCEPTED_NOTICE_DAYS, FOUNDER_REMINDER_DAYS, WON_LOOKBACK_DAYS, founderCandidates, handoverRows, type OwnHandover, type WonOpportunity } from "./handover-attention";

const NOW = new Date("2026-11-02T08:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const won = (id: string, over: Partial<WonOpportunity> = {}): WonOpportunity => ({ id, reference: `UAE-${id}`, title: `Job ${id}`, ownerId: "me", companyId: "c1", wonAt: daysAgo(0), ...over });
const own = (opp: string, status: string, over: Partial<OwnHandover> = {}): OwnHandover => ({ crmOpportunityId: opp, reference: `UAE-${opp}`, title: `Job ${opp}`, status, clarificationNote: null, acceptedAt: null, updatedAt: daysAgo(0), ...over });
const base = { userId: "me", founderCompanies: new Set<string>(), founderStatus: new Map<string, string | null>(), now: NOW };

describe("handoverRows: the owner", () => {
  it("a won enquiry with no handover, or a draft, shows 'Won, handover not submitted' from the day of the win", () => {
    const rows = handoverRows({ ...base, wonOpportunities: [won("a"), won("b")], own: [own("b", "draft")] });
    expect(rows.map((r) => [r.opportunityId, r.kind, r.scope])).toEqual([["a", "won_no_handover", "mine"], ["b", "won_no_handover", "mine"]]);
  });
  it("the row is gone once the handover is submitted (and for every later status)", () => {
    for (const status of ["submitted", "pm_assigned", "accepted"]) {
      const rows = handoverRows({ ...base, wonOpportunities: [won("a")], own: [own("a", status, { acceptedAt: daysAgo(30) })] });
      expect(rows.filter((r) => r.kind === "won_no_handover"), status).toEqual([]);
    }
  });
  it("the PM's question shows with the question until the owner resubmits", () => {
    const rows = handoverRows({ ...base, wonOpportunities: [won("a")], own: [own("a", "clarification_requested", { clarificationNote: "Which hall?" })] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "handover_question", opportunityId: "a" });
    expect(rows[0]!.detail).toContain("Which hall?");
    expect(handoverRows({ ...base, wonOpportunities: [won("a")], own: [own("a", "submitted")] })).toEqual([]);
  });
  it("'accepted' shows for a week, then drops", () => {
    const fresh = handoverRows({ ...base, wonOpportunities: [], own: [own("a", "accepted", { acceptedAt: daysAgo(ACCEPTED_NOTICE_DAYS - 1) })] });
    const old = handoverRows({ ...base, wonOpportunities: [], own: [own("a", "accepted", { acceptedAt: daysAgo(ACCEPTED_NOTICE_DAYS) })] });
    expect(fresh.map((r) => r.kind)).toEqual(["handover_accepted"]);
    expect(old).toEqual([]);
  });
  it("a win older than the look-back is not asked about (history from before the handover existed)", () => {
    expect(handoverRows({ ...base, wonOpportunities: [won("old", { wonAt: daysAgo(WON_LOOKBACK_DAYS + 1) })], own: [] })).toEqual([]);
  });
  it("someone else's won enquiry never shows to a person who is neither its owner nor a founder of the company", () => {
    expect(handoverRows({ ...base, wonOpportunities: [won("x", { ownerId: "other", wonAt: daysAgo(10) })], own: [] })).toEqual([]);
  });
  it("question first, then won-without-handover, then accepted", () => {
    const rows = handoverRows({
      ...base, wonOpportunities: [won("w")],
      own: [own("q", "clarification_requested"), own("ok", "accepted", { acceptedAt: daysAgo(1) })],
    });
    expect(rows.map((r) => r.kind)).toEqual(["handover_question", "won_no_handover", "handover_accepted"]);
  });
});

describe("handoverRows: a Sales founder", () => {
  const founder = { ...base, founderCompanies: new Set(["c1"]) };
  it("sees another owner's win once it is older than the reminder days and still not submitted", () => {
    const o = won("x", { ownerId: "other", wonAt: daysAgo(FOUNDER_REMINDER_DAYS) });
    const rows = handoverRows({ ...founder, wonOpportunities: [o], own: [], founderStatus: new Map([["x", null]]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "won_no_handover", scope: "company" });
  });
  it("not before the reminder days, not once it is submitted, not in a company where they are not a founder, and not when the status was not read", () => {
    const young = won("y", { ownerId: "other", wonAt: daysAgo(FOUNDER_REMINDER_DAYS - 1) });
    const sub = won("s", { ownerId: "other", wonAt: daysAgo(5) });
    const elsewhere = won("e", { ownerId: "other", wonAt: daysAgo(5), companyId: "c2" });
    const unread = won("u", { ownerId: "other", wonAt: daysAgo(5) });
    const status = new Map<string, string | null>([["y", null], ["s", "submitted"], ["e", null]]);
    expect(handoverRows({ ...founder, wonOpportunities: [young, sub, elsewhere, unread], own: [], founderStatus: status })).toEqual([]);
  });
  it("candidates to check are other owners' wins in the founder's companies, inside the window", () => {
    const list = [won("mine"), won("x", { ownerId: "o", wonAt: daysAgo(3) }), won("young", { ownerId: "o" }), won("old", { ownerId: "o", wonAt: daysAgo(WON_LOOKBACK_DAYS + 5) }), won("c2", { ownerId: "o", wonAt: daysAgo(3), companyId: "c2" })];
    expect(founderCandidates({ userId: "me", wonOpportunities: list, founderCompanies: new Set(["c1"]), now: NOW }).map((o) => o.id)).toEqual(["x"]);
  });
});
