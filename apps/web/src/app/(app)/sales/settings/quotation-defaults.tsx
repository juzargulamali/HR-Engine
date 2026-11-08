"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { saveTermsTemplate, saveVatChoice } from "@/lib/actions/quotations";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface VatChoiceView { id: string; label: string; kind: "rate" | "out_of_scope"; rate: string | null; active: boolean }
export interface TermsView { label: string; clauses: { title: string; body: string }[] }

const swap = <T,>(arr: T[], i: number, j: number) => { const a = [...arr]; [a[i], a[j]] = [a[j]!, a[i]!]; return a; };

/** The company's standard terms for new estimates (copied into each estimate; an issued quotation never changes). */
export function TermsTemplateForm({ companyId, terms }: { companyId: string; terms: TermsView }) {
  const [clauses, setClauses] = useState(terms.clauses);
  const set = (i: number, patch: Partial<{ title: string; body: string }>) => setClauses((a) => a.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <ActionForm action={saveTermsTemplate} submitLabel="Save standard terms">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="clauses" value={JSON.stringify(clauses)} />
      <Field label="Heading shown above the terms" htmlFor={`tt-label-${companyId}`} hint="Keep “working draft, pending legal review” until legal has reviewed the wording.">
        <Input id={`tt-label-${companyId}`} name="label" defaultValue={terms.label} maxLength={120} />
      </Field>
      {clauses.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
          <div className="flex gap-2">
            <Input aria-label={`Clause ${i + 1} title`} value={c.title} onChange={(e) => set(i, { title: e.target.value })} />
            <Button type="button" variant="ghost" size="sm" disabled={i === 0} aria-label={`Move clause ${i + 1} up`} onClick={() => setClauses((a) => swap(a, i, i - 1))}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
            <Button type="button" variant="ghost" size="sm" disabled={i === clauses.length - 1} aria-label={`Move clause ${i + 1} down`} onClick={() => setClauses((a) => swap(a, i, i + 1))}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove clause ${i + 1}`} onClick={() => setClauses((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
          </div>
          <Textarea aria-label={`Clause ${i + 1} text`} rows={3} value={c.body} onChange={(e) => set(i, { body: e.target.value })} />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => setClauses((a) => [...a, { title: "", body: "" }])}><Plus className="h-4 w-4" aria-hidden /> Add clause</Button>
    </ActionForm>
  );
}

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
