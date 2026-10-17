import { describe, expect, it } from "vitest";
import type { CrmClosureRow } from "@/types/crm";
import { defaultReopenStage, describeClosures, describeHistoryEvent, evidenceTypeLabel, reopenStageOptions, sortClosures } from "./closure-helpers";

const names = (id: string | null | undefined) => (id === "u1" ? "Juzar" : id === "u2" ? "Rafi" : "Nobody");
const fmt = (d: string) => `D(${d})`;
const closure = (id: string, closedAt: string, extra: Partial<CrmClosureRow> = {}): CrmClosureRow => ({
  id, opportunity_id: "o", company_id: "c", outcome: "won", closed_from_stage: "negotiation", closed_at: closedAt, closed_by: "u1", value_at_close: 12000, currency: "AED",
  evidence_type: "purchase_order", evidence_reference: "PO-77", evidence_date: "2026-10-01", lost_reason: null, reopened_at: null, reopened_by: null, reopen_reason: null, ...extra,
});

describe("defaultReopenStage", () => {
  it("returns to the stage it was closed from", () => expect(defaultReopenStage("proposal_sent")).toBe("proposal_sent"));
  it("falls back to negotiation when none was recorded", () => {
    expect(defaultReopenStage(null)).toBe("negotiation");
    expect(defaultReopenStage(undefined)).toBe("negotiation");
  });
  it("never reopens into On hold, Won or Lost", () => {
    expect(defaultReopenStage("on_hold")).toBe("negotiation");
    expect(defaultReopenStage("won")).toBe("negotiation");
  });
});

describe("reopenStageOptions", () => {
  it("lists exactly the six working stages", () => expect(reopenStageOptions("qualified").map((o) => o.id)).toEqual(["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation"]));
  it("marks the stage it was closed from as the default", () => {
    const opts = reopenStageOptions("quote_sent");
    expect(opts.filter((o) => o.isDefault).map((o) => o.id)).toEqual(["quote_sent"]);
    expect(opts.find((o) => o.isDefault)?.label).toBe("Quote sent (where it was closed from)");
    expect(opts.find((o) => o.id === "new")?.label).toBe("New enquiry");
  });
  it("is honest when no earlier stage was recorded", () => expect(reopenStageOptions(null).find((o) => o.isDefault)?.label).toMatch(/Negotiation \(default; no earlier stage/));
});

describe("sortClosures", () => {
  it("puts the newest closure first without changing the input", () => {
    const input = [closure("a", "2026-01-01T00:00:00Z"), closure("c", "2026-03-01T00:00:00Z"), closure("b", "2026-02-01T00:00:00Z")];
    expect(sortClosures(input).map((c) => c.id)).toEqual(["c", "b", "a"]);
    expect(input.map((c) => c.id)).toEqual(["a", "c", "b"]);
  });
});

describe("describeClosures", () => {
  it("describes a current win with value and evidence", () => {
    const [v] = describeClosures([closure("a", "2026-10-02T00:00:00Z")], names, fmt);
    expect(v).toMatchObject({ status: "current", heading: "Won", closedLine: "Marked Won by Juzar", valueText: "AED 12,000", reopened: null });
    expect(v?.details).toEqual([{ label: "Confirmed by", text: "Purchase order PO-77, dated D(2026-10-01)" }]);
  });
  it("describes a loss with its reason", () => {
    const [v] = describeClosures([closure("a", "2026-10-02T00:00:00Z", { outcome: "lost", lost_reason: "Budget cut", evidence_type: null, evidence_reference: null, evidence_date: null })], names, fmt);
    expect(v).toMatchObject({ status: "current", heading: "Lost", closedLine: "Marked Lost by Juzar" });
    expect(v?.details).toEqual([{ label: "Reason", text: "Budget cut" }]);
  });
  it("marks a reopened closure as past, with who, when and why, and never as the current outcome", () => {
    const [newer, older] = describeClosures(
      [closure("old", "2026-09-01T00:00:00Z", { reopened_at: "2026-09-20T00:00:00Z", reopened_by: "u2", reopen_reason: "Client changed the order" }), closure("new", "2026-10-02T00:00:00Z")],
      names, fmt,
    );
    expect(newer).toMatchObject({ id: "new", status: "current", heading: "Won" });
    expect(older).toMatchObject({ id: "old", status: "reopened", heading: "Was won" });
    expect(older?.reopened).toEqual({ at: "2026-09-20T00:00:00Z", line: "Reopened by Rafi", reason: "Client changed the order" });
  });
  it("leaves the value out when none was recorded", () => expect(describeClosures([closure("a", "2026-10-02T00:00:00Z", { value_at_close: null })], names, fmt)[0]?.valueText).toBeNull());
  it("accepts a numeric string value", () => expect(describeClosures([closure("a", "2026-10-02T00:00:00Z", { value_at_close: "2500.5" })], names, fmt)[0]?.valueText).toBe("AED 2,500.5"));
});

describe("evidenceTypeLabel", () => {
  it("names the two evidence types and tolerates others", () => {
    expect(evidenceTypeLabel("purchase_order")).toBe("Purchase order");
    expect(evidenceTypeLabel("authorised_email")).toBe("Authorised email");
    expect(evidenceTypeLabel("signed_form")).toBe("signed form");
    expect(evidenceTypeLabel(null)).toBe("Evidence");
  });
});

describe("describeHistoryEvent", () => {
  const ev = (kind: string, from: string | null, to: string | null, reason: string | null) => ({ kind, from_value: from, to_value: to, reason });
  it("describes a reopen with its reason", () => expect(describeHistoryEvent(ev("reopened", "won", "negotiation", "Client changed the order"))).toBe("Reopened: the Won opportunity went back to Negotiation. Reason: Client changed the order."));
  it("describes contact changes in plain words", () => {
    expect(describeHistoryEvent(ev("contact", null, "Asha Rao (Decision maker)", "Contact linked"))).toBe("Contact added to this opportunity: Asha Rao (Decision maker).");
    expect(describeHistoryEvent(ev("contact", null, "Asha Rao", "Contact role updated"))).toBe("Contact role changed: Asha Rao.");
    expect(describeHistoryEvent(ev("contact", "Asha Rao", null, "Contact unlinked (the contact record is kept)"))).toBe("Contact removed from this opportunity: Asha Rao. The contact record itself is kept.");
  });
  it("says a shared record edit applies everywhere", () => {
    expect(describeHistoryEvent(ev("contact", "Asha Rao", "Asha Rao", "Contact details updated (email, phone)"))).toBe("Shared contact record updated for Asha Rao (email, phone). The change applies everywhere this person appears.");
    expect(describeHistoryEvent(ev("contact", "Asha R", "Asha Rao", "Contact details updated (name)"))).toContain("Asha R, now Asha Rao (name)");
  });
  it("leaves other kinds to describeEvent", () => expect(describeHistoryEvent(ev("stage_changed", "new", "qualified", null))).toBeNull());
});
