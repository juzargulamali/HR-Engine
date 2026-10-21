"use client";

import { addActivity } from "@/lib/actions/crm";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";

const KINDS = [["note", "Note"], ["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["client_response", "Client response"]] as const;

/** Records what happened. Nothing is sent to anyone: this is a log, not a message. */
export function AddActivityForm({ opportunityId, onDone }: { opportunityId: string; onDone?: () => void }) {
  return (
    <ActionForm action={addActivity} submitLabel="Add to timeline" resetOnSuccess onDone={onDone ? () => onDone() : undefined} className="space-y-3">
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
      <p className="text-sm text-muted-foreground">This only records it. Nothing is sent to the client or anyone else. A first call, email or meeting sets the first-response time.</p>
    </ActionForm>
  );
}
