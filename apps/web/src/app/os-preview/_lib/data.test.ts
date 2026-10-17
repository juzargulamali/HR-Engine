import { describe, expect, it } from "vitest";
import {
  ACTIVITIES, CONTACTS, FOLLOWUPS, OPPORTUNITIES, ORGS, PROPOSALS, STAGES, allowedMoves, attention, buildHandover, isOpen, nextActionOf, oppById,
  FINANCE_SAMPLE, PEOPLE, TODAY, ZOHO,
} from "./data";

describe("design-preview sample data integrity", () => {
  it("has unique references and ids", () => {
    expect(new Set(OPPORTUNITIES.map((o) => o.ref)).size).toBe(OPPORTUNITIES.length);
    expect(new Set(OPPORTUNITIES.map((o) => o.id)).size).toBe(OPPORTUNITIES.length);
  });
  it("only uses known stages, people, organisations and contacts", () => {
    const stages = new Set(STAGES.map((s) => s.id));
    for (const o of OPPORTUNITIES) {
      expect(stages.has(o.stage)).toBe(true);
      expect(PEOPLE[o.owner]).toBeDefined();
      for (const id of [o.agencyId, o.endClientId]) if (id) expect(ORGS.some((x) => x.id === id)).toBe(true);
      for (const c of o.contacts) expect(CONTACTS.some((x) => x.id === c.contactId)).toBe(true);
    }
    for (const f of FOLLOWUPS) expect(oppById(f.oppId)).toBeDefined();
    for (const a of ACTIVITIES) expect(oppById(a.oppId)).toBeDefined();
    for (const p of PROPOSALS) expect(oppById(p.oppId)).toBeDefined();
  });
  it("gives every open opportunity an owner and a next action with a date (on-hold may rely on its review follow-up)", () => {
    for (const o of OPPORTUNITIES.filter(isOpen)) {
      expect(o.owner).toBeTruthy();
      const next = nextActionOf(o.id);
      expect(next, o.ref).not.toBeNull();
      expect(next!.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it("requires a reason and review date on hold, evidence on won, a reason on lost", () => {
    for (const o of OPPORTUNITIES) {
      if (o.stage === "on_hold") { expect(o.holdReason).toBeTruthy(); expect(o.holdReview).toBeTruthy(); }
      if (o.stage === "won") { expect(o.evidence?.type).toBeTruthy(); expect(o.evidence?.date).toBeTruthy(); }
      if (o.stage === "lost") expect(o.lostReason).toBeTruthy();
    }
  });
  it("keeps scheduled and completion timestamps on completed follow-ups", () => {
    for (const f of FOLLOWUPS.filter((x) => x.doneAt)) expect(f.scheduledAt).toBeTruthy();
  });
  it("never offers Won or Lost as a plain stage move, and closed opportunities have no moves", () => {
    for (const s of STAGES) {
      const moves = allowedMoves(s.id);
      expect(moves).not.toContain("won");
      expect(moves).not.toContain("lost");
      expect(moves).not.toContain(s.id);
    }
    expect(allowedMoves("won")).toEqual([]);
    expect(allowedMoves("lost")).toEqual([]);
  });
  it("derives the attention buckets from the records, deterministically", () => {
    const a = attention();
    expect(TODAY).toBe("2026-10-19");
    expect(a.awaitingFirstResponse.map((o) => o.ref)).toEqual(["OPP-2026-0042"]);
    expect(a.overdue.length).toBe(2);
    expect(a.installNoConfirmation.map((o) => o.ref)).toContain("OPP-2026-0044");
  });
  it("keeps currencies separate: one currency per opportunity matching its company", () => {
    for (const o of OPPORTUNITIES) expect(["AED", "SAR", "EUR"]).toContain(o.currency);
    for (const f of FINANCE_SAMPLE) expect(["AED", "SAR", "EUR"]).toContain(f.currency);
  });
  it("keeps quotation, invoice and payment as separate facts", () => {
    const z = ZOHO.find((x) => x.oppId === "47")!;
    expect(z.quoteRef).toBeTruthy(); expect(z.invoiceRef).toBeTruthy(); expect(z.paymentReceivedOn).toBeNull();
  });
  it("builds a handover package that is not a project", () => {
    const h = buildHandover(oppById("47"));
    expect(h.confirmation).toContain("Purchase order");
    expect(h).not.toHaveProperty("tasks");
  });
  it("labels every external-looking address as a reserved example domain", () => {
    for (const c of CONTACTS) expect(c.email.endsWith("@example.test")).toBe(true);
  });
});
