import { describe, expect, it } from "vitest";
import { groupOpenFollowUps } from "./follow-up-groups";

const fu = (id: string, due_at: string, status = "open") => ({ id, followUp: { due_at, status } });
// 2026-05-10 12:00 in Dubai (UTC+4) is 08:00Z.
const now = new Date("2026-05-10T08:00:00Z");

describe("groupOpenFollowUps", () => {
  it("splits open follow-ups into overdue, today and upcoming, soonest first", () => {
    const g = groupOpenFollowUps([
      fu("later", "2026-05-20T06:00:00Z"),
      fu("late2", "2026-05-08T06:00:00Z"),
      fu("tonight", "2026-05-10T15:00:00Z"),
      fu("late1", "2026-05-01T06:00:00Z"),
      fu("tomorrow", "2026-05-11T06:00:00Z"),
    ], now);
    expect(g.overdue.map((x) => x.id)).toEqual(["late1", "late2"]);
    expect(g.today.map((x) => x.id)).toEqual(["tonight"]);
    expect(g.upcoming.map((x) => x.id)).toEqual(["tomorrow", "later"]);
  });
  it("ignores follow-ups that are done or cancelled", () => {
    const g = groupOpenFollowUps([fu("a", "2026-05-01T06:00:00Z", "done"), fu("b", "2026-05-01T06:00:00Z", "cancelled")], now);
    expect(g).toEqual({ overdue: [], today: [], upcoming: [] });
  });
});
