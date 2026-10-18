"use client";

import { useMemo, useState } from "react";
import { createProjectTask } from "@/lib/actions/projectsDelivery";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DialogButton } from "./dialog-button";
import type { NewTaskOptions, PickOption } from "./helpers";

/**
 * New task. The pickers only offer what this person may do (a member: themself; a department head: their team; the PM: anyone), which is the
 * same rule the database applies, so a refusal is rare and always explained in words. The due date cannot be before the start date.
 */
function NewTaskForm({ projectId, options, milestones, tasks, collaborators, defaultAssignee, onDone }: {
  projectId: string; options: NewTaskOptions; milestones: PickOption[]; tasks: PickOption[]; collaborators: PickOption[]; defaultAssignee: string; onDone: () => void;
}) {
  const [team, setTeam] = useState("");
  const [start, setStart] = useState("");
  const [due, setDue] = useState("");
  const assignees = useMemo(() => options.assigneesByTeam[team] ?? [], [options.assigneesByTeam, team]);
  const deliverables = options.deliverablesByTeam[team] ?? [];
  const badRange = Boolean(start && due && due < start);
  const assigneeKey = useMemo(() => assignees.map((a) => a.id).join(","), [assignees]);
  return (
    <ActionForm action={createProjectTask} submitLabel="Create task" onDone={onDone}>
      <input type="hidden" name="projectId" value={projectId} />
      <Field label="Title" htmlFor="nt-title"><Input id="nt-title" name="title" required maxLength={200} /></Field>
      <Field label="Description (optional)" htmlFor="nt-desc"><Textarea id="nt-desc" name="description" rows={3} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department team" htmlFor="nt-team">
          <Select id="nt-team" name="teamId" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">No team</option>
            {options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <Field label="Assigned to" htmlFor="nt-assignee" hint={assignees.length <= 1 ? "You can create tasks for yourself. Your department head or the Project Manager assigns work to others." : undefined}>
          <Select id="nt-assignee" name="assigneeId" key={assigneeKey} defaultValue={assignees.some((a) => a.id === defaultAssignee) ? defaultAssignee : (assignees[0]?.id ?? "")} required>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Deliverable" htmlFor="nt-del">
          <Select id="nt-del" name="deliverableId" defaultValue="" key={`d-${team}`}>
            <option value="">Not part of a deliverable</option>
            {deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Milestone" htmlFor="nt-ms">
          <Select id="nt-ms" name="milestoneId" defaultValue="">
            <option value="">Not linked to a milestone</option>
            {milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Start date" htmlFor="nt-start"><Input id="nt-start" name="startDate" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Due date" htmlFor="nt-due" hint={badRange ? "The due date cannot be before the start date." : undefined}>
          <Input id="nt-due" name="dueDate" type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} aria-invalid={badRange} />
        </Field>
        <Field label="Priority" htmlFor="nt-prio">
          <Select id="nt-prio" name="priority" defaultValue="normal">
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
          </Select>
        </Field>
      </div>
      {options.canRequireReview ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="requiresReview" className="mt-1 h-4 w-4" />
          <span><span className="font-medium">Needs review</span><span className="block text-muted-foreground">The assignee sends it for review; a department head or the Project Manager accepts it. Without this, the owner completes it.</span></span>
        </label>
      ) : null}
      {tasks.length > 0 ? (
        <Field label="Depends on (optional)" htmlFor="nt-deps" hint="Hold Ctrl or Cmd to pick several. A dependency never moves anyone's dates.">
          <select id="nt-deps" name="dependsOn" multiple size={Math.min(5, tasks.length)} className="w-full rounded-md border border-input bg-field px-3 py-1 text-sm">
            {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      ) : null}
      {collaborators.length > 0 ? (
        <Field label="Collaborators (optional)" htmlFor="nt-collab" hint="One person is accountable (the assignee). Collaborators help.">
          <select id="nt-collab" name="collaboratorIds" multiple size={Math.min(5, collaborators.length)} className="w-full rounded-md border border-input bg-field px-3 py-1 text-sm">
            {collaborators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      ) : null}
    </ActionForm>
  );
}

export function NewTaskButton(props: { projectId: string; options: NewTaskOptions; milestones: PickOption[]; tasks: PickOption[]; collaborators: PickOption[]; defaultAssignee: string }) {
  return <DialogButton label="New task" title="New task" variant="default">{(close) => <NewTaskForm {...props} onDone={close} />}</DialogButton>;
}
