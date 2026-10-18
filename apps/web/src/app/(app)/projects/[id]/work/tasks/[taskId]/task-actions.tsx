"use client";

import { useRef, useState } from "react";
import { blockProjectTask, commentOnTask, previewTaskDateChange, reassignProjectTask, setProjectTaskStatus, unblockProjectTask, updateProjectTask } from "@/lib/actions/projectsDelivery";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dateText } from "@/lib/projects/format";
import { DialogButton } from "../../dialog-button";
import type { PickOption } from "../../helpers";


/** One status move. Moves that need a reason (changes requested, reopen, defer, cancel) ask for it first. */
export function StatusMoveButton({ projectId, taskId, version, to, label, needsNote }: { projectId: string; taskId: string; version: number; to: string; label: string; needsNote: boolean }) {
  const hidden = (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="to" value={to} />
      <input type="hidden" name="expectedVersion" value={version} />
    </>
  );
  if (!needsNote) {
    return <ActionForm action={setProjectTaskStatus} submitLabel={label} className="space-y-2">{hidden}</ActionForm>;
  }
  return (
    <DialogButton label={label} title={label} description="Say why. It is kept in the task history.">
      {(close) => (
        <ActionForm action={setProjectTaskStatus} submitLabel={label} onDone={close}>
          {hidden}
          <Field label="Reason (required)" htmlFor={`mv-${to}`}><Textarea id={`mv-${to}`} name="note" rows={3} required /></Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

export function BlockButton({ projectId, taskId, members }: { projectId: string; taskId: string; members: PickOption[] }) {
  return (
    <DialogButton label="Block task" title="Block this task" description="A blocked task cannot be completed until the blocker is cleared. Say what is in the way and who or what will clear it.">
      {(close) => (
        <ActionForm action={blockProjectTask} submitLabel="Mark as blocked" onDone={close}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="taskId" value={taskId} />
          <Field label="What is blocking it" htmlFor="bl-reason"><Textarea id="bl-reason" name="reason" rows={3} required /></Field>
          <Field label="Who can unblock it" htmlFor="bl-owner" hint="Choose a person, describe an action below, or both.">
            <Select id="bl-owner" name="unblockOwner" defaultValue=""><option value="">Nobody in particular</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
          </Field>
          <Field label="Or what action will unblock it" htmlFor="bl-action"><Input id="bl-action" name="unblockAction" maxLength={300} placeholder="e.g. Standbuilder delivers the truss" /></Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

export function UnblockButton({ projectId, taskId }: { projectId: string; taskId: string }) {
  return (
    <DialogButton label="Clear blocker" title="Clear the blocker">
      {(close) => (
        <ActionForm action={unblockProjectTask} submitLabel="Clear blocker" onDone={close}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="taskId" value={taskId} />
          <Field label="Note (optional)" htmlFor="ub-note"><Textarea id="ub-note" name="note" rows={3} placeholder="What changed?" /></Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

export function ReassignButton({ projectId, taskId, currentAssignee, options }: { projectId: string; taskId: string; currentAssignee: string; options: PickOption[] }) {
  return (
    <DialogButton label="Reassign" title="Reassign this task" description="One person stays accountable. The change is kept in the history and the new assignee is told.">
      {(close) => (
        <ActionForm action={reassignProjectTask} submitLabel="Reassign" onDone={close}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="taskId" value={taskId} />
          <Field label="New assignee" htmlFor="ra-to">
            <Select id="ra-to" name="assigneeId" defaultValue={currentAssignee} required>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>
          </Field>
          <Field label="Note (optional)" htmlFor="ra-note"><Input id="ra-note" name="note" maxLength={300} /></Field>
        </ActionForm>
      )}
    </DialogButton>
  );
}

export interface EditableTask {
  id: string;
  version: number;
  title: string;
  description: string | null;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  requires_review: boolean;
  team_id: string | null;
  deliverable_id: string | null;
  milestone_id: string | null;
  dependsOn: string[];
  collaborators: string[];
}

interface Affected { title: string; assignee: string | null; start: string | null; due: string | null }

function EditForm({ projectId, task, leader, otherTasks, collaboratorOptions, teams, deliverables, milestones, onDone }: {
  projectId: string; task: EditableTask; leader: boolean; otherTasks: PickOption[]; collaboratorOptions: PickOption[];
  teams: PickOption[]; deliverables: PickOption[]; milestones: PickOption[]; onDone: (warning: string | null) => void;
}) {
  const [start, setStart] = useState(task.start_date ?? "");
  const [due, setDue] = useState(task.due_date ?? "");
  const [affected, setAffected] = useState<Affected[]>([]);
  const [checking, setChecking] = useState(false);
  const latest = useRef(0);
  const dateChanged = start !== (task.start_date ?? "") || due !== (task.due_date ?? "");
  const badRange = Boolean(start && due && due < start);

  async function onDueChange(value: string) {
    setDue(value);
    const ticket = ++latest.current;
    if (!value || value === (task.due_date ?? "")) { setAffected([]); return; }
    setChecking(true);
    // Read-only look at the work that depends on this task and would now start before it finishes. Nothing is changed.
    const result = await previewTaskDateChange(task.id, value).catch(() => []);
    if (ticket === latest.current) { setAffected(result); setChecking(false); }
  }

  return (
    <ActionForm action={updateProjectTask} submitLabel="Save task" onDone={(state) => onDone(state.warning ?? null)}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="expectedVersion" value={task.version} />
      <input type="hidden" name="dependsOnPresent" value="1" />
      <input type="hidden" name="collaboratorIdsPresent" value="1" />
      {leader ? <input type="hidden" name="requiresReviewPresent" value="1" /> : null}
      <Field label="Title" htmlFor="et-title"><Input id="et-title" name="title" required maxLength={200} defaultValue={task.title} /></Field>
      <Field label="Description" htmlFor="et-desc"><Textarea id="et-desc" name="description" rows={3} defaultValue={task.description ?? ""} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Priority" htmlFor="et-prio">
          <Select id="et-prio" name="priority" defaultValue={task.priority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select>
        </Field>
        <Field label="Start date" htmlFor="et-start"><Input id="et-start" name="startDate" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Due date" htmlFor="et-due" hint={badRange ? "The due date cannot be before the start date." : undefined}>
          <Input id="et-due" name="dueDate" type="date" value={due} min={start || undefined} onChange={(e) => void onDueChange(e.target.value)} aria-invalid={badRange} />
        </Field>
      </div>
      {dateChanged ? (
        <Field label="Why is the date changing?" htmlFor="et-reason" hint="Kept in the task history with the old and new date.">
          <Input id="et-reason" name="reason" required maxLength={300} />
        </Field>
      ) : null}
      {checking ? <p role="status" className="text-sm text-muted-foreground">Checking which tasks depend on this one…</p> : null}
      {affected.length > 0 ? (
        <Alert variant="warning" role="status">
          <p className="font-medium">{affected.length} dependent task{affected.length === 1 ? "" : "s"} would start before this one finishes:</p>
          <ul className="mt-1 list-disc pl-5">
            {affected.map((a, i) => <li key={i}>{a.title}{a.assignee ? ` (${a.assignee})` : ""}: {a.start ? `starts ${dateText(a.start)}` : a.due ? `due ${dateText(a.due)}` : "undated"}</li>)}
          </ul>
          <p className="mt-2">Nothing is moved for you. After saving, review those tasks with their owners.</p>
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" required className="h-4 w-4" /> I have seen this and will review them</label>
        </Alert>
      ) : null}
      {leader ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Department team" htmlFor="et-team"><Select id="et-team" name="teamId" defaultValue={task.team_id ?? ""}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
            <Field label="Deliverable" htmlFor="et-del"><Select id="et-del" name="deliverableId" defaultValue={task.deliverable_id ?? ""}><option value="">None</option>{deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="Milestone" htmlFor="et-ms"><Select id="et-ms" name="milestoneId" defaultValue={task.milestone_id ?? ""}><option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="requiresReview" defaultChecked={task.requires_review} className="mt-1 h-4 w-4" />
            <span><span className="font-medium">Needs review</span><span className="block text-muted-foreground">A department head or the Project Manager (not the assignee) accepts it as done.</span></span>
          </label>
        </>
      ) : null}
      <Field label="Depends on" htmlFor="et-deps" hint="Hold Ctrl or Cmd to pick several. A loop between tasks is refused.">
        <select id="et-deps" name="dependsOn" multiple size={Math.min(5, Math.max(2, otherTasks.length))} defaultValue={task.dependsOn} className="w-full rounded-md border border-input bg-field px-3 py-1 text-sm">
          {otherTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="Collaborators" htmlFor="et-collab" hint="Helpers; the assignee stays the one accountable person.">
        <select id="et-collab" name="collaboratorIds" multiple size={Math.min(5, Math.max(2, collaboratorOptions.length))} defaultValue={task.collaborators} className="w-full rounded-md border border-input bg-field px-3 py-1 text-sm">
          {collaboratorOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
    </ActionForm>
  );
}

/** Edit dialog. A saved date change that touches dependent work is reported beside the button after the dialog closes. */
export function EditTaskButton(props: Omit<Parameters<typeof EditForm>[0], "onDone">) {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <DialogButton label="Edit task" title="Edit task">{(close) => <EditForm {...props} onDone={(warning) => { setNotice(warning); close(); }} />}</DialogButton>
      {notice ? <Alert variant="warning" role="status" className="basis-full">{notice}</Alert> : null}
    </>
  );
}

export function CommentForm({ projectId, taskId }: { projectId: string; taskId: string }) {
  return (
    <ActionForm action={commentOnTask} submitLabel="Add comment" resetOnSuccess>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="taskId" value={taskId} />
      <Field label="Add a comment" htmlFor="tc-body" hint="Comments stay on this task. They never change its status or dates.">
        <Textarea id="tc-body" name="body" rows={3} required maxLength={4000} />
      </Field>
    </ActionForm>
  );
}
