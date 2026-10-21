"use client";

import { useState } from "react";
import { assignOwner } from "@/lib/actions/crm";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";

export interface AssignOwnerProps { opportunityId: string; currentOwnerId: string; currentOwnerName: string; people: { id: string; name: string }[] }

/** Controlled dialog: opened from a button or from a "More" menu. Only people holding `assign_owner` are offered it; the database checks it again. */
export function AssignOwnerDialog({ open, onClose, opportunityId, currentOwnerId, currentOwnerName, people }: AssignOwnerProps & { open: boolean; onClose: () => void }) {
  const choices = people.filter((p) => p.id !== currentOwnerId);
  return (
    <Modal open={open} onClose={onClose} title="Assign owner" description={`Currently owned by ${currentOwnerName}. Their open follow-ups move to the new owner.`}>
      {choices.length === 0 ? (
        <p className="text-sm text-muted-foreground">There is nobody else with Sales access for this company yet. Grant access first (Sales, Access).</p>
      ) : (
        <ActionForm action={assignOwner} submitLabel="Assign owner" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
          <input type="hidden" name="id" value={opportunityId} />
          <Field label="New owner" htmlFor="assign-owner">
            <Select id="assign-owner" name="newOwner" required defaultValue={choices[0]?.id}>{choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </Field>
          <Field label="Reason" htmlFor="assign-reason" hint="Kept in the history.">
            <Textarea id="assign-reason" name="reason" rows={2} required />
          </Field>
        </ActionForm>
      )}
    </Modal>
  );
}

/** Only people holding `assign_owner` (founders, or someone they delegated) see this; the database checks it again. */
export function AssignOwnerButton(p: AssignOwnerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Assign owner</Button>
      <AssignOwnerDialog open={open} onClose={() => setOpen(false)} {...p} />
    </>
  );
}
