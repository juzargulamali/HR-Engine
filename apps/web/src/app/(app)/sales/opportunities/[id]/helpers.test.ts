import { describe, expect, it } from "vitest";
import type { CrmActivityRow, CrmFileRow, CrmOpportunityEventRow, CrmProposalRow } from "@/types/crm";
import {
  approvalPolicyOf, buildHandoverPackage, buildTimeline, composeReason, dateRangeText, describeEvent, filePurposeNote, isHttpsUrl,
  isOnlyOpenFollowUp, OTHER_HOLD_REASON, parseRisks, proposalActions, stageMoveRequirement,
} from "./helpers";

const act = (id: string, at: string): CrmActivityRow => ({ id, opportunity_id: "o", company_id: "c", kind: "note", body: "x", is_internal: false, occurred_at: at, created_by: "u", created_at: at });
const ev = (id: string, at: string, kind = "stage_changed", from: string | null = "new", to: string | null = "qualified", reason: string | null = null): CrmOpportunityEventRow =>
  ({ id, opportunity_id: "o", company_id: "c", kind, from_value: from, to_value: to, reason, actor_id: null, created_at: at });
const names = (id: string | null | undefined) => (id === "u1" ? "Juzar" : id === "u2" ? "Rafi" : "Nobody");

describe("buildTimeline", () => {
  it("merges activities and events newest first", () => {
    const t = buildTimeline([act("a1", "2026-10-01T10:00:00Z"), act("a2", "2026-10-03T10:00:00Z")], [ev("e1", "2026-10-02T10:00:00Z")]);
    expect(t.map((x) => x.id)).toEqual(["a-a2", "e-e1", "a-a1"]);
  });
  it("is empty when there is nothing", () => expect(buildTimeline([], [])).toEqual([]));
});

describe("describeEvent", () => {
  it("names stages with their labels", () => expect(describeEvent(ev("1", "t"), names)).toBe("Stage changed from New enquiry to Qualified."));
  it("resolves owners to names", () => expect(describeEvent(ev("1", "t", "owner_changed", "u1", "u2", "Holiday cover"), names)).toBe("Owner changed from Juzar to Rafi. Reason: Holiday cover."));
  it("translates changed field names", () => expect(describeEvent(ev("1", "t", "details_changed", null, "event_start, technologies"), names)).toBe("Details changed: show start date, technologies and quantities."));
  it("describes approval as the founder's decision", () => expect(describeEvent(ev("1", "t", "approval", "pending", "approved"), names)).toBe("Commercial approved by a founder."));
  it("never reads a request as approval", () => expect(describeEvent(ev("1", "t", "approval", null, "requested"), names)).toBe("Commercial approval requested."));
  it("describes a win with its evidence", () => expect(describeEvent(ev("1", "t", "won", "negotiation", "won", "purchase_order: PO-77 — signed"), names)).toBe("Marked Won. Confirmed by purchase order: PO-77 — signed."));
  it("falls back for unknown kinds", () => expect(describeEvent(ev("1", "t", "something_new", null, "x"), names)).toBe("something new: x."));
});

describe("isOnlyOpenFollowUp", () => {
  const open = (id: string) => ({ id, status: "open" as const });
  it("is true for the single open follow-up of an active opportunity", () => expect(isOnlyOpenFollowUp([open("a"), { id: "b", status: "done" }], "a", "qualified")).toBe(true));
  it("is false when another is open", () => expect(isOnlyOpenFollowUp([open("a"), open("b")], "a", "qualified")).toBe(false));
  it("is false on hold or when closed (no next-action rule applies)", () => {
    expect(isOnlyOpenFollowUp([open("a")], "a", "on_hold")).toBe(false);
    expect(isOnlyOpenFollowUp([open("a")], "a", "won")).toBe(false);
  });
});

describe("stageMoveRequirement", () => {
  it("asks for a sent proposal before Proposal sent", () => {
    expect(stageMoveRequirement("proposal_sent", { hasSentProposal: false, hasQuoteRef: true })).toMatch(/proposal as sent/);
    expect(stageMoveRequirement("proposal_sent", { hasSentProposal: true, hasQuoteRef: false })).toBeNull();
  });
  it("asks for the Zoho quote reference before Quote sent", () => {
    expect(stageMoveRequirement("quote_sent", { hasSentProposal: true, hasQuoteRef: false })).toMatch(/quote reference/);
    expect(stageMoveRequirement("quote_sent", { hasSentProposal: false, hasQuoteRef: true })).toBeNull();
  });
  it("has no requirement for other stages", () => expect(stageMoveRequirement("negotiation", { hasSentProposal: false, hasQuoteRef: false })).toBeNull());
});

describe("composeReason", () => {
  it("uses the choice alone, or with a note", () => {
    expect(composeReason("Client postponed event", "", OTHER_HOLD_REASON)).toBe("Client postponed event");
    expect(composeReason("Client postponed event", " venue moved ", OTHER_HOLD_REASON)).toBe("Client postponed event: venue moved");
  });
  it("makes the note the reason for Other, and is empty without one", () => {
    expect(composeReason(OTHER_HOLD_REASON, "Founder travelling", OTHER_HOLD_REASON)).toBe("Other: Founder travelling");
    expect(composeReason(OTHER_HOLD_REASON, "  ", OTHER_HOLD_REASON)).toBe("");
  });
});

describe("small parsers", () => {
  it("parses risks one per line, dropping blanks", () => expect(parseRisks("a\n\n  b  \n")).toEqual(["a", "b"]));
  it("accepts only https links", () => {
    expect(isHttpsUrl("https://drive.example.com/x")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl(null)).toBe(false);
  });
  it("defaults the approval policy to not configured", () => {
    expect(approvalPolicyOf(null)).toBe("not_configured");
    expect(approvalPolicyOf({ approval_policy: "required" })).toBe("required");
  });
  it("labels evidence files and says nothing for others", () => {
    expect(filePurposeNote("purchase_order")).toMatch(/purchase order evidence/);
    expect(filePurposeNote("authorised_email")).toMatch(/authorised email evidence/);
    expect(filePurposeNote("proposal")).toMatch(/proposal/);
    expect(filePurposeNote("brief")).toBeNull();
  });
  it("formats date ranges", () => {
    const f = (d: string) => d.slice(5);
    expect(dateRangeText(null, null, f)).toBeNull();
    expect(dateRangeText("2026-11-10", null, f)).toBe("11-10");
    expect(dateRangeText("2026-11-10", "2026-11-10", f)).toBe("11-10");
    expect(dateRangeText("2026-11-10", "2026-11-12", f)).toBe("11-10 to 11-12");
  });
});

describe("proposalActions", () => {
  it("offers sent/superseded for a draft and accepted/superseded for a sent proposal on an open opportunity", () => {
    expect(proposalActions({ status: "draft" }, "qualified")).toEqual({ send: true, accept: false, supersede: true });
    expect(proposalActions({ status: "sent" }, "negotiation")).toEqual({ send: false, accept: true, supersede: true });
    expect(proposalActions({ status: "accepted" }, "negotiation")).toEqual({ send: false, accept: false, supersede: false });
  });
  it("on a won opportunity only acceptance is possible; on a lost one nothing", () => {
    expect(proposalActions({ status: "sent" }, "won")).toEqual({ send: false, accept: true, supersede: false });
    expect(proposalActions({ status: "draft" }, "won")).toEqual({ send: false, accept: false, supersede: false });
    expect(proposalActions({ status: "sent" }, "lost")).toEqual({ send: false, accept: false, supersede: false });
  });
});

describe("buildHandoverPackage", () => {
  const proposal = (over: Partial<CrmProposalRow>): CrmProposalRow => ({ id: "p", opportunity_id: "o", company_id: "c", version: 1, status: "draft", file_id: null, note: null, sent_on: null, created_by: "u", created_at: "t", updated_at: "t", ...over });
  const file = (over: Partial<CrmFileRow>): CrmFileRow => ({ id: "f", opportunity_id: "o", company_id: "c", kind: "file", label: null, original_name: "po.pdf", storage_path: "x", mime_type: "application/pdf", size_bytes: 10, url: null, purpose: "purchase_order", uploaded_by: "u", created_at: "t", deleted_at: null, ...over });
  const full = { scope: "LED wall", exclusions: "Power", evidence_type: "purchase_order" as const, evidence_reference: "PO-1", evidence_date: "2026-10-01", payment_terms: "30 days", technologies: [{ name: "LED", qty: 2 }], install_start: "2026-11-01", event_start: "2026-11-03" };

  it("has no gaps when everything is recorded", () => {
    const pkg = buildHandoverPackage({ opp: full, proposals: [proposal({ status: "accepted", file_id: "f2" })], files: [file({}), file({ id: "f2", purpose: "proposal" })], contactCount: 1, availability: "confirmed" });
    expect(pkg.gaps).toEqual([]);
    expect(pkg.acceptedProposal?.status).toBe("accepted");
    expect(pkg.acceptedProposalFile?.id).toBe("f2");
    expect(pkg.evidenceLabel).toBe("Purchase order");
  });
  it("lists each missing piece in words", () => {
    const pkg = buildHandoverPackage({
      opp: { ...full, scope: null, payment_terms: null, technologies: [], install_start: null, event_start: null },
      proposals: [proposal({ status: "sent" })], files: [], contactCount: 0, availability: "unverified",
    });
    expect(pkg.gaps).toHaveLength(8);
    expect(pkg.gaps.join(" ")).toMatch(/availability has not been confirmed/);
    expect(pkg.acceptedProposal).toBeNull();
  });
  it("distinguishes a stale check and an unavailable result", () => {
    const base = { opp: full, proposals: [proposal({ status: "accepted" })], files: [file({})], contactCount: 1 };
    expect(buildHandoverPackage({ ...base, availability: "needs_recheck" }).gaps[0]).toMatch(/needs a recheck/);
    expect(buildHandoverPackage({ ...base, availability: "unavailable" }).gaps[0]).toMatch(/not available/);
  });
  it("picks the highest accepted version", () => {
    const pkg = buildHandoverPackage({ opp: full, proposals: [proposal({ id: "a", version: 1, status: "accepted" }), proposal({ id: "b", version: 2, status: "accepted" })], files: [file({})], contactCount: 1, availability: "confirmed" });
    expect(pkg.acceptedProposal?.id).toBe("b");
  });
});
