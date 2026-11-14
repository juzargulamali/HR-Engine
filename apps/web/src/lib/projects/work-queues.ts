/**
 * The output side of a project's "Needs you" and "Waiting on someone else" lists. Pure: every line is built from a row the deliverables register returned for THIS reader
 * (`can_decide`, `can_assign`, the named reviewer, the version's own id), so the page never decides who may review: it only puts a version in the right queue and links to it.
 * A line names who owns the next step (the Operations reviewer by name, the team lead, the Project Manager, the assignee) and opens the task with the exact version
 * (`?task=<task>&version=<version>`), which is the link the notification, My Day and Operations entries already use.
 */
import type { RegisterRow } from "./phase2/model";
import type { AttentionItem } from "./work-attention";

/** A task the assignee has handed in (sent for review, or completed): the output is the part that is still open. */
export const taskIsDone = (status: string): boolean => status === "ready_for_review" || status === "completed";
/** "Task done · " in front of an output's state when both are true, so the two counters never read as one thing. */
export const taskDonePrefix = (status: string): string => (taskIsDone(status) ? "Task done · " : "");

export interface OutputQueueInput {
  rows: readonly RegisterRow[];
  userId: string;
  /** Project Manager, temporary leader or founder of this project. */
  manager: boolean;
  pmName: string;
  nameOf: (userId: string | null | undefined) => string;
  /** The named head of a project team, or null (none named). */
  teamLeadName: (teamId: string | null) => string | null;
  /** The link that opens the task with this version in view. */
  hrefFor: (taskId: string, versionId: string | null) => string;
}

export interface OutputQueues { needsYou: AttentionItem[]; waiting: AttentionItem[]; handledTaskIds: ReadonlySet<string> }

const item = (r: RegisterRow, i: OutputQueueInput, p: Pick<AttentionItem, "kind" | "label" | "owner" | "tone" | "next" | "detail"> & { versionId: string | null }): AttentionItem => ({
  key: `o-${r.task_id}`, kind: p.kind, label: `${taskDonePrefix(r.task_status)}${p.label}`, title: r.task_title, href: i.hrefFor(r.task_id, p.versionId), owner: p.owner, due: r.task_due,
  detail: p.detail, tone: p.tone, taskId: r.task_id, expected: r.output_label, next: p.next,
});

export function outputQueueItems(i: OutputQueueInput): OutputQueues {
  const needsYou: AttentionItem[] = [];
  const waiting: AttentionItem[] = [];
  const handled = new Set<string>();
  for (const r of i.rows) {
    const cur = r.current;
    const mineToDo = r.assignee_id === i.userId;
    const assignee = r.assignee_name ?? i.nameOf(r.assignee_id);
    if (r.state === "awaiting_review" && cur && cur.status === "awaiting") {
      handled.add(r.task_id);
      const ops = cur.route === "operations";
      const word = ops ? "Output awaiting Operations review" : "Output awaiting review";
      const version = `Version ${cur.version_no}`;
      if (cur.can_decide) {
        needsYou.push(item(r, i, { kind: "output", label: word, owner: "You", tone: "blue", versionId: cur.id, next: `Open ${version}, then accept it or send it back.`, detail: `Submitted by ${cur.submitted_by_name ?? assignee}.` }));
      } else if (ops && cur.needs_reviewer) {
        // Nobody reviews it yet: the person who may name a reviewer owes the next step; anyone else waits on them.
        if (cur.can_assign) needsYou.push(item(r, i, { kind: "output", label: "Output needs an Operations reviewer", owner: "You", tone: "amber", versionId: cur.id, next: `Open ${version} and name an Operations reviewer.`, detail: `Submitted by ${cur.submitted_by_name ?? assignee}.` }));
        else waiting.push(item(r, i, { kind: "output", label: "Output needs an Operations reviewer", owner: `Operations, or ${i.pmName} (Project Manager)`, tone: "amber", versionId: cur.id, next: "An Operations Manager or the Project Manager names the reviewer.", detail: `Submitted by ${cur.submitted_by_name ?? assignee}.` }));
      } else {
        const owner = ops ? (cur.reviewer_name ?? "Operations") : (r.team_id ? i.teamLeadName(r.team_id) : null) ?? `the team lead or ${i.pmName} (Project Manager)`;
        waiting.push(item(r, i, { kind: "output", label: word, owner, tone: "quiet", versionId: cur.id, next: `${version} is waiting for ${owner}.`, detail: `Submitted by ${cur.submitted_by_name ?? assignee}.` }));
      }
    } else if (r.state === "changes_requested" && cur) {
      handled.add(r.task_id);
      const note = cur.decision_note ? `Feedback: ${cur.decision_note}` : null;
      if (mineToDo) needsYou.push(item(r, i, { kind: "output_changes", label: "Changes requested", owner: "You", tone: "amber", versionId: cur.id, next: `Upload a new version of ${r.output_label}.`, detail: note }));
      else waiting.push(item(r, i, { kind: "output_changes", label: "Changes requested", owner: assignee, tone: "amber", versionId: cur.id, next: `${assignee} uploads a new version.`, detail: note }));
    } else if ((r.state === "missing" || r.state === "partial") && r.output_required && r.task_status !== "completed" && r.task_status !== "archived") {
      // Only the assignee's own gap, or a task already handed in without its output (the inconsistency worth seeing), so a long list of not-yet-started outputs never fills the queues.
      if (mineToDo) {
        handled.add(r.task_id);
        needsYou.push(item(r, i, { kind: "output", label: r.state === "missing" ? "Output missing" : "Output incomplete", owner: "You", tone: "amber", versionId: cur?.id ?? null, next: `Attach ${r.output_label}.`, detail: null }));
      } else if (taskIsDone(r.task_status)) {
        handled.add(r.task_id);
        waiting.push(item(r, i, { kind: "output", label: r.state === "missing" ? "Output missing" : "Output incomplete", owner: assignee, tone: "amber", versionId: cur?.id ?? null, next: `${assignee} attaches ${r.output_label}.`, detail: null }));
      }
    }
  }
  return { needsYou, waiting, handledTaskIds: handled };
}

/** The register's counters in words: versions waiting for approval are OUTPUTS (not tasks); tasks sent for review are counted separately on the Work page. */
export const OUTPUTS_AWAITING_APPROVAL = "Outputs awaiting approval";
export const TASKS_IN_REVIEW = "Tasks in review";
