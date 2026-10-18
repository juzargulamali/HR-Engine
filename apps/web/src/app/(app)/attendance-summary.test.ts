import { describe, expect, it } from "vitest";
import { attendanceSentence, noRecordHint } from "./attendance-summary";
import { attentionSentence, buildActionItems, type ActionItem } from "./action-centre";

const base = { totalEmployees: 11, notRecordedCount: 10, notRecordedScheduledCount: 0, notRecordedRestCount: 0, notRecordedUnknownCount: 0 };

describe("attendanceSentence", () => {
  it("on a scheduled workday names the people who should have recorded something", () => {
    const s = attendanceSentence({ ...base, notRecordedCount: 10, notRecordedScheduledCount: 10 });
    expect(s).toBe("Attendance is recorded for 1 of 11 employees today. 10 scheduled to work have no attendance recorded yet.");
  });
  it("on a weekly rest day or public holiday a missing record is not described as a gap", () => {
    const s = attendanceSentence({ ...base, notRecordedRestCount: 10 });
    expect(s).toContain("10 are on a weekly rest day or public holiday, so no attendance is expected.");
    expect(s).not.toMatch(/scheduled to work|missing|no attendance recorded yet/i);
  });
  it("separates the three groups when a company spans calendars", () => {
    const s = attendanceSentence({ totalEmployees: 8, notRecordedCount: 6, notRecordedScheduledCount: 2, notRecordedRestCount: 3, notRecordedUnknownCount: 1 });
    expect(s).toContain("2 scheduled to work have no attendance recorded yet.");
    expect(s).toContain("3 are on a weekly rest day or public holiday");
    expect(s).toContain("1 could not be classified for today");
  });
  it("handles singular wording and never says anyone is 'in' (present, on leave and clocked in are different facts)", () => {
    const s = attendanceSentence({ totalEmployees: 1, notRecordedCount: 1, notRecordedScheduledCount: 1, notRecordedRestCount: 0, notRecordedUnknownCount: 0 });
    expect(s).toBe("Attendance is recorded for 0 of 1 employee today. 1 scheduled to work has no attendance recorded yet.");
    expect(s).not.toMatch(/\bin today\b|everyone/i);
  });
});

describe("attention sentence and card come from the same items", () => {
  const sales: ActionItem[] = [{ key: "sales-overdue", icon: (() => null) as never, label: "Sales follow-ups overdue", count: 2, href: "/sales/follow-ups" }];
  it("never says nothing is waiting while a card row exists (Sales rows count too)", () => {
    const items = buildActionItems({ myPendingApprovals: 0, extraItems: sales });
    expect(items).toHaveLength(1);
    expect(attentionSentence(items)).toBe("Your updates for today: 2 items need your attention.");
    expect(attentionSentence(items)).not.toMatch(/nothing/i);
  });
  it("says nothing needs attention only when the card has no rows", () => {
    const items = buildActionItems({ myPendingApprovals: 0, contractsEndingCount: 0, probationDueCount: 0, docsExpiringCount: 0, identityExpiringCount: 0, extraItems: [{ ...sales[0]!, count: 0 }] });
    expect(items).toEqual([]);
    expect(attentionSentence(items)).toBe("Nothing needs your attention right now.");
  });
  it("counts approvals and HR rows, and uses the singular for one", () => {
    const items = buildActionItems({ myPendingApprovals: 1, contractsEndingCount: 0, docsExpiringCount: 0 });
    expect(items.map((i) => i.key)).toEqual(["approvals"]);
    expect(attentionSentence(items)).toBe("Your updates for today: 1 item needs your attention.");
  });
  it("HR rows only appear when the caller supplies them (people without HR visibility never get them)", () => {
    expect(buildActionItems({ myPendingApprovals: 2 }).map((i) => i.key)).toEqual(["approvals"]);
  });
});

describe("noRecordHint", () => {
  it("on a normal workday with a gap, says who should have recorded", () => {
    expect(noRecordHint({ notRecordedScheduledCount: 3, notRecordedRestCount: 0, notRecordedUnknownCount: 0 })).toBe("Scheduled to work, nothing recorded yet");
  });
  it("when everyone scheduled has a record, says so instead of implying a problem", () => {
    expect(noRecordHint({ notRecordedScheduledCount: 0, notRecordedRestCount: 0, notRecordedUnknownCount: 0 })).toBe("Everyone scheduled to work has a record");
  });
  it("on a rest day or holiday the zero is explained, not read as a failure", () => {
    expect(noRecordHint({ notRecordedScheduledCount: 0, notRecordedRestCount: 8, notRecordedUnknownCount: 0 })).toBe(
      "No one scheduled to work is without a record. 8 on a weekly rest day or public holiday (no attendance expected)",
    );
  });
  it("mixed calendars and unclassified people are accounted for in words", () => {
    const h = noRecordHint({ notRecordedScheduledCount: 2, notRecordedRestCount: 3, notRecordedUnknownCount: 1 });
    expect(h).toContain("Scheduled to work, nothing recorded yet");
    expect(h).toContain("3 more on a weekly rest day or public holiday (no attendance expected)");
    expect(h).toContain("1 more not classified (no workweek data for their country)");
  });
});
