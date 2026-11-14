import { describe, expect, it } from "vitest";
import type { CrmReminderRow } from "@/types/crm";
import { currentReminders } from "./reminders-current";

// Fictional data only.
const DUE = "2026-11-06T06:00:00Z";
const rem = (id: string, over: Partial<CrmReminderRow> = {}): CrmReminderRow => ({
  id, user_id: "u-amira", company_id: "c1", opportunity_id: "o1", follow_up_id: "f1", kind: "follow_up_due", title: "Call the fictional agency", due_at: DUE, dedupe_key: id,
  created_at: "2026-11-06T06:05:00Z", read_at: null, email_status: "not_requested", email_attempts: 0, email_next_attempt_at: null, email_last_error: null, email_sent_at: null, ...over,
});
const open = (rows: [string, string, (string | null)?][]) => new Map(rows.map(([id, due_at, opp]) => [id, { due_at, opportunity_id: opp === undefined ? "o1" : opp }]));
const facts = (rows: [string, string, (string | null)?][] = [["f1", DUE]], opportunities?: [string, string][]) => ({ openFollowUps: open(rows), ...(opportunities ? { opportunities: new Map(opportunities.map(([id, stage]) => [id, { stage }])) } : {}) });

describe("one current reminder per follow-up", () => {
  it("the same person holding the due AND the overdue row for one follow-up sees one reminder: the overdue one, with both rows behind it", () => {
    const out = currentReminders([rem("r-due"), rem("r-over", { kind: "follow_up_overdue", created_at: "2026-11-07T06:05:00Z" })], facts());
    expect(out).toHaveLength(1);
    expect(out[0]!.reminder.id).toBe("r-over");
    expect(out[0]!.reminder.kind).toBe("follow_up_overdue");
    expect(out[0]!.ids.sort()).toEqual(["r-due", "r-over"]);
    expect(out[0]!.followUpId).toBe("f1");
  });

  it("overdue wins whatever order the rows arrive in", () => {
    const out = currentReminders([rem("r-over", { kind: "follow_up_overdue" }), rem("r-due", { created_at: "2026-11-09T00:00:00Z" })], facts());
    expect(out.map((c) => c.reminder.id)).toEqual(["r-over"]);
  });

  it("a row written for a due time the follow-up no longer has (rescheduled) is left out, and is not dismissed with the current one", () => {
    const moved = "2026-11-12T11:00:00Z";
    const out = currentReminders([rem("r-old"), rem("r-new", { due_at: moved })], facts([["f1", moved]]));
    expect(out).toHaveLength(1);
    expect(out[0]!.reminder.id).toBe("r-new");
    expect(out[0]!.ids).toEqual(["r-new"]);
    // Only the stale row: nothing is shown for the follow-up until the job writes a reminder for its new time.
    expect(currentReminders([rem("r-old")], facts([["f1", moved]]))).toEqual([]);
  });

  it("the same moment written two ways is the same due time (no false 'rescheduled')", () => {
    expect(currentReminders([rem("r1", { due_at: "2026-11-06T10:00:00+04:00" })], facts())).toHaveLength(1);
  });

  it("a reminder whose follow-up is no longer open (completed, cancelled, or not visible) is left out", () => {
    expect(currentReminders([rem("r1"), rem("r2", { kind: "follow_up_overdue" })], facts([]))).toEqual([]);
  });

  it("different follow-ups stay distinct, even on one enquiry and with the same title", () => {
    const out = currentReminders([rem("r1"), rem("r2", { follow_up_id: "f2" })], facts([["f1", DUE], ["f2", DUE]]));
    expect(out.map((c) => c.followUpId).sort()).toEqual(["f1", "f2"]);
    expect(out.every((c) => c.ids.length === 1)).toBe(true);
  });

  it("reminders about different things on one enquiry stay distinct: a follow-up, a hold review and a missing next action", () => {
    const out = currentReminders([
      rem("r-fu", { opportunity_id: "o2", follow_up_id: "f9" }),
      rem("r-hold", { kind: "hold_review_due", follow_up_id: null, opportunity_id: "o3" }),
      rem("r-none", { kind: "no_next_action", follow_up_id: null, opportunity_id: "o4", due_at: null }),
    ], facts([["f9", DUE, "o2"]]));
    expect(out.map((c) => c.reminder.id)).toEqual(["r-fu", "r-hold", "r-none"]);
  });

  it("a follow-up reminder without a follow-up id is never merged with another", () => {
    const out = currentReminders([rem("r1", { follow_up_id: null }), rem("r2", { follow_up_id: null })], facts());
    expect(out).toHaveLength(2);
  });

  it("'no next action' written on several days for one enquiry is one reminder (the newest), with every day's row behind it", () => {
    const row = (id: string, day: string) => rem(id, { kind: "no_next_action", follow_up_id: null, opportunity_id: "o5", due_at: null, created_at: `2026-11-${day}T03:00:00Z` });
    const out = currentReminders([row("d1", "05"), row("d3", "07"), row("d2", "06")], facts([]));
    expect(out).toHaveLength(1);
    expect(out[0]!.reminder.id).toBe("d3");
    expect(out[0]!.ids.sort()).toEqual(["d1", "d2", "d3"]);
  });

  it("'no next action' is left out once the enquiry has an open follow-up again, or has left the working stages; kept when the page cannot tell", () => {
    const r = rem("n1", { kind: "no_next_action", follow_up_id: null, opportunity_id: "o5", due_at: null });
    expect(currentReminders([r], facts([["f7", DUE, "o5"]]))).toEqual([]);
    expect(currentReminders([r], facts([], [["o5", "won"]]))).toEqual([]);
    expect(currentReminders([r], facts([], [["o5", "qualified"]]))).toHaveLength(1);
    expect(currentReminders([r], facts([]))).toHaveLength(1);
  });

  it("a hold review is left out once the enquiry is no longer on hold; kept while it is, or when the enquiry was not read", () => {
    const r = rem("h1", { kind: "hold_review_due", follow_up_id: null, opportunity_id: "o6" });
    expect(currentReminders([r], facts([], [["o6", "qualified"]]))).toEqual([]);
    expect(currentReminders([r], facts([], [["o6", "on_hold"]]))).toHaveLength(1);
    expect(currentReminders([r], facts([]))).toHaveLength(1);
  });

  it("rows already read are ignored, and the most urgent kind comes first", () => {
    const out = currentReminders([
      rem("read", { read_at: "2026-11-07T00:00:00Z", follow_up_id: "f3" }),
      rem("due", { follow_up_id: "f2" }),
      rem("over", { kind: "follow_up_overdue" }),
    ], facts([["f1", DUE], ["f2", DUE], ["f3", DUE]]));
    expect(out.map((c) => c.reminder.id)).toEqual(["over", "due"]);
  });
});
