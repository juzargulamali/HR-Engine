import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTIVITIES, APPROVAL_POLICY, APPROVAL_RECORDS, CONTACTS, FINANCE_SAMPLE, FOLLOWUPS, NOW, OPPORTUNITIES, ORGS, PEOPLE, PROPOSALS, STAGES, TODAY, ZOHO,
  allowedMoves, attention, buildHandover, commercialStatus, dueLabel, dueState, equipmentOk, fmtDue, fmtTime, isOpen, nextActionOf, oppById, openFollowUps, sameSnapshot, snapshot,
} from "./data";
import { SITE_BOOKINGS, TEAM_PLAN, bookingWindow, daysWithoutAllocation, multiProjectDays, siteConflicts } from "./delivery";

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
  it("gives every open opportunity an owner and a dated, timed next action", () => {
    for (const o of OPPORTUNITIES.filter(isOpen)) {
      expect(o.owner).toBeTruthy();
      const next = nextActionOf(o.id);
      expect(next, o.ref).not.toBeNull();
      expect(next!.dueAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    }
  });
  it("requires a reason and review date on hold, evidence on won, a reason on lost", () => {
    for (const o of OPPORTUNITIES) {
      if (o.stage === "on_hold") { expect(o.holdReason).toBeTruthy(); expect(o.holdReview).toBeTruthy(); }
      if (o.stage === "won") { expect(o.evidence?.type).toBeTruthy(); expect(o.evidence?.date).toBeTruthy(); }
      if (o.stage === "lost") expect(o.lostReason).toBeTruthy();
    }
  });
  it("never offers Won or Lost as a plain stage move", () => {
    for (const s of STAGES) { const m = allowedMoves(s.id); expect(m).not.toContain("won"); expect(m).not.toContain("lost"); expect(m).not.toContain(s.id); }
    expect(allowedMoves("won")).toEqual([]);
  });
  it("labels every external-looking address as a reserved example domain and phones as fictional", () => {
    for (const c of CONTACTS) { if (c.email) expect(c.email.endsWith("@example.test")).toBe(true); if (c.phone) expect(c.phone).toMatch(/000/); }
  });
  it("keeps one currency per opportunity and shows currencies separately", () => {
    for (const o of OPPORTUNITIES) expect(["AED", "SAR", "EUR"]).toContain(o.currency);
    expect(new Set(FINANCE_SAMPLE.map((r) => r.currency)).size).toBe(FINANCE_SAMPLE.length);
  });
  it("builds a handover package that is not a project", () => {
    const h = buildHandover(oppById("47"));
    expect(h.confirmation).toContain("Purchase order");
    expect(h).not.toHaveProperty("tasks");
  });
});

describe("one fixed sample clock", () => {
  it("is Monday 19 October 2026, 9:30 am Dubai time", () => {
    expect(NOW).toBe("2026-10-19T09:30");
    expect(TODAY).toBe("2026-10-19");
  });
  it("formats the one primary deadline", () => {
    expect(fmtDue("2026-10-16T16:00")).toBe("Due 16 Oct, 4:00 pm · Dubai time");
    expect(fmtTime("2026-10-19T09:05")).toBe("9:05 am");
    expect(fmtTime("2026-10-19T00:30")).toBe("12:30 am");
    expect(fmtTime("2026-10-19T12:00")).toBe("12:00 pm");
  });
  it("labels overdue, due-today and upcoming consistently", () => {
    expect(dueLabel("2026-10-16T16:00")).toBe("Overdue by 3 days");
    expect(dueLabel("2026-10-17T12:00")).toBe("Overdue by 2 days");
    expect(dueLabel("2026-10-19T09:00")).toBe("Overdue by 30 min");
    expect(dueLabel("2026-10-19T11:00")).toBe("Due today");
    expect(dueLabel("2026-10-20T10:00")).toBe("Due tomorrow");
    expect(dueLabel("2026-10-23T11:00")).toBe("Due in 4 days");
    expect(dueLabel("2026-10-14T12:00", "2026-10-14T11:20")).toBe("Done 14 Oct");
  });
  it("splits every open follow-up into exactly one of overdue, today or upcoming", () => {
    const open = openFollowUps();
    const counts = { overdue: 0, today: 0, upcoming: 0 };
    for (const f of open) counts[dueState(f.dueAt) as keyof typeof counts]++;
    expect(counts.overdue + counts.today + counts.upcoming).toBe(open.length);
    const a = attention();
    expect(a.overdue.length).toBe(counts.overdue);
    expect(a.dueToday.length).toBe(counts.today);
    expect([counts.overdue, counts.today]).toEqual([2, 2]);
  });
  it("keeps created and completed timestamps on completed follow-ups", () => {
    for (const f of FOLLOWUPS.filter((x) => x.doneAt)) { expect(f.createdAt).toBeTruthy(); expect(f.doneAt! >= f.createdAt).toBe(true); }
  });
  it("derives the other attention buckets deterministically", () => {
    const a = attention();
    expect(a.awaitingFirstResponse.map((o) => o.ref)).toEqual(["OPP-2026-0042"]);
    expect(a.installRisks.map((o) => o.ref)).toEqual(["OPP-2026-0044", "OPP-2026-0041", "OPP-2026-0046"]);
    expect(a.proposalPrepOverdue.map((f) => f.oppId)).toEqual(["44"]);
  });
});

describe("equipment availability is separate from commercial confirmation", () => {
  it("records who, when and what every confirmed check covers", () => {
    for (const o of OPPORTUNITIES.filter((x) => x.availability.state === "confirmed")) {
      const a = o.availability;
      if (a.state !== "confirmed") continue;
      expect(a.by && a.at).toBeTruthy();
      expect(a.covers).toBeDefined();
      expect(a.covers!.tech.length).toBeGreaterThan(0);
      expect(equipmentOk(o)).toBe(true);
    }
  });
  it("needs repeating when dates, technologies or quantities change", () => {
    const o = oppById("41");
    const a = o.availability;
    expect(a.state === "confirmed" && a.covers).toBeTruthy();
    const covers = a.state === "confirmed" ? a.covers! : snapshot(o);
    expect(sameSnapshot(covers, snapshot(o))).toBe(true);
    expect(sameSnapshot(covers, { ...snapshot(o), eventStart: "2026-12-05" })).toBe(false);
    expect(sameSnapshot(covers, { ...snapshot(o), tech: o.technologies.map((t, i) => ({ ...t, qty: i === 0 ? t.qty + 1 : t.qty })) })).toBe(false);
  });
  it("has an opportunity with a confirmed check that is still not commercially confirmed", () => {
    const o = oppById("41");
    expect(o.stage).toBe("proposal_sent");
    expect(equipmentOk(o)).toBe(true);
    expect(commercialStatus(o)).toBe("Not commercially confirmed");
  });
  it("makes only a PO or authorised email count as commercial confirmation", () => {
    for (const o of OPPORTUNITIES) expect(commercialStatus(o) === "Commercially won").toBe(o.stage === "won" && !!o.evidence);
  });
});

describe("approval states", () => {
  it("covers not configured, not required and required across the companies", () => {
    expect(new Set(Object.values(APPROVAL_POLICY).map((p) => p.policy))).toEqual(new Set(["not_configured", "not_required", "required"]));
  });
  it("only records approvals where approval is required, and has pending, approved and changes requested examples", () => {
    for (const r of APPROVAL_RECORDS) expect(APPROVAL_POLICY[oppById(r.oppId).company].policy).toBe("required");
    expect(new Set(APPROVAL_RECORDS.map((r) => r.state))).toEqual(new Set(["pending", "approved", "changes_requested"]));
  });
  it("never treats a sent version as an approval", () => {
    const o = oppById("41");
    const sent = PROPOSALS.find((p) => p.oppId === o.id && p.status === "sent")!;
    expect(sent).toBeDefined();
    expect(APPROVAL_RECORDS.find((r) => r.oppId === o.id && r.version === sent.version)).toBeUndefined();
  });
  it("invents no thresholds or approvers", () => {
    expect(JSON.stringify(APPROVAL_POLICY)).not.toMatch(/\d{3,}/);
  });
});

describe("workload and site bookings", () => {
  it("treats several projects on one day as normal, not a problem", () => {
    expect(multiProjectDays()).toBeGreaterThan(0);
    expect(daysWithoutAllocation()).toBeGreaterThan(0);
    expect(TEAM_PLAN.some((p) => p.days.some((d) => d.filter((x) => x.type === "office").length > 1))).toBe(true);
    expect(TEAM_PLAN.some((p) => p.days.some((d) => d.filter((x) => x.type === "workshop").length > 1))).toBe(true);
  });
  it("finds the one real site-booking conflict, using travel and preparation buffers", () => {
    const c = siteConflicts();
    expect(c).toHaveLength(1);
    expect(c[0]!.a.person).toBe("Nadia Farouk");
    expect(siteConflicts(SITE_BOOKINGS.filter((b) => b.id === "sb3"))).toHaveLength(0);
  });
  it("blocks only confirmed site commitments, whatever the job title", () => {
    const base = SITE_BOOKINGS[0]!;
    const a = { ...base, id: "x1", start: "2026-11-10T08:00", end: "2026-11-10T10:00", travelMin: 60, prepMin: 30 };
    const touching = { ...base, id: "x2", start: "2026-11-10T11:00", end: "2026-11-10T13:00", travelMin: 60, prepMin: 30 };
    const clear = { ...base, id: "x3", start: "2026-11-10T14:30", end: "2026-11-10T16:00", travelMin: 60, prepMin: 30 };
    expect(bookingWindow(a).to).toBeGreaterThan(bookingWindow(touching).from);
    expect(siteConflicts([a, touching])).toHaveLength(1);
    expect(siteConflicts([a, clear])).toHaveLength(0);
    expect(siteConflicts([a, { ...touching, confirmed: false }])).toHaveLength(0);
    expect(siteConflicts([a, { ...touching, person: "Someone Else", title: "Engineer" }])).toHaveLength(0);
  });
});

describe("source hygiene for the preview", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files: string[] = [];
  (function walk(dir: string) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) files.push(p);
    }
  })(root);
  const source = files.map((f) => [f, readFileSync(f, "utf8")] as const);

  it("never reads the real clock", () => {
    for (const [f, s] of source) { expect(s, f).not.toMatch(/Date\.now\(|new Date\(\s*\)|performance\.now\(/); }
  });
  it("does not use conflict wording for several projects", () => {
    for (const [f, s] of source) { expect(s, f).not.toMatch(/Double-booked|Double booked|Competing|Unassigned days/); }
  });
  it("does not use the old ambiguous or incorrect wording", () => {
    for (const [f, s] of source) {
      expect(s, f).not.toMatch(/paid or reconciled|Approved to send|Confirmed by \$\{|Confirmed by \{|no approval is required because|so none is required/i);
    }
  });
  it("never writes or sends: no fetch, forms posting, storage or network calls", () => {
    for (const [f, s] of source) { expect(s, f).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|supabase|localStorage\.setItem|method=["']post/i); }
  });
});

void ZOHO;
