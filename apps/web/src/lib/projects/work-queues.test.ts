import { describe, expect, it } from "vitest";
import type { OutputVersion, RegisterRow } from "./phase2/model";
import { workAttention } from "./work-attention";
import { outputQueueItems, taskDonePrefix, type OutputQueueInput } from "./work-queues";

const version = (over: Partial<OutputVersion>): OutputVersion => ({
  id: "v1", version_no: 2, status: "awaiting", item_count: 1, mutable_link: false, note: null, submitted_by: "cara", submitted_by_name: "Cara Assignee", attached_at: "2026-11-10T08:00:00Z", decided_at: null,
  decided_by_name: null, decision_note: null, approved_at: null, approved_by_name: null, file: null, snapshot: null, feedback: [], route: "team", reviewer_id: null, reviewer_name: null,
  is_current: true, needs_reviewer: false, eligible_reviewers: [], can_assign: false, can_decide: false, ...over,
});
const row = (over: Partial<RegisterRow>): RegisterRow => ({
  task_id: "t1", task_title: "Logo reveal", task_status: "ready_for_review", task_due: "2026-11-12", blocked: false, requires_review: true, team_id: "team1", assignee_id: "cara", assignee_name: "Cara Assignee",
  output_label: "Logo video", output_qty: 1, output_required: true, activation: null, milestone: null, state: "awaiting_review", versions_count: 2, current: version({}), versions: [], ...over,
});
const names: Record<string, string> = { cara: "Cara Assignee", pm: "Pia Manager", lead: "Hana Lead", ops: "Lena Ops" };
const input = (rows: RegisterRow[], over: Partial<OutputQueueInput> = {}): OutputQueueInput => ({
  rows, userId: "pm", manager: true, pmName: "Pia Manager", nameOf: (u) => names[u ?? ""] ?? "Unknown", teamLeadName: (t) => (t === "team1" ? "Hana Lead" : null),
  hrefFor: (task, v) => `/projects/P/work?task=${task}${v ? `&version=${v}` : ""}`, ...over,
});

describe("output queues on the Work page", () => {
  it("a version the viewer may decide is under Needs you, with the exact version link, and the task is marked handled", () => {
    const q = outputQueueItems(input([row({ current: version({ can_decide: true }) })]));
    expect(q.waiting).toEqual([]);
    expect(q.needsYou[0]).toMatchObject({
      kind: "output", label: "Task done · Output awaiting review", title: "Logo reveal", owner: "You", href: "/projects/P/work?task=t1&version=v1", expected: "Logo video", taskId: "t1",
    });
    expect(q.needsYou[0]!.next).toMatch(/accept it or send it back/);
    expect(q.handledTaskIds.has("t1")).toBe(true);
  });

  it("an Operations review the viewer cannot decide waits on the NAMED reviewer, and the assignee sees the same line", () => {
    const cur = version({ route: "operations", reviewer_id: "ops", reviewer_name: "Lena Ops" });
    const q = outputQueueItems(input([row({ current: cur })], { userId: "cara" }));
    expect(q.needsYou).toEqual([]);
    expect(q.waiting[0]).toMatchObject({ label: "Task done · Output awaiting Operations review", owner: "Lena Ops", href: "/projects/P/work?task=t1&version=v1" });
    // The reviewer sees it as theirs, linking to the same version.
    const rev = outputQueueItems(input([row({ current: { ...cur, can_decide: true } })], { userId: "ops", manager: false }));
    expect(rev.needsYou[0]).toMatchObject({ owner: "You", label: "Task done · Output awaiting Operations review", href: "/projects/P/work?task=t1&version=v1" });
  });

  it("a PM-submitted version with no Operations reviewer is the PM's to assign, and waiting for anyone else", () => {
    const cur = version({ route: "operations", needs_reviewer: true, can_assign: true });
    expect(outputQueueItems(input([row({ current: cur })])).needsYou[0]).toMatchObject({ label: "Task done · Output needs an Operations reviewer", owner: "You" });
    const other = outputQueueItems(input([row({ current: { ...cur, can_assign: false } })], { userId: "cara", manager: false }));
    expect(other.needsYou).toEqual([]);
    expect(other.waiting[0]!.owner).toMatch(/Operations, or Pia Manager/);
  });

  it("a team-route version waits on the team lead by name, or on the Project Manager when no lead is named", () => {
    expect(outputQueueItems(input([row({})], { userId: "cara", manager: false })).waiting[0]!.owner).toBe("Hana Lead");
    expect(outputQueueItems(input([row({ team_id: null })], { userId: "cara", manager: false })).waiting[0]!.owner).toMatch(/Pia Manager/);
  });

  it("changes requested: the assignee is told what to do, everyone else sees who owes the next version", () => {
    const cur = version({ status: "changes_requested", decision_note: "Logo too small" });
    const r = row({ state: "changes_requested", task_status: "in_progress", current: cur });
    const mine = outputQueueItems(input([r], { userId: "cara", manager: false }));
    expect(mine.needsYou[0]).toMatchObject({ kind: "output_changes", label: "Changes requested", owner: "You", detail: "Feedback: Logo too small" });
    expect(outputQueueItems(input([r])).waiting[0]).toMatchObject({ kind: "output_changes", owner: "Cara Assignee" });
  });

  it("a missing output is the assignee's to-do, and only shows to others once the task was handed in without it", () => {
    const miss = row({ state: "missing", current: null, task_status: "in_progress" });
    expect(outputQueueItems(input([miss], { userId: "cara", manager: false })).needsYou[0]).toMatchObject({ label: "Output missing", next: "Attach Logo video." });
    expect(outputQueueItems(input([miss])).waiting).toEqual([]);
    expect(outputQueueItems(input([{ ...miss, task_status: "ready_for_review" }])).waiting[0]).toMatchObject({ label: "Task done · Output missing", owner: "Cara Assignee" });
    // Not required, approved: nothing.
    expect(outputQueueItems(input([{ ...miss, output_required: false }], { userId: "cara" })).needsYou).toEqual([]);
    expect(outputQueueItems(input([row({ state: "approved", current: version({ status: "approved" }) })]))).toMatchObject({ needsYou: [], waiting: [] });
  });

  it("the generic review and in-review lines are dropped for a task whose output line covers it, so nothing is listed twice", () => {
    const outputs = outputQueueItems(input([row({ current: version({ can_decide: true }) })]));
    const task = { id: "t1", title: "Logo reveal", status: "ready_for_review", due_date: "2026-11-12", assignee_id: "cara", blocked_at: null, blocked_reason: null, unblock_owner_id: null, unblock_action: null };
    const base = { tasks: [task], reviewIds: ["t1"], lateMilestones: [], equipment: { status: "ok" as const, drafts: [], waiting: [], importFailed: null, requests: 0 }, userId: "pm", manager: true, pmName: "Pia Manager", today: "2026-11-11", nameOf: (u: string | null | undefined) => names[u ?? ""] ?? "Unknown", taskHref: (id: string) => `/t/${id}`, milestonesHref: "/ms", equipmentHref: () => "/eq" };
    const merged = workAttention({ ...base, outputs });
    expect(merged.needsYou.map((a) => a.kind)).toEqual(["output"]);
    // Without a register row the plain review line stays.
    expect(workAttention(base).needsYou.map((a) => a.kind)).toEqual(["review"]);
    // The assignee's own "In review" line is replaced by the output line too.
    const mine = workAttention({ ...base, userId: "cara", manager: false, reviewIds: [], outputs: outputQueueItems(input([row({})], { userId: "cara", manager: false })) });
    expect(mine.waiting.map((a) => a.kind)).toEqual(["output"]);
  });

  it("only a handed-in task gets the 'Task done' prefix", () => {
    expect(taskDonePrefix("ready_for_review")).toBe("Task done · ");
    expect(taskDonePrefix("completed")).toBe("Task done · ");
    expect(taskDonePrefix("in_progress")).toBe("");
    expect(outputQueueItems(input([row({ task_status: "in_progress" })], { userId: "cara" })).waiting[0]!.label).toBe("Output awaiting review");
  });
});
