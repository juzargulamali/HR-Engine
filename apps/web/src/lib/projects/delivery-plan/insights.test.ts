import { describe, expect, it } from "vitest";
import { activationReadiness, barPosition, hardwareState, lateDependency, lineSchedule, milestoneProgress, planSummary, ticksFor, timelineModel } from "./insights";
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
  const p = plan([item({ owner_name: "Omar", lines: [
    line({ id: "a", key: "L0001", description: "Moodboard", assignee_name: "Dina", start_date: "2027-04-01", needed_by: "2027-04-03" }),
    line({ id: "b", key: "L0002", description: "Storyboard" }),
    line({ id: "c", key: "L0003", section: "site", description: "Install", needed_by: "2027-05-02" }),
  ] })]);
  it("draws activations and lines from the plan, dates across, and lists unscheduled work instead of dropping it", () => {
    const t = timelineModel(p, "2027-04-01");
    expect(t.rows.map((r) => [r.kind, r.label])).toEqual([["activation", "Photobooth"], ["line", "Moodboard"], ["line", "Storyboard"], ["line", "Install"]]);
    expect(t.range).toEqual({ start: "2027-04-01", end: "2027-05-02" });
    expect(t.unscheduled.map((r) => r.label)).toEqual(["Storyboard"]);
    expect(t.rows[0]).toMatchObject({ start: "2027-04-01", due: "2027-05-02", sub: "D001 · × 2" });
    expect(timelineModel(plan([]), "2027-04-01")).toMatchObject({ rows: [], range: null, unscheduled: [] });
  });
  it("places bars across the range and keeps a single date visible", () => {
    const range = { start: "2027-04-01", end: "2027-04-29" };
    const whole = barPosition(range, "2027-04-01", "2027-04-29")!;
    expect(whole.left).toBe(0); expect(Math.round(whole.width)).toBe(100);
    const marker = barPosition(range, null, "2027-04-15")!;
    expect(marker.width).toBeGreaterThan(1); expect(marker.left).toBeGreaterThan(40);
    expect(barPosition(range, null, null)).toBeNull();
    expect(ticksFor(range).map((x) => x.date)).toEqual(["2027-04-01", "2027-04-08", "2027-04-15", "2027-04-22", "2027-04-29"]);
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
