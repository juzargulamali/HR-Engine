"use client";

import { useMemo, useState } from "react";
import { createProjectTask } from "@/lib/actions/projectsDelivery";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MoreDetails, QuickAdd } from "@/components/workspace/quick-add";
import type { NewTaskOptions, QuickAssignee } from "@/app/(app)/projects/[id]/work/helpers";
import type { PickOption } from "./task-logic";

/**
 * Add a task with three fields: what, who, when. Everything else (department, deliverable, milestone, priority, start date, review rule,
 * description, dependencies, collaborators) is under "Add more details". The people offered are exactly those the existing rules allow
 * (a member: themself; a department head: their team; the PM: anyone), and the database applies the same rules again.
 */
function QuickTaskForm({ projectId, options, choices, milestones, tasks, collaborators, defaultAssignee, onDone }: {
  projectId: string; options: NewTaskOptions; choices: QuickAssignee[]; milestones: PickOption[]; tasks: PickOption[]; collaborators: PickOption[]; defaultAssignee: string; onDone: () => void;
}) {
  const [teamOverride, setTeamOverride] = useState("");
  const [assignee, setAssignee] = useState(choices.some((c) => c.id === defaultAssignee) ? defaultAssignee : (choices[0]?.id ?? ""));
  const [start, setStart] = useState("");
  const [due, setDue] = useState("");
  // With a department chosen under "more details" the people offered are that team's; otherwise the short list.
  const people = useMemo<QuickAssignee[]>(() => (teamOverride ? (options.assigneesByTeam[teamOverride] ?? []).map((a) => ({ ...a, teamId: teamOverride })) : choices), [teamOverride, options.assigneesByTeam, choices]);
  const selected = people.find((p) => p.id === assignee) ?? people[0];
  const effectiveTeam = teamOverride || selected?.teamId || "";
  const deliverables = options.deliverablesByTeam[effectiveTeam] ?? [];
  const badRange = Boolean(start && due && due < start);
  return (
    <ActionForm action={createProjectTask} submitLabel="Add task" onDone={onDone}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="teamId" value={effectiveTeam} />
      <Field label="What needs doing" htmlFor="qt-title"><Input id="qt-title" name="title" required maxLength={200} autoFocus /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Assignee" htmlFor="qt-assignee" hint={people.length <= 1 ? "You can add tasks for yourself. Your department head or the Project Manager assigns work to others." : undefined}>
          <Select id="qt-assignee" name="assigneeId" value={selected?.id ?? ""} onChange={(e) => setAssignee(e.target.value)} required>
            {people.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Due" htmlFor="qt-due" hint={badRange ? "The due date cannot be before the start date." : undefined}>
          <Input id="qt-due" name="dueDate" type="date" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} aria-invalid={badRange} />
        </Field>
      </div>
      <MoreDetails>
        <Field label="Description (optional)" htmlFor="qt-desc"><Textarea id="qt-desc" name="description" rows={3} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {options.teams.length > 0 ? (
            <Field label="Department team" htmlFor="qt-team" hint="Leave as automatic unless the task belongs to a department.">
              <Select id="qt-team" value={teamOverride} onChange={(e) => setTeamOverride(e.target.value)}>
                <option value="">Automatic</option>
                {options.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          ) : null}
          <Field label="Deliverable" htmlFor="qt-del">
            <Select id="qt-del" name="deliverableId" defaultValue="" key={`d-${effectiveTeam}`}>
              <option value="">Not part of a deliverable</option>
              {deliverables.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <Field label="Milestone" htmlFor="qt-ms">
            <Select id="qt-ms" name="milestoneId" defaultValue="">
              <option value="">Not linked to a milestone</option>
              {milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Start date" htmlFor="qt-start"><Input id="qt-start" name="startDate" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Priority" htmlFor="qt-prio">
            <Select id="qt-prio" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select>
          </Field>
        </div>
        {options.canRequireReview ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="requiresReview" className="mt-1 h-4 w-4" />
            <span><span className="font-medium">Needs review</span><span className="block text-muted-foreground">The assignee sends it for review; a department head or the Project Manager accepts it. Without this, the owner completes it.</span></span>
          </label>
        ) : null}
        {tasks.length > 0 ? (
          <Field label="Depends on (optional)" htmlFor="qt-deps" hint="Hold Ctrl or Cmd to pick several. A dependency never moves anyone's dates.">
            <select id="qt-deps" name="dependsOn" multiple size={Math.min(5, tasks.length)} className="w-full rounded-md border border-input bg-field px-3 py-1 text-sm">
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        ) : null}
        {collaborators.length > 0 ? (
          <Field label="Collaborators (optional)" htmlFor="qt-collab" hint="One person is accountable (the assignee). Collaborators help.">
            <select id="qt-collab" name="collaboratorIds" multiple size={Math.min(5, collaborators.length)} className="w-full rounded-md border border-input bg-field px-3 py-1 text-sm">
              {collaborators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        ) : null}
      </MoreDetails>
    </ActionForm>
  );
}

export function QuickAddTask(props: { projectId: string; options: NewTaskOptions; choices: QuickAssignee[]; milestones: PickOption[]; tasks: PickOption[]; collaborators: PickOption[]; defaultAssignee: string }) {
  return (
    <QuickAdd label="Add task" title="Add task" description="Three fields are enough. Add more details only if you need them.">
      {({ close }) => <QuickTaskForm {...props} onDone={close} />}
    </QuickAdd>
  );
}
