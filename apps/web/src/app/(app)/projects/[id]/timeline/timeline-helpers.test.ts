import { describe, expect, it } from "vitest";
import { bookablePeople, bookingAllowanceText, canBookPerson, hiddenConflictText, isOverlapRefusal, itemMode, localDefault, planBarItems, planItemDays, planItemWhen, sortPlanItems, splitConflicts } from "./timeline-helpers";
import type { ProjPlanItemRow, ProjProjectPersonRow } from "@/types/projects";

const base: ProjPlanItemRow = {
  id: "i", project_id: "p", plan: "site", template_key: null, title: "Installation", start_date: null, end_date: null, starts_at: null, ends_at: null, tz: null, status: "planned",
  client_facing: false, milestone_id: null, notes: null, sort_order: 10, created_by: null, version: 1, created_at: "", updated_at: "",
};
const item = (o: Partial<ProjPlanItemRow>): ProjPlanItemRow => ({ ...base, ...o });

describe("plan item dates", () => {
  it("tells undated, date-only and timed items apart", () => {
    expect(itemMode(item({}))).toBe("undated");
    expect(itemMode(item({ start_date: "2099-03-05" }))).toBe("dates");
    expect(itemMode(item({ starts_at: "2099-03-05T05:00:00Z" }))).toBe("timed");
  });
  it("words a date-only item as plain dates, never a time", () => {
    expect(planItemWhen(item({ start_date: "2099-03-05", end_date: "2099-03-07" }), "Asia/Dubai")).toEqual({ source: "5 Mar 2099 to 7 Mar 2099", viewer: null });
    expect(planItemWhen(item({}), "Asia/Dubai").source).toBe("Not scheduled yet");
  });
  it("shows a timed item in its own zone first and the viewer's time when it differs", () => {
    const i = item({ starts_at: "2099-06-01T05:00:00Z", ends_at: "2099-06-01T13:00:00Z", tz: "Asia/Dubai" });
    expect(planItemWhen(i, "Asia/Dubai").viewer).toBeNull();
    const w = planItemWhen(i, "Europe/Warsaw");
    expect(w.source).toContain("09:00");
    expect(w.viewer).toContain("(your time)");
  });
  it("places an overnight timed item on both days of its own zone across the DST change", () => {
    const i = item({ starts_at: "2099-03-28T21:00:00Z", ends_at: "2099-03-29T04:00:00Z", tz: "Europe/Warsaw" });
    expect(planItemDays(i)).toEqual({ start: "2099-03-28", end: "2099-03-29" });
    expect(planItemDays(item({ start_date: "2099-03-05" }))).toEqual({ start: "2099-03-05", end: "2099-03-05" });
    expect(planItemDays(item({}))).toBeNull();
  });
  it("sorts dated items first, then undated, and leaves cancelled items out of the bars", () => {
    const a = item({ id: "a", title: "A" });
    const b = item({ id: "b", title: "B", start_date: "2099-03-09" });
    const c = item({ id: "c", title: "C", start_date: "2099-03-01" });
    const d = item({ id: "d", title: "D", start_date: "2099-03-02", status: "cancelled" });
    expect(sortPlanItems([a, b, c]).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(planBarItems([a, b, c, d]).map((x) => x.id)).toEqual(["b", "c"]);
  });
  it("converts an instant to the wall-clock value of a zone for editing", () => {
    expect(localDefault("2099-03-28T21:00:00Z", "Europe/Warsaw")).toBe("2099-03-28T22:00");
    expect(localDefault(null, "Europe/Warsaw")).toBe("");
  });
});

describe("who may book whom", () => {
  const people = [
    { user_id: "u1", team_id: "t1" }, { user_id: "u2", team_id: "t2" }, { user_id: "u3", team_id: null },
  ] as ProjProjectPersonRow[];
  it("lets a manager book everybody, a team head only their own team, and a plain member nobody", () => {
    expect(bookablePeople({ canManage: true, headOfTeamIds: [] }, people)).toHaveLength(3);
    expect(bookablePeople({ canManage: false, headOfTeamIds: ["t1"] }, people).map((p) => p.user_id)).toEqual(["u1"]);
    expect(bookablePeople({ canManage: false, headOfTeamIds: [] }, people)).toEqual([]);
    expect(canBookPerson({ canManage: false, headOfTeamIds: ["t1"] }, { team_id: null })).toBe(false);
  });
});

describe("conflicts", () => {
  it("reports hidden conflicts only as a count", () => {
    const rows = [{ is_visible: true, project_reference: "A" }, { is_visible: false, project_reference: null }, { is_visible: false, project_reference: null }];
    const s = splitConflicts(rows);
    expect(s.visible).toHaveLength(1);
    expect(s.hidden).toBe(2);
    expect(hiddenConflictText(1)).toBe("1 booking on projects you cannot see");
    expect(hiddenConflictText(2)).toBe("2 bookings on projects you cannot see");
  });
  it("recognises the overlap refusal", () => {
    expect(isOverlapRefusal("This person already has 1 confirmed site booking(s) that overlap this one")).toBe(true);
    expect(isOverlapRefusal("Only the Project Manager can")).toBe(false);
    expect(isOverlapRefusal(null)).toBe(false);
  });
  it("words the allowances", () => {
    expect(bookingAllowanceText({ lead_minutes: 0, trail_minutes: 0 })).toBe("No preparation or travel allowance");
    expect(bookingAllowanceText({ lead_minutes: 60, trail_minutes: 45 })).toBe("1 h preparation / travel before, 45 min travel after");
  });
});
