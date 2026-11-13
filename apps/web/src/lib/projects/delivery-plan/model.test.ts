import { describe, expect, it } from "vitest";
import { byZone, canEditSection, describeChange, itemProgress, lineProgress, releasePreview, sectionFamily, type DpItem, type DpLine, type DpSection } from "./model";

const line = (over: Partial<DpLine>): DpLine => ({ id: "l", key: "L0001", section: "content", description: "Welcome loop", qty: null, inv_item_id: null, assignee_id: null, assignee_name: null, needed_by: null, notes: null, released_at: null, version: 1, task: null, equipment: null, ...over });
const item = (over: Partial<DpItem>): DpItem => ({ id: "i", key: "D001", zone: "Entrance", title: "LED wall", specs: null, owner_id: null, owner_name: null, needed_by: null, image_file_id: null, released_at: null, version: 1, sort_order: 0, lines: [], ...over });
const task = (status: string, blocked = false) => ({ id: "t", title: "x", status, due_date: null, blocked, assignee_name: "Fictional Tom" });

describe("Delivery plan: progress comes from the linked records", () => {
  it("a line that was not released is a draft, whatever else is set", () => {
    expect(lineProgress(line({}))).toMatchObject({ state: "draft", text: "Draft: not released" });
  });
  it("a work line reads its task: not started, in progress, in review, done, blocked, cancelled", () => {
    const r = (s: string, b = false) => lineProgress(line({ released_at: "x", task: task(s, b) })).text;
    expect([r("todo"), r("in_progress"), r("ready_for_review"), r("done"), r("in_progress", true), r("cancelled"), r("deferred")]).toEqual(["Task not started", "Task in progress", "Task in review", "Task done", "Task blocked", "Task cancelled", "Task deferred"]);
    expect(lineProgress(line({ released_at: "x", task: task("done", true) })).state).toBe("done");          // a finished task is not "blocked"
  });
  it("a released line whose record cannot be read says so, never 'not started'", () => {
    expect(lineProgress(line({ released_at: "x", task: null })).text).toBe("Task could not be read");
    expect(lineProgress(line({ released_at: "x", section: "hardware", equipment: { missing: true } })).text).toBe("Equipment line could not be read");
  });
  it("a hardware line reads the equipment line: draft request, with the warehouse, reserved, sent, and what is still out", () => {
    const e = (equipment: DpLine["equipment"]) => lineProgress(line({ released_at: "x", section: "hardware", equipment })).text;
    expect(e({ request_status: "draft", request_code: "EQ-1", qty: 48 })).toBe("On draft request EQ-1: not submitted to Warehouse");
    expect(e({ request_status: "submitted", request_code: "EQ-1", qty: 48 })).toBe("Waiting for Warehouse (EQ-1)");
    expect(e({ request_status: "in_progress", qty: 48, reserved: 40 })).toBe("Reserved 40 of 48");
    expect(e({ request_status: "in_progress", qty: 48, reserved: 48, dispatched: 48 })).toBe("Sent 48 of 48, 48 still out");
    expect(e({ request_status: "fulfilled", qty: 48, reserved: 48, dispatched: 48, returned: 30 })).toBe("Sent 48 of 48, 30 returned, 18 still out");   // a partial return stays visible
    expect(e({ request_status: "closed", qty: 48, reserved: 48, dispatched: 48, returned: 48 })).toBe("Returned 48 of 48 sent");
  });
  it("a deliverable sums its lines: sent equipment and done tasks are finished, drafts are counted apart", () => {
    const it1 = item({ lines: [line({ released_at: "x", task: task("done") }), line({ released_at: "x", task: task("todo") }), line({})] });
    expect(itemProgress(it1)).toMatchObject({ total: 3, released: 2, finished: 1, drafts: 1, text: "1 of 2 released lines finished, 1 still draft" });
    expect(itemProgress(item({})).text).toBe("No breakdown yet");
    expect(itemProgress(item({ lines: [line({}), line({})] })).text).toBe("2 draft lines, nothing released");
  });
});

describe("Delivery plan: screens", () => {
  it("groups deliverables by zone in plan order, without regard to case; an empty zone is 'No zone'", () => {
    const g = byZone([item({ id: "1", zone: "Entrance" }), item({ id: "2", zone: "Lounge" }), item({ id: "3", zone: "entrance " }), item({ id: "4", zone: "" })]);
    expect(g.map((x) => [x.zone, x.items.map((i) => i.id)])).toEqual([["Entrance", ["1", "3"]], ["Lounge", ["2"]], ["No zone", ["4"]]]);
  });
  it("the manager edits every section; a delegate only theirs", () => {
    expect(canEditSection({ can_manage: true, my_sections: [] }, "testing")).toBe(true);
    expect(canEditSection({ can_manage: false, my_sections: ["content"] }, "content")).toBe(true);
    expect(canEditSection({ can_manage: false, my_sections: ["content"] }, "hardware")).toBe(false);
  });
  it("says what a release will create and what will wait, before anything is created", () => {
    const p = releasePreview([item({ owner_id: "o", lines: [line({}), line({ section: "hardware", inv_item_id: "x" }), line({ key: "L0003", section: "hardware" }), line({ released_at: "x", task: task("todo") })] }),
      item({ lines: [line({ key: "L0009" }), line({ assignee_id: "a" })] })]);
    expect(p).toEqual({ tasks: 2, equipment: 1, external: 0, waiting: [{ key: "L0003", reason: "needs a stock match" }, { key: "L0009", reason: "nobody named, and the deliverable has no accountable owner" }] });
  });
  it("counts hardware that is bought, rented or client supplied as followed in the plan, not requested", () => {
    const p = releasePreview([item({ owner_id: "o", lines: [line({ section: "hardware", supply_route: "rent" }), line({ key: "L2", section: "hardware", supply_route: "client" }), line({ key: "L3", section: "hardware", inv_item_id: "x", supply_route: "inventory" })] })]);
    expect(p).toEqual({ tasks: 0, equipment: 1, external: 2, waiting: [] });
  });
  it("a delegate of an earlier section keeps editing the matching current one, and nothing else", () => {
    const plan = { can_manage: false, my_sections: ["programming", "installation"] as DpSection[] };
    expect([sectionFamily("programming"), sectionFamily("testing"), sectionFamily("hardware")]).toEqual(["apps", "site", "hardware"]);
    expect(["apps", "programming", "site", "testing", "installation", "content", "engineering", "hardware"].map((s) => canEditSection(plan, s as DpSection))).toEqual([true, true, true, true, true, false, false, false]);
    expect(canEditSection({ can_manage: true, my_sections: [] }, "engineering")).toBe(true);
  });
  it("words a proposed change field by field, resolving people and saying when a value is not set", () => {
    expect(describeChange({ changes: { qty: { from: 3, to: "5" }, needed_by: { from: null, to: "2027-02-20" }, assignee_id: { from: "u1", to: "u2" } } }, (f, v) => (f === "assignee_id" ? `Person ${v}` : v)))
      .toEqual(["Quantity: 3 to 5", "Needed by: not set to 2027-02-20", "Assigned to: Person u1 to Person u2"]);
  });
});
