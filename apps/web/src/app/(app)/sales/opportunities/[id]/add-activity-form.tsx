"use client";

import { useState } from "react";
import { addActivity } from "@/lib/actions/crm";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";

const KINDS = [["note", "Note"], ["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["client_response", "Client response"]] as const;
const NEXT_KINDS = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["proposal", "Proposal work"], ["other", "Other"]] as const;

export interface OpenFollowUp { id: string; title: string; /** The only open follow-up of an active enquiry: it cannot be completed without planning the next one. */ isOnlyOpen: boolean }

/**
 * Records what happened and, in the same dialog, plans the next step: what, when (the next working day is suggested) and what kind. If one of the
 * enquiry's open follow-ups is the one just done, tick it and the update becomes its outcome. Nothing is sent to anyone: this is a log, not a message.
 */
export function AddActivityForm({ opportunityId, onDone, completable = [], suggestedDate, minDate }: { opportunityId: string; onDone?: () => void; completable?: OpenFollowUp[]; suggestedDate: string; minDate: string }) {
  const [plan, setPlan] = useState(false);
  const [completeId, setCompleteId] = useState("");
  const forced = completable.find((f) => f.id === completeId)?.isOnlyOpen ?? false;
  const planning = plan || forced;
  return (
    <ActionForm action={addActivity} submitLabel={completeId ? "Complete and add to timeline" : "Add to timeline"} resetOnSuccess onDone={() => { setPlan(false); setCompleteId(""); onDone?.(); }} className="space-y-3">
      <input type="hidden" name="id" value={opportunityId} />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="What kind" htmlFor="act-kind">
          <Select id="act-kind" name="kind" defaultValue="note">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="What happened" htmlFor="act-body">
          <Textarea id="act-body" name="body" rows={2} required placeholder="e.g. Spoke to Hana; she will confirm the dates on Thursday." />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="internal" className="mt-1" />
        <span>Internal note <span className="text-muted-foreground">(about our own thinking, not something the client said or did)</span></span>
      </label>
      {completable.length > 0 ? (
        <Field label="This was one of the planned follow-ups" htmlFor="act-complete" hint="Choose it to complete it with this update as its outcome.">
          <Select id="act-complete" name="completeFollowUpId" value={completeId} onChange={(e) => setCompleteId(e.target.value)}>
            <option value="">No, just add an update</option>
            {completable.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
          </Select>
        </Field>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name={forced ? undefined : "planNext"} className="mt-1" checked={planning} disabled={forced} onChange={(e) => setPlan(e.target.checked)} />
        <span>Plan the next step{forced ? <span className="text-muted-foreground"> (required: this is the only follow-up)</span> : null}</span>
      </label>
      {forced ? <input type="hidden" name="planNext" value="on" /> : null}
      {planning ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <Field label="Next step" htmlFor="act-nt"><Input id="act-nt" name="nextTitle" required placeholder="e.g. Send revised proposal" /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date" htmlFor="act-nd" hint="The next working day, if you do not change it."><Input id="act-nd" name="nextDate" type="date" required min={minDate} defaultValue={suggestedDate} /></Field>
            <Field label="Time (Dubai)" htmlFor="act-ntm"><Input id="act-ntm" name="nextTime" type="time" defaultValue="10:00" /></Field>
            <Field label="Type" htmlFor="act-nk"><Select id="act-nk" name="nextKind" defaultValue="call">{NEXT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          </div>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">This only records it. Nothing is sent to the client or anyone else. A first call, email or meeting sets the first-response time.</p>
    </ActionForm>
  );
}
