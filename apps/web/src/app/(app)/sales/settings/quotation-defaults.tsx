"use client";

import { useState } from "react";
import { saveVatChoice } from "@/lib/actions/quotations";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";

export interface VatChoiceView { id: string; label: string; kind: "rate" | "out_of_scope"; rate: string | null; active: boolean }
/**
 * The VAT choices Sales can pick from on an estimate. "0%" and "Out of scope" are separate explicit choices; nothing is chosen for the client. Adding a choice is
 * its own save (it does not save the settings above it), and the confirmation says so, with the company.
 */
export function VatChoices({ companyId, companyName, choices, canEdit }: { companyId: string; companyName?: string; choices: VatChoiceView[]; canEdit: boolean }) {
  const [added, setAdded] = useState<string | null>(null);
  const forCompany = companyName ? ` for ${companyName}` : "";
  return (
    <div className="space-y-3">
      {choices.length === 0 ? <p className="text-sm text-[hsl(var(--os-amber))]">No VAT choice yet{forCompany}. An estimate cannot be issued until there is one to choose.</p> : (
        <ul className="space-y-1 text-sm">
          {choices.map((c) => <li key={c.id} className="break-words">{c.label}{c.kind === "out_of_scope" ? " (no VAT shown)" : ""} {c.active ? null : <span className="text-muted-foreground">· hidden from the list</span>}</li>)}
        </ul>
      )}
      {canEdit ? (
        <div onInput={() => setAdded(null)}>
          <ActionForm action={saveVatChoice} submitLabel={`Add VAT choice${forCompany}`} resetOnSuccess
            onDone={() => setAdded(`VAT choice added${forCompany}. Only the VAT choices were saved: the settings above are saved with their own buttons.`)}>
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="kind" value="rate" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor={`vat-label-${companyId}`} help="What Sales sees in the list on an estimate, for example 5% or 7%."><Input id={`vat-label-${companyId}`} name="label" required maxLength={60} placeholder="e.g. 7%" /></Field>
              <Field label="Rate in percent" htmlFor={`vat-rate-${companyId}`} help="A number from 0 to 100, with up to two decimals, for example 5 or 7.5."><Input id={`vat-rate-${companyId}`} name="rate" required inputMode="decimal" placeholder="7" /></Field>
            </div>
            {added ? <p role="status" className="text-sm font-medium text-[hsl(var(--os-green))]" data-testid="vat-saved">{added}</p> : null}
          </ActionForm>
        </div>
      ) : null}
    </div>
  );
}
