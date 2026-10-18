"use client";

import { useState } from "react";
import { saveMilestone, setMilestoneStatus } from "@/lib/actions/projectsDelivery";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DialogButton } from "./dialog-button";
import type { StatusOption } from "./helpers";

export interface MilestoneFormValues {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  is_required: boolean;
  client_facing: boolean;
  version: number;
}

/** Add or edit a milestone. Changing the due date asks for a reason, because the history of date changes is kept. */
function MilestoneForm({ projectId, milestone, onDone }: { projectId: string; milestone?: MilestoneFormValues; onDone: () => void }) {
  const [due, setDue] = useState(milestone?.due_date ?? "");
  const dateChanged = Boolean(milestone) && due !== (milestone?.due_date ?? "");
  return (
    <ActionForm action={saveMilestone} submitLabel={milestone ? "Save milestone" : "Add milestone"} onDone={onDone}>
      <input type="hidden" name="projectId" value={projectId} />
      {milestone ? <input type="hidden" name="milestoneId" value={milestone.id} /> : null}
      {milestone ? <input type="hidden" name="expectedVersion" value={milestone.version} /> : null}
      <input type="hidden" name="isRequiredPresent" value="1" />
      <input type="hidden" name="clientFacingPresent" value="1" />
      <Field label="Title" htmlFor="ms-title"><Input id="ms-title" name="title" required maxLength={200} defaultValue={milestone?.title ?? ""} /></Field>
      <Field label="Description (optional)" htmlFor="ms-desc"><Textarea id="ms-desc" name="description" rows={3} defaultValue={milestone?.description ?? ""} /></Field>
      <Field label="Due date" htmlFor="ms-due"><Input id="ms-due" name="dueDate" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      {dateChanged ? (
        <Field label="Why is the date changing?" htmlFor="ms-reason" hint="Kept with the date history. Nothing else is rescheduled automatically.">
          <Input id="ms-reason" name="reason" required maxLength={300} />
        </Field>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="isRequired" defaultChecked={milestone?.is_required ?? true} className="mt-1 h-4 w-4" />
        <span><span className="font-medium">Required</span><span className="block text-muted-foreground">Only required milestones count toward the stated progress.</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="clientFacing" defaultChecked={milestone?.client_facing ?? false} className="mt-1 h-4 w-4" />
        <span><span className="font-medium">Can appear on a client timeline</span><span className="block text-muted-foreground">Nothing is shared with the client until you issue a timeline.</span></span>
      </label>
    </ActionForm>
  );
}

export function AddMilestoneButton({ projectId }: { projectId: string }) {
  return <DialogButton label="Add milestone" title="New milestone" variant="default">{(close) => <MilestoneForm projectId={projectId} onDone={close} />}</DialogButton>;
}

export function EditMilestoneButton({ projectId, milestone }: { projectId: string; milestone: MilestoneFormValues }) {
  return <DialogButton label="Edit" title="Edit milestone">{(close) => <MilestoneForm projectId={projectId} milestone={milestone} onDone={close} />}</DialogButton>;
}

/** Change a milestone's status. Accepting needs its deliverables closed: the database says so in words if they are not. */
export function MilestoneStatusButton({ projectId, milestoneId, title, moves }: { projectId: string; milestoneId: string; title: string; moves: StatusOption[] }) {
  return (
    <DialogButton label="Change status" title={`Status of "${title}"`} description="Cancelling, deferring or reopening needs a reason. Accepting needs every deliverable of the milestone to be accepted, cancelled or deferred.">
      {(close) => <StatusForm projectId={projectId} milestoneId={milestoneId} moves={moves} onDone={close} />}
    </DialogButton>
  );
}

function StatusForm({ projectId, milestoneId, moves, onDone }: { projectId: string; milestoneId: string; moves: StatusOption[]; onDone: () => void }) {
  const [to, setTo] = useState(moves[0]?.to ?? "");
  const needsNote = moves.find((m) => m.to === to)?.needsNote ?? false;
  return (
    <ActionForm action={setMilestoneStatus} submitLabel="Change status" onDone={onDone}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <Field label="New status" htmlFor="ms-to">
        <Select id="ms-to" name="to" value={to} onChange={(e) => setTo(e.target.value)}>{moves.map((m) => <option key={m.to} value={m.to}>{m.label}</option>)}</Select>
      </Field>
      <Field label={needsNote ? "Reason (required)" : "Note (optional)"} htmlFor="ms-note"><Textarea id="ms-note" name="note" rows={3} required={needsNote} /></Field>
    </ActionForm>
  );
}
