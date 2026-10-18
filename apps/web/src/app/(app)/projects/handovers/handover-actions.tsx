"use client";

import { useState } from "react";
import { acceptHandover, assignHandoverPm, requestHandoverClarification } from "@/lib/actions/projectsCore";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";

export function AssignPmForm({ handoverId, people, current }: { handoverId: string; people: { id: string; name: string }[]; current: string | null }) {
  return (
    <ActionForm action={assignHandoverPm} submitLabel={current ? "Change Project Manager" : "Assign Project Manager"}>
      <input type="hidden" name="handoverId" value={handoverId} />
      <Field label="Project Manager" htmlFor={`pm-${handoverId}`} hint="Only people with Projects access in this company can be chosen. They then accept the handover or ask Sales to clarify.">
        <Select id={`pm-${handoverId}`} name="pmUserId" defaultValue={current ?? ""} required>
          <option value="" disabled>Choose a person…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
    </ActionForm>
  );
}

/** Accepting creates exactly one project and opens it; a repeated click opens the same project. */
export function AcceptHandoverForm({ handoverId }: { handoverId: string }) {
  return (
    <ActionForm action={acceptHandover} submitLabel="Accept and create the project" pendingLabel="Creating the project…">
      <input type="hidden" name="handoverId" value={handoverId} />
      <p className="text-sm text-muted-foreground">Accepting creates the project from this brief, with you as Project Manager. The brief is then kept as it was agreed: later changes in Sales do not overwrite it.</p>
    </ActionForm>
  );
}

export function ClarifyHandoverForm({ handoverId }: { handoverId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium underline underline-offset-2 hover:text-foreground">Ask Sales to clarify instead</button>;
  }
  return (
    <ActionForm action={requestHandoverClarification} submitLabel="Send to Sales" variant="outline" secondary={<button type="button" onClick={() => setOpen(false)} className="text-sm underline underline-offset-2">Cancel</button>}>
      <input type="hidden" name="handoverId" value={handoverId} />
      <Field label="What needs clarifying" htmlFor={`cl-${handoverId}`}>
        <Textarea id={`cl-${handoverId}`} name="note" rows={3} required placeholder="Which hall, which hours, who confirms site access…" />
      </Field>
    </ActionForm>
  );
}
