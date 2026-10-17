import { describe, expect, it } from "vitest";
import type { CrmStageId } from "@enginious-hr/domain";
import type { CrmZohoReferenceRow } from "@/types/crm";
import {
  addDays, attentionItems, currencyLines, elapsedFirstResponse, enquiriesBySource, filterOpportunities, followUpCounts, inPeriod, openPipelineByOwner, openPipelineByStage,
  organisationLabel, resolvePeriod, timelinessByCompany, wonLostInPeriod, wonValueRows, zohoSummary, type ReportOpp,
} from "./reports";

// 2026-10-19 is a Monday. Dubai is UTC+4, so 05:00Z = 09:00 Dubai.
const NOW = new Date("2026-10-19T08:00:00Z");
const PERIOD = { from: "2026-07-01", to: "2026-10-19" };

let n = 0;
function opp(over: Partial<ReportOpp> = {}): ReportOpp {
  n++;
  return {
    id: `o${n}`, company_id: "c1", owner_id: "u1", stage: "new", currency: "AED", value: 1000, source: "Referral",
    created_at: "2026-10-01T05:00:00Z", first_response_at: null, closed_at: null, stage_changed_at: "2026-10-01T05:00:00Z", lost_reason: null, evidence_reference: null,
    ...over,
  };
}

describe("periods", () => {
  it("defaults to the last 90 days ending today (Dubai)", () => {
    expect(resolvePeriod(undefined, undefined, NOW)).toEqual({ from: "2026-07-21", to: "2026-10-19" });
  });
  it("uses valid params, ignores junk and swaps a reversed range", () => {
    expect(resolvePeriod("2026-01-01", "2026-02-01", NOW)).toEqual({ from: "2026-01-01", to: "2026-02-01" });
    expect(resolvePeriod("not-a-date", "2026-02-30x", NOW)).toEqual({ from: "2026-07-21", to: "2026-10-19" });
    expect(resolvePeriod("2026-03-01", "2026-02-01", NOW)).toEqual({ from: "2026-02-01", to: "2026-03-01" });
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
  it("filters by Dubai date, inclusive at both ends, and never matches null", () => {
    // 21:00Z on the 18th is 01:00 on the 19th in Dubai.
    expect(inPeriod("2026-10-18T21:00:00Z", { from: "2026-10-19", to: "2026-10-19" })).toBe(true);
    expect(inPeriod("2026-10-19T20:00:00Z", { from: "2026-10-19", to: "2026-10-19" })).toBe(false);
    expect(inPeriod(null, PERIOD)).toBe(false);
  });
});

describe("currency separation", () => {
  it("never adds amounts of different currencies, per stage and per owner", () => {
    const opps = [
      opp({ stage: "qualified", currency: "AED", value: 100 }),
      opp({ stage: "qualified", currency: "AED", value: 50 }),
      opp({ stage: "qualified", currency: "EUR", value: 7 }),
      opp({ stage: "won", currency: "SAR", value: 999 }),
    ];
    const stages = openPipelineByStage(opps);
    const q = stages.find((s) => s.stage === "qualified");
    expect(q?.count).toBe(3);
    expect(q?.totals).toEqual({ AED: 150, EUR: 7 });
    expect(stages.map((s) => s.stage)).toContain("on_hold");
    expect(stages.some((s) => s.stage === ("won" as string))).toBe(false);
    const owners = openPipelineByOwner(opps);
    expect(owners).toHaveLength(1);
    expect(owners[0]?.totals).toEqual({ AED: 150, EUR: 7 });
  });
  it("counts opportunities with no value as unvalued rather than zero", () => {
    const [first] = openPipelineByStage([opp({ stage: "new", value: null })]);
    expect(first?.count).toBe(1);
    expect(first?.unvalued).toBe(1);
    expect(first?.totals).toEqual({});
  });
  it("lists currencies in code order", () => {
    expect(currencyLines({ SAR: 1, AED: 2 }).map((l) => l.currency)).toEqual(["AED", "SAR"]);
  });
});

describe("won and lost in the period", () => {
  const opps = [
    opp({ stage: "won", closed_at: "2026-09-01T05:00:00Z", evidence_reference: "PO-1", currency: "AED", value: 500 }),
    opp({ stage: "won", closed_at: "2026-09-02T05:00:00Z", evidence_reference: "PO-2", currency: "EUR", value: 20 }),
    opp({ stage: "won", closed_at: "2026-09-03T05:00:00Z", evidence_reference: null, currency: "AED", value: 9000 }),
    opp({ stage: "won", closed_at: "2025-01-01T05:00:00Z", evidence_reference: "PO-OLD" }),
    opp({ stage: "lost", closed_at: "2026-09-04T05:00:00Z", lost_reason: "Price" }),
    opp({ stage: "lost", closed_at: "2026-09-05T05:00:00Z", lost_reason: "Price" }),
    opp({ stage: "lost", closed_at: "2026-09-06T05:00:00Z", lost_reason: null }),
    opp({ stage: "negotiation" }),
  ];
  const r = wonLostInPeriod(opps, PERIOD);
  it("counts only closures inside the period, and won only with evidence", () => {
    expect(r.won).toBe(2);
    expect(r.lost).toBe(3);
    expect(r.wonWithoutEvidence).toBe(1);
    expect(r.winRatePercent).toBe(40);
  });
  it("keeps won value per currency and excludes won-without-evidence", () => {
    expect(r.wonValue).toEqual({ AED: 500, EUR: 20 });
  });
  it("groups lost reasons, most common first", () => {
    expect(r.lostReasons).toEqual([{ reason: "Price", count: 2 }, { reason: "No reason recorded", count: 1 }]);
  });
  it("has no win rate (not zero) when nothing closed", () => {
    const empty = wonLostInPeriod([opp({ stage: "new" })], PERIOD);
    expect(empty.winRatePercent).toBeNull();
    expect(empty.won).toBe(0);
    expect(empty.lostReasons).toEqual([]);
  });
});

describe("enquiries by source", () => {
  it("groups case-insensitively inside the period only", () => {
    const rows = enquiriesBySource(
      [opp({ source: "Referral" }), opp({ source: "referral " }), opp({ source: "Website" }), opp({ source: "", created_at: "2026-10-02T05:00:00Z" }), opp({ source: "Old", created_at: "2025-01-01T05:00:00Z" })],
      PERIOD,
    );
    expect(rows).toEqual([{ source: "Referral", count: 2 }, { source: "Not recorded", count: 1 }, { source: "Website", count: 1 }]);
  });
});

describe("follow-up counts", () => {
  it("splits open follow-ups into overdue, due today and upcoming and ignores closed ones", () => {
    const counts = followUpCounts(
      [
        { due_at: "2026-10-18T05:00:00Z", status: "open" },
        { due_at: "2026-10-19T10:00:00Z", status: "open" },
        { due_at: "2026-10-25T05:00:00Z", status: "open" },
        { due_at: "2026-10-01T05:00:00Z", status: "done" },
        { due_at: "2026-10-01T05:00:00Z", status: "cancelled" },
      ],
      NOW,
    );
    expect(counts).toEqual({ overdue: 1, dueToday: 1, upcoming: 1 });
  });
  it("is all zeros with no data", () => {
    expect(followUpCounts([], NOW)).toEqual({ overdue: 0, dueToday: 0, upcoming: 0 });
  });
});

describe("timeliness", () => {
  const calendar = { workdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", holidays: [] };
  const answered = opp({ company_id: "c1", created_at: "2026-10-19T05:00:00Z", first_response_at: "2026-10-19T07:00:00Z" }); // 2 working hours
  const slow = opp({ company_id: "c1", created_at: "2026-10-19T05:00:00Z", first_response_at: "2026-10-19T12:00:00Z" }); // 7 working hours
  const period = { from: "2026-10-01", to: "2026-10-31" };

  it("reports not configured, with the reason, when there is no target or no calendar", () => {
    const [noTarget, noCalendar] = timelinessByCompany(
      [answered],
      [
        { id: "c1", name: "A", responseTargetHours: null, workingCalendar: calendar },
        { id: "c2", name: "B", responseTargetHours: 4, workingCalendar: null },
      ],
      period,
      NOW,
    );
    expect(noTarget?.kpi.status).toBe("not_configured");
    expect(noCalendar?.kpi).toMatchObject({ status: "not_configured", reason: "No working calendar has been set." });
  });
  it("computes the share within target per company once configured, never blending companies", () => {
    const other = opp({ company_id: "c2", created_at: "2026-10-19T05:00:00Z", first_response_at: "2026-10-19T05:30:00Z" });
    const res = timelinessByCompany(
      [answered, slow, other],
      [
        { id: "c1", name: "A", responseTargetHours: 4, workingCalendar: calendar },
        { id: "c2", name: "B", responseTargetHours: 4, workingCalendar: calendar },
      ],
      period,
      NOW,
    );
    expect(res[0]?.kpi).toMatchObject({ status: "ok", measured: 2, withinTarget: 1 });
    expect(res[1]?.kpi).toMatchObject({ status: "ok", measured: 1, withinTarget: 1 });
    expect(res[0]?.enquiries).toBe(2);
  });
  it("ignores enquiries created outside the period", () => {
    const [r] = timelinessByCompany([opp({ created_at: "2025-01-01T05:00:00Z" })], [{ id: "c1", name: "A", responseTargetHours: 4, workingCalendar: calendar }], period, NOW);
    expect(r?.enquiries).toBe(0);
  });
  it("gives only elapsed time without a target, and null with no responses", () => {
    expect(elapsedFirstResponse([answered, slow, opp()], period)).toEqual({ enquiries: 3, responded: 2, awaiting: 1, medianHours: 4.5 });
    expect(elapsedFirstResponse([], period)).toEqual({ enquiries: 0, responded: 0, awaiting: 0, medianHours: null });
  });
});

describe("Zoho references", () => {
  const z = (over: Partial<CrmZohoReferenceRow>): CrmZohoReferenceRow => ({
    opportunity_id: "x", company_id: "c1", quote_ref: null, quote_sent_on: null, invoice_ref: null, invoice_issued_on: null, payment_received_on: null, paid_amount: null, updated_by: null, updated_at: "2026-10-01T00:00:00Z", ...over,
  });
  it("joins by opportunity and summarises manual references per currency", () => {
    const a = opp({ id: "a", currency: "AED" });
    const b = opp({ id: "b", currency: "EUR" });
    const c = opp({ id: "c", currency: "AED" });
    const rows = wonValueRows([a, b, c], [z({ opportunity_id: "a", invoice_ref: "INV-1", payment_received_on: "2026-10-05", paid_amount: "300.50" }), z({ opportunity_id: "b", invoice_issued_on: "2026-10-02", paid_amount: 10 })]);
    expect(rows[2]?.zoho).toBeNull();
    expect(zohoSummary(rows)).toEqual({ invoicedCount: 2, collectedCount: 1, paidRecorded: { AED: 300.5, EUR: 10 } });
  });
  it("is empty and zero with no won opportunities", () => {
    expect(zohoSummary(wonValueRows([], []))).toEqual({ invoicedCount: 0, collectedCount: 0, paidRecorded: {} });
  });
});

describe("opportunity filtering", () => {
  const mk = (over: Partial<{ reference: string; title: string; stage: CrmStageId; company_id: string; owner_id: string }>, agency?: string, client?: string) => ({
    opp: { reference: "ENG-001", title: "Expo stand", stage: "new" as const, company_id: "c1", owner_id: "u1", ...over },
    agency: agency ? { name: agency } : null,
    client: client ? { name: client } : null,
  });
  const items = [mk({ reference: "ENG-001" }, "Acme Events", "Globex"), mk({ reference: "ENG-002", title: "Gala", stage: "won", owner_id: "u2" }), mk({ reference: "ENG-003", stage: "on_hold", company_id: "c2" })];
  const base = { q: "", stage: "", company: "", owner: "", mine: false, status: "open" as const };

  it("defaults to open (including on hold) and hides closed", () => {
    expect(filterOpportunities(items, base, "u1").map((i) => i.opp.reference)).toEqual(["ENG-001", "ENG-003"]);
    expect(filterOpportunities(items, { ...base, status: "closed" }, "u1").map((i) => i.opp.reference)).toEqual(["ENG-002"]);
    expect(filterOpportunities(items, { ...base, status: "all" }, "u1")).toHaveLength(3);
  });
  it("searches reference, title and organisation names", () => {
    expect(filterOpportunities(items, { ...base, q: "globex" }, "u1")).toHaveLength(1);
    expect(filterOpportunities(items, { ...base, q: "gala", status: "all" }, "u1")).toHaveLength(1);
    expect(filterOpportunities(items, { ...base, q: "eng-003" }, "u1")).toHaveLength(1);
  });
  it("lets an explicit stage override the open/closed switch, and applies owner, company and mine", () => {
    expect(filterOpportunities(items, { ...base, stage: "won" }, "u1")).toHaveLength(1);
    expect(filterOpportunities(items, { ...base, company: "c2" }, "u1")).toHaveLength(1);
    expect(filterOpportunities(items, { ...base, status: "all", owner: "u2" }, "u1")).toHaveLength(1);
    expect(filterOpportunities(items, { ...base, status: "all", mine: true }, "u2")).toHaveLength(1);
  });
  it("labels organisations", () => {
    expect(organisationLabel(items[0]!)).toBe("Acme Events for Globex");
    expect(organisationLabel(items[1]!)).toBe("No organisation");
  });
});

describe("needs attention", () => {
  const o = (id: string, over: Record<string, unknown> = {}, openFollowUps = 1) => ({
    opp: { id, reference: `ENG-${id}`, title: `Opp ${id}`, stage: "qualified" as const, owner_id: "me", hold_review_date: null, first_response_at: "2026-10-01T05:00:00Z", ...over },
    openFollowUps,
  });
  const fu = (oppId: string, assigned: string, dueAt: string, status = "open") => ({ followUp: { assigned_to: assigned, title: "Call", due_at: dueAt, status }, opportunity: { id: oppId, reference: `ENG-${oppId}`, title: `Opp ${oppId}` } });

  it("collects overdue and due-today follow-ups assigned to me, ordered by urgency", () => {
    const items = attentionItems(
      { userId: "me", scope: "mine", opportunities: [], followUps: [fu("a", "me", "2026-10-19T10:00:00Z"), fu("b", "me", "2026-10-10T05:00:00Z"), fu("c", "other", "2026-10-10T05:00:00Z"), fu("d", "me", "2026-10-30T05:00:00Z"), fu("e", "me", "2026-10-01T05:00:00Z", "done")] },
      NOW,
    );
    expect(items.map((i) => [i.kind, i.opportunityId])).toEqual([["overdue", "b"], ["due_today", "a"]]);
  });
  it("flags active opportunities without a next action, arrived holds and missing first responses", () => {
    const items = attentionItems(
      {
        userId: "me", scope: "mine", followUps: [],
        opportunities: [
          o("1", {}, 0),
          o("2", { stage: "on_hold", hold_review_date: "2026-10-19" }, 0),
          o("3", { stage: "on_hold", hold_review_date: "2026-10-25" }, 0),
          o("4", { first_response_at: null }),
          o("5", { stage: "won" }, 0),
          o("6", { owner_id: "someone-else" }, 0),
        ],
      },
      NOW,
    );
    expect(items.map((i) => [i.kind, i.opportunityId])).toEqual([["hold_review", "2"], ["no_next_action", "1"], ["no_first_response", "4"]]);
  });
  it("includes everyone's items for scope all, and is empty with no data", () => {
    expect(attentionItems({ userId: "me", scope: "all", followUps: [], opportunities: [o("6", { owner_id: "someone-else" }, 0)] }, NOW)).toHaveLength(1);
    expect(attentionItems({ userId: "me", scope: "mine", followUps: [], opportunities: [] }, NOW)).toEqual([]);
  });
});
