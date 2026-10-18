"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { cancelFollowUp, completeFollowUp, createFollowUp, rescheduleFollowUp } from "@/lib/actions/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "./action-form";
import { Modal } from "./modal";
import { todayInDubai } from "./format";

const KINDS = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["proposal", "Proposal work"], ["other", "Other"]] as const;

function KindSelect({ id, defaultValue = "other" }: { id: string; defaultValue?: string }) {
  return (
    <Select id={id} name="nextKind" defaultValue={defaultValue}>
      {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </Select>
  );
}

export interface FollowUpRef {
  id: string;
  title: string;
  opportunityId: string;
  /** True when this is the only open follow-up on an active opportunity: completing it then needs a next step or a hold. */
  isOnlyOpen: boolean;
}

/**
 * Completing a follow-up: say what came of it (required). If it was the opportunity's last open follow-up, choose what
 * happens next — a new follow-up or putting it on hold with a reason and review date — so no active opportunity is ever
 * left without a next action. The database enforces the same rule.
 */
export function CompleteFollowUpButton({ followUp, size = "sm" }: { followUp: FollowUpRef; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<"follow_up" | "hold" | "none">(followUp.isOnlyOpen ? "follow_up" : "none");
  return (
    <>
      <Button type="button" size={size} variant="outline" onClick={() => setOpen(true)}>
        <CheckCircle2 className="h-4 w-4" aria-hidden /> Done
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Complete follow-up" description={followUp.title}>
        <ActionForm action={completeFollowUp} submitLabel="Complete" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="followUpId" value={followUp.id} />
          <input type="hidden" name="opportunityId" value={followUp.opportunityId} />
          <Field label="What came of it?" htmlFor={`outcome-${followUp.id}`}>
            <Textarea id={`outcome-${followUp.id}`} name="outcome" required rows={3} placeholder="e.g. Spoke to Hana; she will confirm dates on Thursday." />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{followUp.isOnlyOpen ? "What happens next? (required, this was the last follow-up)" : "What happens next?"}</legend>
            {!followUp.isOnlyOpen ? (
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="next" value="none" checked={next === "none"} onChange={() => setNext("none")} /> Nothing more now (another follow-up is already planned)</label>
            ) : null}
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="next" value="follow_up" checked={next === "follow_up"} onChange={() => setNext("follow_up")} /> Add the next follow-up</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="next" value="hold" checked={next === "hold"} onChange={() => setNext("hold")} /> Put the opportunity on hold</label>
          </fieldset>
          {next === "follow_up" ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <Field label="Next action" htmlFor={`nt-${followUp.id}`}><Input id={`nt-${followUp.id}`} name="nextTitle" required placeholder="e.g. Send revised proposal" /></Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Date" htmlFor={`nd-${followUp.id}`}><Input id={`nd-${followUp.id}`} name="nextDate" type="date" required min={todayInDubai()} /></Field>
                <Field label="Time (Dubai)" htmlFor={`ntm-${followUp.id}`}><Input id={`ntm-${followUp.id}`} name="nextTime" type="time" defaultValue="10:00" /></Field>
                <Field label="Type" htmlFor={`nk-${followUp.id}`}><KindSelect id={`nk-${followUp.id}`} /></Field>
              </div>
            </div>
          ) : null}
          {next === "hold" ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <Field label="Reason" htmlFor={`hr-${followUp.id}`}><Input id={`hr-${followUp.id}`} name="holdReason" required placeholder="e.g. Client postponed the event" /></Field>
              <Field label="Review date" htmlFor={`hd-${followUp.id}`} hint="You will be reminded to review it on this date."><Input id={`hd-${followUp.id}`} name="holdReview" type="date" required min={todayInDubai()} /></Field>
            </div>
          ) : null}
        </ActionForm>
      </Modal>
    </>
  );
}

export function RescheduleFollowUpButton({ followUp }: { followUp: Pick<FollowUpRef, "id" | "title" | "opportunityId"> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Reschedule</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Reschedule follow-up" description={followUp.title}>
        <ActionForm action={rescheduleFollowUp} submitLabel="Reschedule" onDone={() => setOpen(false)}>
          <input type="hidden" name="followUpId" value={followUp.id} />
          <input type="hidden" name="opportunityId" value={followUp.opportunityId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New date" htmlFor={`rd-${followUp.id}`}><Input id={`rd-${followUp.id}`} name="date" type="date" required min={todayInDubai()} /></Field>
            <Field label="Time (Dubai)" htmlFor={`rt-${followUp.id}`}><Input id={`rt-${followUp.id}`} name="time" type="time" defaultValue="10:00" /></Field>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}

export function CancelFollowUpButton({ followUp }: { followUp: Pick<FollowUpRef, "id" | "title" | "opportunityId"> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>Cancel</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cancel follow-up" description={followUp.title}>
        <ActionForm action={cancelFollowUp} submitLabel="Cancel follow-up" variant="destructive" onDone={() => setOpen(false)}>
          <input type="hidden" name="followUpId" value={followUp.id} />
          <input type="hidden" name="opportunityId" value={followUp.opportunityId} />
          <Field label="Why is it no longer needed?" htmlFor={`cr-${followUp.id}`}><Input id={`cr-${followUp.id}`} name="reason" required /></Field>
          <p className="text-sm text-muted-foreground">The only next action of an active opportunity cannot be cancelled. Complete it with a new next action instead.</p>
        </ActionForm>
      </Modal>
    </>
  );
}

export function NewFollowUpButton({ opportunityId, people, canAssign, currentUserId }: { opportunityId: string; people: { id: string; name: string }[]; canAssign: boolean; currentUserId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Add follow-up</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add follow-up">
        <ActionForm action={createFollowUp} submitLabel="Add follow-up" onDone={() => setOpen(false)}>
          <input type="hidden" name="id" value={opportunityId} />
          <Field label="What needs to happen?" htmlFor={`fu-title-${opportunityId}`}><Input id={`fu-title-${opportunityId}`} name="title" required /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date" htmlFor={`fu-date-${opportunityId}`}><Input id={`fu-date-${opportunityId}`} name="date" type="date" required min={todayInDubai()} /></Field>
            <Field label="Time (Dubai)" htmlFor={`fu-time-${opportunityId}`}><Input id={`fu-time-${opportunityId}`} name="time" type="time" defaultValue="10:00" /></Field>
            <Field label="Type" htmlFor={`fu-kind-${opportunityId}`}>
              <Select id={`fu-kind-${opportunityId}`} name="kind" defaultValue="other">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            </Field>
          </div>
          {canAssign ? (
            <Field label="Assigned to" htmlFor={`fu-who-${opportunityId}`}>
              <Select id={`fu-who-${opportunityId}`} name="assignedTo" defaultValue={currentUserId}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            </Field>
          ) : null}
        </ActionForm>
      </Modal>
    </>
  );
}
