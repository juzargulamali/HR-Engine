"use client";

import { useState } from "react";
import { acceptHandover, assignHandoverPm, requestHandoverClarification } from "@/lib/actions/projectsCore";
import { Button } from "@/components/ui/button";
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

/**
 * The assigned Project Manager's two choices, side by side at the top of the brief: Accept handover (creates exactly one project and opens its Work page; a repeated click opens
 * the same project) or Ask Sales a question (sends the brief back to Sales with the question). The actions and the database decide whether this person may.
 */
export function HandoverDecision({ handoverId }: { handoverId: string }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="rounded-md border border-primary/50 bg-primary/5 p-3" data-testid="handover-decision">
      <p className="text-sm font-medium">Your decision as Project Manager</p>
      <p className="mt-0.5 text-sm text-muted-foreground">Accepting creates the project from this brief, with you as Project Manager, and opens its Project Plan. There you press Bring in accepted technologies (a manual step: nothing is added to the plan automatically) and break the scope into work. The brief is then kept as it was agreed: later changes in Sales do not overwrite it.</p>
      {asking ? (
        <div className="mt-3">
          <ActionForm action={requestHandoverClarification} submitLabel="Send question to Sales" variant="outline" secondary={<button type="button" onClick={() => setAsking(false)} className="text-sm underline underline-offset-2">Cancel</button>}>
            <input type="hidden" name="handoverId" value={handoverId} />
            <Field label="What do you need Sales to confirm?" htmlFor={`cl-${handoverId}`} hint="The handover goes back to Sales with your question. You are told when they resubmit.">
              <Textarea id={`cl-${handoverId}`} name="note" rows={3} required autoFocus placeholder="Which hall, which hours, who confirms site access…" />
            </Field>
          </ActionForm>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <ActionForm action={acceptHandover} submitLabel="Accept handover" pendingLabel="Creating the project…">
            <input type="hidden" name="handoverId" value={handoverId} />
          </ActionForm>
          <Button type="button" variant="outline" onClick={() => setAsking(true)} className="min-h-10">Ask Sales a question</Button>
        </div>
      )}
    </div>
  );
}
