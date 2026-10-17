"use client";

import { useState } from "react";
import { updateHandover } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";

type Status = "draft" | "ready" | "handed_over";

/** Choose the Project Manager and record where the package stands. This records a decision; it does not create a project. */
export function HandoverForm({ opportunityId, status, pmUserId, notes, people }: { opportunityId: string; status: Status; pmUserId: string | null; notes: string | null; people: { id: string; name: string }[] }) {
  const [current, setCurrent] = useState<Status>(status);
  const [pm, setPm] = useState(pmUserId ?? "");
  const needsPm = current === "handed_over" && pm === "";
  return (
    <ActionForm action={updateHandover} submitLabel="Save handover">
      <input type="hidden" name="id" value={opportunityId} />
      <Field label="Project Manager" htmlFor="ho-pm" hint="Anyone active in the company can be chosen; they do not need Sales access.">
        <Select id="ho-pm" name="pmUserId" value={pm} onChange={(e) => setPm(e.target.value)}>
          <option value="">Not chosen yet</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Status" htmlFor="ho-status">
        <Select id="ho-status" name="status" value={current} onChange={(e) => setCurrent(e.target.value as Status)}>
          <option value="draft">Draft (still being prepared)</option>
          <option value="ready">Ready for the Project Manager</option>
          <option value="handed_over">Handed over to the Project Manager</option>
        </Select>
      </Field>
      {needsPm ? <Alert variant="warning">Choose the Project Manager before marking it handed over.</Alert> : null}
      <Field label="Notes for the Project Manager" htmlFor="ho-notes">
        <Textarea id="ho-notes" name="notes" rows={4} defaultValue={notes ?? ""} placeholder="Anything the package above does not say: site access, client preferences, open questions." />
      </Field>
      <p className="text-xs text-muted-foreground">Projects is coming soon. Marking this handed over records that the package was given to the Project Manager; it does not create a project or notify anyone.</p>
    </ActionForm>
  );
}
