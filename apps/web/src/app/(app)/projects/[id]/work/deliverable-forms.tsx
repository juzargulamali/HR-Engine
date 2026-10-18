"use client";

import { useState } from "react";
import { saveDeliverable, setDeliverableStatus } from "@/lib/actions/projectsDelivery";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DialogButton } from "./dialog-button";
import type { PickOption, StatusOption } from "./helpers";

export interface DeliverableFormValues {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  team_id: string | null;
  milestone_id: string | null;
  version: number;
}

/**
 * Add or edit a deliverable. The PM sets title, department team and milestone; the head of the responsible team may only
 * refine the description and the date (`leaderOnly` false), as the database enforces.
 */
function DeliverableForm({ projectId, deliverable, teams, milestones, leaderOnly, onDone }: {
  projectId: string; deliverable?: DeliverableFormValues; teams: PickOption[]; milestones: PickOption[]; leaderOnly: boolean; onDone: () => void;
}) {
  const [due, setDue] = useState(deliverable?.due_date ?? "");
  const dateChanged = Boolean(deliverable) && due !== (deliverable?.due_date ?? "");
  return (
    <ActionForm action={saveDeliverable} submitLabel={deliverable ? "Save deliverable" : "Add deliverable"} onDone={onDone}>
      <input type="hidden" name="projectId" value={projectId} />
      {deliverable ? <input type="hidden" name="deliverableId" value={deliverable.id} /> : null}
      {deliverable ? <input type="hidden" name="expectedVersion" value={deliverable.version} /> : null}
      {leaderOnly ? (
        <>
          <Field label="Title" htmlFor="dl-title"><Input id="dl-title" name="title" required maxLength={200} defaultValue={deliverable?.title ?? ""} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department team" htmlFor="dl-team">
              <Select id="dl-team" name="teamId" defaultValue={deliverable?.team_id ?? ""}>
                <option value="">Not assigned to a department</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Milestone" htmlFor="dl-ms">
              <Select id="dl-ms" name="milestoneId" defaultValue={deliverable?.milestone_id ?? ""}>
                <option value="">Not linked to a milestone</option>
                {milestones.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          </div>
        </>
      ) : null}
      <Field label="Description (optional)" htmlFor="dl-desc"><Textarea id="dl-desc" name="description" rows={3} defaultValue={deliverable?.description ?? ""} /></Field>
      <Field label="Due date" htmlFor="dl-due"><Input id="dl-due" name="dueDate" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      {dateChanged ? (
        <Field label="Why is the date changing?" htmlFor="dl-reason" hint="Kept with the date history."><Input id="dl-reason" name="reason" required maxLength={300} /></Field>
      ) : null}
    </ActionForm>
  );
}

export function AddDeliverableButton({ projectId, teams, milestones }: { projectId: string; teams: PickOption[]; milestones: PickOption[] }) {
  return <DialogButton label="Add deliverable" title="New deliverable" description="A deliverable is a piece of work assigned to one department team, whose head then distributes the tasks." variant="default">{(close) => <DeliverableForm projectId={projectId} teams={teams} milestones={milestones} leaderOnly onDone={close} />}</DialogButton>;
}

export function EditDeliverableButton({ projectId, deliverable, teams, milestones, isManager }: { projectId: string; deliverable: DeliverableFormValues; teams: PickOption[]; milestones: PickOption[]; isManager: boolean }) {
  return <DialogButton label="Edit" title="Edit deliverable">{(close) => <DeliverableForm projectId={projectId} deliverable={deliverable} teams={teams} milestones={milestones} leaderOnly={isManager} onDone={close} />}</DialogButton>;
}

export function DeliverableStatusButton({ projectId, deliverableId, title, moves }: { projectId: string; deliverableId: string; title: string; moves: StatusOption[] }) {
  return (
    <DialogButton label="Change status" title={`Status of "${title}"`} description="Accepting needs every task of the deliverable to be done, cancelled or deferred. Cancelling, deferring or reopening needs a reason.">
      {(close) => <StatusForm projectId={projectId} deliverableId={deliverableId} moves={moves} onDone={close} />}
    </DialogButton>
  );
}

function StatusForm({ projectId, deliverableId, moves, onDone }: { projectId: string; deliverableId: string; moves: StatusOption[]; onDone: () => void }) {
  const [to, setTo] = useState(moves[0]?.to ?? "");
  const needsNote = moves.find((m) => m.to === to)?.needsNote ?? false;
  return (
    <ActionForm action={setDeliverableStatus} submitLabel="Change status" onDone={onDone}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="deliverableId" value={deliverableId} />
      <Field label="New status" htmlFor="dl-to">
        <Select id="dl-to" name="to" value={to} onChange={(e) => setTo(e.target.value)}>{moves.map((m) => <option key={m.to} value={m.to}>{m.label}</option>)}</Select>
      </Field>
      <Field label={needsNote ? "Reason (required)" : "Note (optional)"} htmlFor="dl-note"><Textarea id="dl-note" name="note" rows={3} required={needsNote} /></Field>
    </ActionForm>
  );
}
