import { describe, expect, it } from "vitest";
import { activationReadiness, autoMode, barPosition, formatSpan, hardwareState, lateDependency, lineSchedule, milestoneProgress, planSummary, timelineModel, timelineScale, todayScrollTarget, DAY_PX, WEEK_PX_PER_DAY } from "./insights";
import type { DeliveryPlan, DpItem, DpLine, DpMilestone } from "./model";

// Fictional data only.
const line = (o: Partial<DpLine> = {}): DpLine => ({
  id: "l1", key: "L0001", section: "content", description: "Storyboard", qty: null, inv_item_id: null, assignee_id: null, assignee_name: null, needed_by: null, notes: null,
  released_at: null, version: 1, task: null, equipment: null, ...o,
});
const item = (o: Partial<DpItem> = {}): DpItem => ({ id: "i1", key: "D001", zone: "", title: "Photobooth", specs: null, owner_id: null, owner_name: null, needed_by: null, image_file_id: null, released_at: null, version: 1, sort_order: 10, lines: [], qty: 2, ...o });
const plan = (items: DpItem[], o: Partial<DeliveryPlan> = {}): DeliveryPlan => ({ rev: 1, can_manage: true, my_sections: [], delegations: [], items, corrections: [], changes: [], ...o });
const task = (o: Partial<NonNullable<DpLine["task"]>> = {}) => ({ id: "t1", title: "Photobooth: Storyboard", status: "todo", due_date: "2027-04-08", blocked: false, assignee_name: "Dina", start_date: "2027-04-04", depends_on: [], ...o });

describe("lineSchedule", () => {
  it("reads owner and dates from the linked task once released, and from the plan (then the deliverable) before", () => {
    const it = item({ owner_name: "Omar", needed_by: "2027-04-30" });
    expect(lineSchedule(it, line({ released_at: "x", task: task() }))).toMatchObject({ owner: "Dina", start: "2027-04-04", due: "2027-04-08", fromTask: true });
    expect(lineSchedule(it, line())).toMatchObject({ owner: "Omar", ownerInherited: true, start: null, due: "2027-04-30", fromTask: false });
    expect(lineSchedule(it, line({ assignee_name: "Sam", start_date: "2027-04-01", needed_by: "2027-04-02" }))).toMatchObject({ owner: "Sam", ownerInherited: false, start: "2027-04-01", due: "2027-04-02" });
  });
});

describe("hardwareState", () => {
  const hw = (o: Partial<DpLine> = {}) => line({ section: "hardware", description: "Ring light", ...o });
  it("names what an unmatched or externally supplied line still needs", () => {
    expect(hardwareState(line())).toBeNull();
    expect(hardwareState(hw({ notes: "" }))).toMatchObject({ text: "Specification pending", needsAction: true });
    expect(hardwareState(hw({ notes: "18 in ring light" }))).toMatchObject({ text: "Needs stock match", needsAction: true });
    expect(hardwareState(hw({ inv_item_id: "inv", notes: "x" }))).toMatchObject({ text: "Matched to stock: ready to release", needsAction: false });
    expect(hardwareState(hw({ supply_route: "buy", notes: "x" }))?.text).toMatch(/Needs sourcing \(Buy\): no owner/);
    expect(hardwareState(hw({ supply_route: "rent", notes: "x", assignee_id: "a", detail: { expected_date: "2027-04-27" } }))).toMatchObject({ text: "Rent: expected 2027-04-27", needsAction: false });
    expect(hardwareState(hw({ supply_route: "client" }))?.text).toMatch(/expected date not recorded/);
  });
  it("shows Reserved / Sent / Returned only from the Inventory record, and says so when it cannot be read", () => {
    const released = hw({ inv_item_id: "inv", released_at: "x" });
    expect(hardwareState({ ...released, equipment: { request_status: "draft", request_code: "REQ-1", qty: 2, reserved: 0, dispatched: 0, returned: 0 } })?.text).toMatch(/draft request REQ-1/);
    expect(hardwareState({ ...released, equipment: { request_status: "submitted", qty: 2, reserved: 2, dispatched: 0, returned: 0 } })?.text).toBe("Reserved 2 of 2");
    expect(hardwareState({ ...released, equipment: { missing: true } })).toMatchObject({ tone: "red", needsAction: true });
  });
});

describe("attention and the next-step summary", () => {
  const story = line({ id: "s", key: "L0001", released_at: "x", task: task({ blocked: true, blocked_reason: "Waiting for the script", unblock_action: "Chase the client" }), assignee_name: "Dina" });
  const draft = line({ id: "d", key: "L0002", description: "First draft", released_at: "x", task: task({ id: "t2", title: "Photobooth: First draft", start_date: "2027-04-06", due_date: "2027-04-12", depends_on: [{ task_id: "t1", title: "Photobooth: Storyboard", status: "in_progress", due_date: "2027-04-08", line_key: "L0001" }] }) });
  const noOwner = line({ id: "n", key: "L0003", description: "Final export" });
  const manual = line({ id: "m", key: "L0004", section: "hardware", description: "Ring light", notes: "" });
  const eq = line({ id: "e", key: "L0005", section: "hardware", description: "Screens", inv_item_id: "x", released_at: "x", equipment: { request_status: "draft", request_code: "REQ-1", qty: 2 } });
  const p = plan([item({ lines: [eq, manual, noOwner, draft, story] })], { site_dates: { install_start: "2027-05-01", event_start: "2027-05-03", event_end: "2027-05-04" } });
  it("orders open blockers first, then owners, late dependencies, sourcing and drafts, and names the next action", () => {
    const s = planSummary(p, "2027-04-05");
    expect(s.attention.map((a) => a.kind)).toEqual(["blocker", "no_owner", "late_dependency", "sourcing", "draft_ready"]);
    expect(s.next).toMatchObject({ kind: "blocker", lineKey: "L0001" });
    expect(s.next?.text).toMatch(/Waiting for the script.*Next: Chase the client/);
    expect(s.counts).toMatchObject({ blocker: 1, no_owner: 1, late_dependency: 1, sourcing: 1, draft_ready: 1, overdue: 0 });
    expect(s.nextSite).toEqual({ date: "2027-05-01", label: "Installation starts" });
    expect(s.lines).toBe(5);
    expect(s.released).toBe(3);
  });
  it("flags a late storyboard against the first draft that waits for it, and an overdue open task", () => {
    expect(lateDependency(item(), draft)).toBe("Storyboard is due 2027-04-08, after this starts on 2027-04-06");
    expect(planSummary(p, "2027-04-20").counts.overdue).toBe(2);
    const finishedDep = line({ ...draft, task: task({ id: "t2", start_date: "2027-04-06", depends_on: [{ task_id: "t1", title: "x", status: "done", due_date: "2027-04-08" }] }) });
    expect(lateDependency(item(), finishedDep)).toBeNull();
  });
  it("tells a clear plan from an empty one, and a past site date from none", () => {
    const clear = planSummary(plan([item({ owner_name: "O", lines: [line({ assignee_name: "Dina", released_at: "x", task: task() })] })]), "2027-04-01");
    expect(clear.attention).toEqual([]); expect(clear.next).toBeNull(); expect(clear.lines).toBe(1); expect(clear.siteRecorded).toBe(false);
    expect(planSummary(plan([]), "2027-04-01")).toMatchObject({ lines: 0, next: null });
    expect(planSummary(plan([], { site_dates: { install_start: "2027-03-01", event_start: null, event_end: null } }), "2027-04-01")).toMatchObject({ nextSite: null, siteRecorded: true });
    expect(planSummary(plan([], { scope: { brief: "x", technologies: [], pending: [{ name: "Photobooth" }] } }), "2027-04-01").pendingScope).toBe(1);
  });
  it("an equipment line that cannot be read is a finding, never a clear row", () => {
    const bad = line({ id: "b", key: "L0009", section: "hardware", description: "Kiosk", inv_item_id: "x", released_at: "x", equipment: { missing: true } });
    expect(planSummary(plan([item({ lines: [bad] })]), "2027-04-01").attention[0]).toMatchObject({ kind: "unread" });
  });
  it("summarises an activation's readiness", () => {
    expect(activationReadiness(item(), "2027-04-05")).toMatchObject({ text: "No requirements yet" });
    const r = activationReadiness(item({ lines: [story, draft] }), "2027-04-05");
    expect(r).toMatchObject({ tone: "red", blockers: 2 });
    expect(r.text).toBe("0 of 2 lines done · 2 need attention");
  });
});

describe("milestoneProgress", () => {
  const ms = (o: Partial<DpMilestone> = {}): DpMilestone => ({
    id: "m", title: "Ready for mockup", due_date: "2027-04-20", status: "planned", is_required: true,
    tasks: [
      { task_id: "a", title: "Moodboard", status: "done", due_date: "2027-04-03", blocked: false, assignee_name: "Dina" },
      { task_id: "b", title: "Storyboard", status: "in_progress", due_date: "2027-04-08", blocked: false, assignee_name: "Dina" },
      { task_id: "c", title: "First draft", status: "todo", due_date: "2027-04-25", blocked: false, assignee_name: "Dina" },
    ],
    planned: [{ line_id: "p", line_key: "L0009", title: "Photobooth: On-device test", item_key: "D001", needed_by: "2027-04-19", assignee_name: null }], ...o,
  });
  it("counts what is complete, lists what is outstanding (released or not), and keeps readiness apart from confirmation", () => {
    const p = milestoneProgress(ms());
    expect(p.label).toBe("1 of 4 complete");
    expect(p.outstanding.map((o) => [o.title, o.planned])).toEqual([["Storyboard", false], ["First draft", false], ["Photobooth: On-device test", true]]);
    expect(p).toMatchObject({ ready: false, confirmed: false });
    expect(p.atRisk).toMatch(/2027-04-25 is after the milestone date 2027-04-20/);
    const all = milestoneProgress(ms({ tasks: ms().tasks.map((t) => ({ ...t, status: "done" })), planned: [] }));
    expect(all).toMatchObject({ ready: true, confirmed: false, label: "3 of 3 complete", atRisk: null });
    expect(milestoneProgress(ms({ status: "accepted", tasks: [], planned: [] }))).toMatchObject({ confirmed: true, ready: false, label: "No tasks linked yet" });
  });
});

describe("timeline", () => {
  const p = plan([item({ owner_name: "Omar", needed_by: "2027-05-10", lines: [
    line({ id: "a", key: "L0001", description: "Moodboard", assignee_name: "Dina", start_date: "2027-04-14", needed_by: "2027-04-16" }),
    line({ id: "b", key: "L0002", description: "Storyboard", start_date: "2027-04-17", needed_by: "2027-04-17" }),
    line({ id: "c", key: "L0003", section: "apps", description: "Push Buttons", needed_by: "2027-04-20" }),
    line({ id: "d", key: "L0004", description: "Crosses a month", start_date: "2027-04-29", needed_by: "2027-05-02" }),
    line({ id: "e", key: "L0005", section: "hardware", description: "Draft hardware, activation date only" }),
  ] }), item({ id: "i2", key: "D002", title: "Nothing dated", lines: [line({ id: "f", key: "L0006", description: "No dates anywhere" })] })]);
  it("draws activations and lines from the plan; every row has a shape and exact dates; a draft with no due date of its own takes its activation's; unscheduled work is listed, not dropped", () => {
    const t = timelineModel(p, "2027-04-01");
    const by = Object.fromEntries(t.rows.map((r) => [r.label, r]));
    expect(t.rows.filter((r) => r.kind === "activation").map((r) => r.label)).toEqual(["Photobooth", "Nothing dated"]);
    expect(by["Moodboard"]).toMatchObject({ shape: "range", start: "2027-04-14", due: "2027-04-16", inherited: false });
    expect(by["Storyboard"]).toMatchObject({ shape: "single" });
    expect(by["Push Buttons"]).toMatchObject({ shape: "due", start: null, due: "2027-04-20" });
    expect(by["Crosses a month"]).toMatchObject({ shape: "range" });
    expect(by["Draft hardware, activation date only"]).toMatchObject({ shape: "due", due: "2027-05-10", inherited: true });
    expect(by["No dates anywhere"]).toMatchObject({ shape: "none", unscheduled: true });
    expect(t.unscheduled.map((r) => r.label)).toEqual(["No dates anywhere"]);
    expect(t.range).toEqual({ start: "2027-04-14", end: "2027-05-10" });
    expect(by["Photobooth"]).toMatchObject({ start: "2027-04-14", due: "2027-05-10" });
    expect(timelineModel(plan([]), "2027-04-01")).toMatchObject({ rows: [], range: null, scale: null, unscheduled: [] });
  });
  it("a released requirement is drawn on its task's CURRENT dates, not the plan's", () => {
    const released = plan([item({ lines: [line({ id: "r", key: "L0001", description: "Moodboard", start_date: "2027-04-14", needed_by: "2027-04-16", released_at: "x", task: task({ start_date: "2027-04-20", due_date: "2027-04-23" }) })] })]);
    expect(timelineModel(released, "2027-04-01").rows[1]).toMatchObject({ start: "2027-04-20", due: "2027-04-23", shape: "range", inherited: false });
  });
  it("says each row's dates exactly: a range, one day, a range across a month, a due date only, a start only, none; the year only when it is not this year or the dates cross years", () => {
    const t = "2027-04-01";
    expect(formatSpan("2027-04-14", "2027-04-16", t)).toBe("14–16 Apr");
    expect(formatSpan("2027-04-17", "2027-04-17", t)).toBe("17 Apr");
    expect(formatSpan("2027-04-29", "2027-05-02", t)).toBe("29 Apr – 2 May");
    expect(formatSpan(null, "2027-04-16", t)).toBe("Due 16 Apr");
    expect(formatSpan("2027-04-14", null, t)).toBe("Starts 14 Apr");
    expect(formatSpan(null, null, t)).toBe("No dates");
    expect(formatSpan("2027-12-30", "2028-01-02", t)).toBe("30 Dec 2027 – 2 Jan 2028");
    expect(formatSpan("2028-02-01", "2028-02-03", t)).toBe("1–3 Feb 2028");
    expect(formatSpan(null, "2028-02-03", t)).toBe("Due 3 Feb 2028");
  });
  it("a short schedule gets a column for every day (at least a week) and bars aligned to those columns; first and last days are exact", () => {
    const sc = timelineScale({ start: "2027-04-14", end: "2027-04-20" });
    expect(sc.mode).toBe("day");
    expect(sc.days).toEqual(["2027-04-14", "2027-04-15", "2027-04-16", "2027-04-17", "2027-04-18", "2027-04-19", "2027-04-20"]);
    expect(sc.labels).toHaveLength(7);
    const first = barPosition(sc, "2027-04-14", "2027-04-16")!;
    expect(first.left).toBe(0); expect(first.width).toBeCloseTo((3 / 7) * 100, 6);                  // 14, 15, 16: three columns
    const one = barPosition(sc, "2027-04-17", "2027-04-17")!;
    expect(one.left).toBeCloseTo((3 / 7) * 100, 6); expect(one.width).toBeCloseTo((1 / 7) * 100, 6);   // exactly the 17th
    const dueOnly = barPosition(sc, null, "2027-04-20")!;
    expect(dueOnly.left).toBeCloseTo((6 / 7) * 100, 6); expect(dueOnly.width).toBeCloseTo((1 / 7) * 100, 6);
    const last = barPosition(sc, "2027-04-19", "2027-04-20")!;
    expect(last.left + last.width).toBeCloseTo(100, 6);                                             // the last scheduled day ends at the right edge
    expect(barPosition(sc, null, null)).toBeNull();
    expect(timelineScale({ start: "2027-04-14", end: "2027-04-14" }).days).toHaveLength(7);           // one date still gets a week of context
  });
  it("a range that crosses into the next month stays aligned, and a long schedule switches to weekly labels with a width that scrolls", () => {
    const sc = timelineScale({ start: "2027-04-28", end: "2027-05-03" });
    expect(sc.days).toHaveLength(7);
    const cross = barPosition(sc, "2027-04-29", "2027-05-02")!;
    expect(cross.left).toBeCloseTo((1 / 7) * 100, 6); expect(cross.width).toBeCloseTo((4 / 7) * 100, 6);
    const long = timelineScale({ start: "2027-04-14", end: "2027-07-14" });
    expect(long.mode).toBe("week");
    expect(long.labels.map((l) => l.date).slice(0, 3)).toEqual(["2027-04-14", "2027-04-21", "2027-04-28"]);
    expect(long.labels.every((l) => l.index % 7 === 0)).toBe(true);
    expect(long.widthPx).toBeGreaterThan(1500);
    const edge = timelineScale({ start: "2027-04-14", end: "2027-05-14" });                          // 31 days: still a column per day
    expect(edge.mode).toBe("day"); expect(edge.days).toHaveLength(31);
    expect(timelineScale({ start: "2027-04-14", end: "2027-05-15" }).mode).toBe("week");
  });
  it("Day view gives every day a readable minimum width: a 7-day plan is narrow enough to fit, a 9- and a 30-day plan are wider than a screen and scroll inside the chart", () => {
    expect(DAY_PX).toBeGreaterThanOrEqual(56);
    const seven = timelineScale({ start: "2027-04-14", end: "2027-04-20" });
    expect(seven.mode).toBe("day"); expect(seven.widthPx).toBe(7 * DAY_PX); expect(seven.widthPx).toBeLessThan(700);
    const nine = timelineScale({ start: "2027-04-14", end: "2027-04-22" });
    expect(nine.days).toHaveLength(9); expect(nine.widthPx).toBe(9 * DAY_PX);
    const thirty = timelineScale({ start: "2027-04-01", end: "2027-04-30" });
    expect(thirty.mode).toBe("day"); expect(thirty.days).toHaveLength(30); expect(thirty.widthPx).toBe(30 * DAY_PX); expect(thirty.widthPx).toBeGreaterThan(1500);
    expect(thirty.labels).toHaveLength(30);
  });
  it("an explicit mode overrides the length: Week groups a short plan by week, Day opens a long one day by day", () => {
    const range = { start: "2027-04-01", end: "2027-04-30" };
    const week = timelineScale(range, "week");
    expect(week.mode).toBe("week"); expect(week.labels.map((l) => l.date)).toEqual(["2027-04-01", "2027-04-08", "2027-04-15", "2027-04-22", "2027-04-29"]);
    expect(week.widthPx).toBe(30 * WEEK_PX_PER_DAY < 360 ? 360 : 30 * WEEK_PX_PER_DAY);
    expect(week.days).toEqual(timelineScale(range, "day").days);                                       // the same days either way, so rows keep their exact dates
    const longDay = timelineScale({ start: "2027-04-14", end: "2027-07-14" }, "day");
    expect(longDay.mode).toBe("day"); expect(longDay.labels).toHaveLength(longDay.days.length); expect(longDay.widthPx).toBe(longDay.days.length * DAY_PX);
    expect(autoMode(31)).toBe("day"); expect(autoMode(32)).toBe("week");
  });
  it("the Today jump centres today in the visible chart and stays within what can scroll; null when today is outside the schedule", () => {
    const sc = timelineScale({ start: "2027-04-01", end: "2027-04-30" });                               // 30 days, 1680px
    const m = { chartW: 1680, labelW: 256, viewportW: 900, scrollW: 256 + 1680 };
    const mid = todayScrollTarget(sc, "2027-04-15", m)!;                                                // index 14: centre at 14.5 * 56 = 812; the chart area is 644 wide
    expect(mid).toBe(Math.round(812 - (900 - 256) / 2));
    expect(todayScrollTarget(sc, "2027-04-01", m)).toBe(0);                                             // the first day cannot go below zero
    expect(todayScrollTarget(sc, "2027-04-30", m)).toBe(256 + 1680 - 900);                              // the last day stops at the far end
    expect(todayScrollTarget(sc, "2027-05-20", m)).toBeNull();
    expect(todayScrollTarget(sc, "2027-03-20", m)).toBeNull();
  });
});

import { detailText } from "./insights";
describe("detailText", () => {
  it("states what a line is, in the words of its section, and says nothing when nothing is recorded", () => {
    expect(detailText(line({ section: "content", detail: { deliverable_type: "Animation", count: 4, format: "MP4", resolution: "1080x1920", orientation: "Portrait" } }))).toBe("Animation × 4 · MP4 · 1080x1920 · Portrait");
    expect(detailText(line({ section: "apps", detail: { app_count: 1, platform: "Android tablet", device_count: 6 } }))).toBe("1 app · Android tablet · 6 devices");
    expect(detailText(line({ section: "site", detail: { kind: "Installation" } }))).toBe("Installation");
    expect(detailText(line({ section: "hardware", detail: { source: "Fictional Hire Ltd", expected_date: "2027-04-27" } }))).toBe("Supplier: Fictional Hire Ltd · expected 2027-04-27");
    expect(detailText(line({ section: "content" }))).toBe("");
  });
});
