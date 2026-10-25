"use client";

import { useState } from "react";
import { correctMovement } from "@/lib/actions/inventoryStock";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { newMovementKey } from "@/lib/inventory/idempotency";

export interface CorrectableLine { id: string; label: string; recorded: string; effective: string | null }

/**
 * "Correct this entry": a correction is a NEW entry that names the original and says why. The original is never changed. Type the right
 * total for each line you want to correct; lines you leave blank are not touched. Only for people who may confirm stock.
 */
export function CorrectEntry({ companyId, movementId, code, lines }: { companyId: string; movementId: string; code: string; lines: CorrectableLine[] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(() => newMovementKey("fix"));
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Correct this entry</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Correct ${code}`} description="This adds a correction that names this entry and says why. This entry stays as it was." size="wide">
        <ActionForm action={correctMovement} submitLabel="Record the correction" pendingLabel="Recording…" onDone={() => setKey(newMovementKey("fix"))} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>}>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="movementId" value={movementId} />
          <input type="hidden" name="key" value={key} />
          <Field label="Why is it being corrected?" htmlFor="ce-why"><Textarea id="ce-why" name="reason" rows={2} required placeholder="For example: counted again, 18 arrived, not 20" /></Field>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">The right quantity for each line</legend>
            {lines.map((l) => (
              <Field key={l.id} label={l.label} htmlFor={`ce-${l.id}`} hint={`Recorded as ${l.recorded}${l.effective && l.effective !== l.recorded ? `; after earlier corrections it stands at ${l.effective}` : ""}. Leave blank to leave it as it is.`}>
                <Input id={`ce-${l.id}`} name={`qty_${l.id}`} inputMode="decimal" autoComplete="off" />
              </Field>
            ))}
          </fieldset>
        </ActionForm>
      </Modal>
    </>
  );
}
