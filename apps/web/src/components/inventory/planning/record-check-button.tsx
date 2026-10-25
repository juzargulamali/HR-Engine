"use client";

import { useState } from "react";
import { recordOpportunityCheck } from "@/lib/actions/inventoryPlanning";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Field, InvForm } from "./inv-form";

/**
 * "Record the check" for one waiting Sales request, from the warehouse's own list. It works out the result from stock for the
 * enquiry's dates and saves it with the person's name and the time, exactly as on the enquiry itself. Nothing is reserved.
 */
export function RecordCheckButton({ opportunityId, reference, locations, defaultLocationId }: {
  opportunityId: string; reference: string; locations: { id: string; name: string }[]; defaultLocationId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const id = `rcw-${opportunityId}`;
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>Record the check<span className="sr-only">{` for ${reference}`}</span></Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title={`Record the check for ${reference}`} description="Works out the result from stock for this enquiry's dates and saves it with your name and the time. Nothing is reserved.">
          <InvForm action={recordOpportunityCheck} submitLabel="Record the check" pendingLabel="Checking…" onDone={() => setOpen(false)}>
            <input type="hidden" name="opportunityId" value={opportunityId} />
            {locations.length === 0 ? (
              <Alert role="status">There is no active location to check against.</Alert>
            ) : (
              <Field label="Location to check against" htmlFor={`${id}-loc`}>
                <Select id={`${id}-loc`} name="locationId" defaultValue={defaultLocationId ?? locations[0]?.id ?? ""} required>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Note (optional)" htmlFor={`${id}-note`}><Input id={`${id}-note`} name="note" maxLength={300} /></Field>
          </InvForm>
        </Modal>
      ) : null}
    </>
  );
}
