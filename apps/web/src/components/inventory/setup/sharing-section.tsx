"use client";

import { useState } from "react";
import { setInventoryCompanySharing } from "@/lib/actions/inventorySetup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";
import { formatDate } from "@/components/sales/format";
import { Modal } from "@/components/ui/modal";

export interface SharingRow { id: string; otherCompanyId: string; otherCompanyName: string; note: string | null; since: string }

/**
 * Equipment sharing between companies. It lived on the Inventory Access screen; it is a company-level setting, not access for a person, so it moved with
 * the access screens into People & Access (Company settings) for exactly the same viewers: Inventory access managers read it, founders change it.
 */
export function SharingSection({ companyId, companyName, canEdit, allows, uses, others }: {
  companyId: string; companyName: string; canEdit: boolean; allows: readonly SharingRow[]; uses: readonly SharingRow[]; others: readonly { id: string; name: string }[];
}) {
  const [revoking, setRevoking] = useState<SharingRow | null>(null);
  const available = others.filter((o) => !allows.some((a) => a.otherCompanyId === o.id));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Equipment belongs to the company that owns it, wherever it is kept. Using it at another company&apos;s location, on another company&apos;s project or with another company&apos;s employee needs a founder of the owning company to allow it here. Moving equipment never changes who owns it.</p>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Companies allowed to use {companyName}&apos;s equipment</h3>
        {allows.length === 0 ? <p className="text-sm text-muted-foreground">None. {companyName}&apos;s equipment can only be used by {companyName}.</p> : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {allows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0"><p className="break-words font-medium">{r.otherCompanyName}</p><p className="text-sm text-muted-foreground">Since {formatDate(r.since)}{r.note ? ` · ${r.note}` : ""}</p></div>
                {canEdit ? <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoking(r)}>Stop allowing<span className="sr-only">{` ${r.otherCompanyName}`}</span></Button> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {uses.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Equipment {companyName} is allowed to use</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {uses.map((r) => <li key={r.id} className="px-4 py-3"><p className="break-words font-medium">{r.otherCompanyName}</p><p className="text-sm text-muted-foreground">Allowed since {formatDate(r.since)}{r.note ? ` · ${r.note}` : ""}. The owner can withdraw this.</p></li>)}
          </ul>
        </div>
      ) : null}
      {canEdit ? (
        available.length === 0 ? <p className="text-sm text-muted-foreground">Every other company is already allowed, or there is no other company.</p> : (
          <ActionForm action={setInventoryCompanySharing} submitLabel="Allow this company" resetOnSuccess>
            <input type="hidden" name="ownerCompanyId" value={companyId} />
            <input type="hidden" name="enabled" value="true" />
            <Field label={`Allow this company to use ${companyName}'s equipment`} htmlFor="inv-share-use">
              <Select id="inv-share-use" name="useCompanyId" required defaultValue=""><option value="" disabled>Choose a company…</option>{available.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>
            </Field>
            <Field label="Note (optional)" htmlFor="inv-share-note" hint="For example the project or reason."><Input id="inv-share-note" name="note" maxLength={200} /></Field>
          </ActionForm>
        )
      ) : <p className="text-sm text-muted-foreground">Only a founder of {companyName} can allow or stop this.</p>}
      <Modal open={revoking !== null} onClose={() => setRevoking(null)} title="Stop allowing this company" description={revoking?.otherCompanyName}>
        {revoking ? (
          <ActionForm action={setInventoryCompanySharing} submitLabel="Stop allowing" pendingLabel="Saving…" variant="destructive" onDone={() => setRevoking(null)} secondary={<Button type="button" variant="ghost" onClick={() => setRevoking(null)}>Cancel</Button>}>
            <input type="hidden" name="ownerCompanyId" value={companyId} />
            <input type="hidden" name="useCompanyId" value={revoking.otherCompanyId} />
            <input type="hidden" name="enabled" value="false" />
            <p className="text-sm">{revoking.otherCompanyName} will no longer be able to use {companyName}&apos;s equipment for new movements. Equipment already there is not moved by this, and history is kept.</p>
          </ActionForm>
        ) : null}
      </Modal>
    </div>
  );
}
