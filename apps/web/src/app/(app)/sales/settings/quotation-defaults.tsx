"use client";

import { saveVatChoice } from "@/lib/actions/quotations";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";

export interface VatChoiceView { id: string; label: string; kind: "rate" | "out_of_scope"; rate: string | null; active: boolean }
/** The VAT choices Sales can pick from on an estimate. "0%" and "Out of scope" are separate explicit choices; nothing is chosen for the client. */
export function VatChoices({ companyId, choices, canEdit }: { companyId: string; choices: VatChoiceView[]; canEdit: boolean }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-sm">
        {choices.map((c) => <li key={c.id}>{c.label}{c.kind === "out_of_scope" ? " (no VAT shown)" : ""} {c.active ? null : <span className="text-muted-foreground">· hidden from the list</span>}</li>)}
      </ul>
      {canEdit ? (
        <ActionForm action={saveVatChoice} submitLabel="Add VAT choice" resetOnSuccess>
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="kind" value="rate" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor={`vat-label-${companyId}`}><Input id={`vat-label-${companyId}`} name="label" required maxLength={60} placeholder="e.g. 7%" /></Field>
            <Field label="Rate in percent" htmlFor={`vat-rate-${companyId}`}><Input id={`vat-rate-${companyId}`} name="rate" required inputMode="decimal" placeholder="7" /></Field>
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}
