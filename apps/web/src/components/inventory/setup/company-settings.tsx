"use client";

import { useState } from "react";
import { setInventoryCompanyCode, setInventoryEnabled } from "@/lib/actions/inventorySetup";
import { normaliseCompanyCode } from "@/lib/inventory/setup";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ActionForm, Field } from "@/components/sales/action-form";

/** Reference code and the on/off switch. Founders change them; everyone else with Setup access reads them. */
export function CompanySettings({ companyId, companyName, referenceCode, isEnabled, isFounder }: { companyId: string; companyName: string; referenceCode: string | null; isEnabled: boolean; isFounder: boolean }) {
  const [code, setCode] = useState(referenceCode ?? "");
  const [confirmOff, setConfirmOff] = useState(false);
  const [codeSaved, setCodeSaved] = useState(false);
  const configured = referenceCode !== null;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Reference code</h3>
          {configured ? <Badge variant="outline">{referenceCode}</Badge> : <Badge variant="warning">Not set</Badge>}
        </div>
        {!configured ? <Alert variant="warning" role="status">No equipment can be registered for {companyName} until a founder sets the reference code. Nothing is guessed.</Alert> : null}
        {isFounder ? (
          <ActionForm action={setInventoryCompanyCode} submitLabel={configured ? "Change code" : "Set code"} className="max-w-md space-y-3" onDone={() => setCodeSaved(true)}>
            <input type="hidden" name="companyId" value={companyId} />
            <Field label="Equipment reference code" htmlFor={`inv-code-${companyId}`} hint={`2 to 5 capital letters, different for every company. Equipment IDs are made from it, for example ${code || "UAE"}-E-00042 for a unit and ${code || "UAE"}-S-00007 for an item in a bin. It cannot be changed once the first equipment code has been issued, because labels already carry it.`}>
              <Input id={`inv-code-${companyId}`} name="code" value={code} onChange={(e) => setCode(normaliseCompanyCode(e.target.value))} required minLength={2} maxLength={5} pattern="[A-Za-z]{2,5}" autoCapitalize="characters" autoComplete="off" className="uppercase" />
            </Field>
          </ActionForm>
        ) : <p className="text-sm text-muted-foreground">Only a founder can set or change it.</p>}
        {codeSaved ? <Alert variant="success" role="status" className="max-w-md">Reference code saved.</Alert> : null}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Inventory is</h3>
          {!configured ? <Badge variant="outline">Waiting for the reference code</Badge> : isEnabled ? <Badge variant="success">On</Badge> : <Badge variant="warning">Off</Badge>}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">Switching Inventory off is a safe pause. <strong>Every record is kept</strong>: units, stock, counts, movements, requests and history stay exactly as they are and can still be read. What stops is any new change (receiving, issuing, counting, setup) until a founder switches it on again.</p>
        {!isFounder ? <p className="text-sm text-muted-foreground">Only a founder can switch it on or off.</p> : !configured ? <p className="text-sm text-muted-foreground">Set the reference code first.</p> : isEnabled ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOff(true)}>Switch Inventory off</Button>
            <Modal open={confirmOff} onClose={() => setConfirmOff(false)} title="Switch Inventory off?" description={companyName}>
              <ActionForm action={setInventoryEnabled} submitLabel="Switch off" pendingLabel="Switching off…" variant="destructive" onDone={() => setConfirmOff(false)} secondary={<Button type="button" variant="ghost" onClick={() => setConfirmOff(false)}>Cancel</Button>}>
                <input type="hidden" name="companyId" value={companyId} />
                <input type="hidden" name="enabled" value="false" />
                <p className="text-sm">Nobody will be able to change anything in Inventory for {companyName} until you switch it back on. No record is deleted or changed.</p>
              </ActionForm>
            </Modal>
          </>
        ) : (
          <ActionForm action={setInventoryEnabled} submitLabel="Switch Inventory on" className="max-w-md space-y-3">
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="enabled" value="true" />
          </ActionForm>
        )}
      </div>
    </div>
  );
}
