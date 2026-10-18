"use client";

import { useRef, useState } from "react";
import { updateOpportunity } from "@/lib/actions/crm";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";

export interface EditableOpportunity {
  id: string;
  version: number;
  title: string;
  brief: string | null;
  currency: string;
  value: number | null;
  budgetNote: string | null;
  paymentTerms: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  installStart: string | null;
  location: string | null;
  scope: string | null;
  exclusions: string | null;
  waitingOn: "client" | "internal" | null;
  technologies: { name: string; qty: number }[];
  risks: string[];
}

interface TechRow { key: number; name: string; qty: string }

/** Technologies and quantities as a small list editor; the form posts them as one JSON field (what updateOpportunity reads). */
function TechnologiesEditor({ initial }: { initial: { name: string; qty: number }[] }) {
  const next = useRef(initial.length);
  const [rows, setRows] = useState<TechRow[]>(initial.map((t, i) => ({ key: i, name: t.name, qty: String(t.qty) })));
  const json = JSON.stringify(rows.filter((r) => r.name.trim() !== "").map((r) => ({ name: r.name.trim(), qty: Number(r.qty) })));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Technologies and quantities</legend>
      <input type="hidden" name="technologies" value={json} />
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">None listed yet.</p> : null}
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`tech-name-${r.key}`} className="sr-only">Technology {i + 1}</label>
            <Input id={`tech-name-${r.key}`} value={r.name} placeholder="e.g. LED wall 3 m" onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))} />
          </div>
          <div className="w-20">
            <label htmlFor={`tech-qty-${r.key}`} className="sr-only">Quantity of technology {i + 1}</label>
            <Input id={`tech-qty-${r.key}`} type="number" min={1} step={1} value={r.qty} onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))} />
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Remove technology ${i + 1}`}>Remove</Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => { const key = next.current++; setRows([...rows, { key, name: "", qty: "1" }]); }}>Add technology</Button>
    </fieldset>
  );
}

export interface EditDetailsProps { data: EditableOpportunity; mode: "full" | "value"; availabilityWillNeedRecheck: boolean }

/**
 * Edit form (controlled). While the opportunity is open every working field can change; once it is Won only the money fields can
 * (founders only, as the database insists); a lost opportunity cannot be edited at all.
 */
export function EditDetailsDialog({ open, onClose, data, mode, availabilityWillNeedRecheck }: EditDetailsProps & { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={mode === "value" ? "Edit value" : "Edit details"} description={mode === "value" ? "On a won opportunity only a founder can change the value." : "Leave a field empty to clear it. Everything you change is recorded in the history."}>
      <ActionForm action={updateOpportunity} submitLabel="Save changes" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
        <input type="hidden" name="id" value={data.id} />
        <input type="hidden" name="expectedVersion" value={data.version} />
        {mode === "full" ? (
          <>
            {availabilityWillNeedRecheck ? <Alert variant="warning">Equipment availability was checked for the current dates and quantities. Changing the installation or show dates, or the technologies, means the check must be repeated.</Alert> : null}
            <Field label="Title" htmlFor="ed-title"><Input id="ed-title" name="title" required defaultValue={data.title} maxLength={200} /></Field>
            <Field label="Brief" htmlFor="ed-brief"><Textarea id="ed-brief" name="brief" rows={3} defaultValue={data.brief ?? ""} /></Field>
          </>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Currency" htmlFor="ed-currency" hint="3 letters, e.g. AED"><Input id="ed-currency" name="currency" required minLength={3} maxLength={3} defaultValue={data.currency} className="uppercase" /></Field>
          <Field label="Value" htmlFor="ed-value" className="space-y-1.5 sm:col-span-2" hint="Visible to everyone with Sales access."><Input id="ed-value" name="value" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={data.value ?? ""} /></Field>
        </div>
        <Field label="Budget as the client stated it" htmlFor="ed-budget"><Input id="ed-budget" name="budget_note" defaultValue={data.budgetNote ?? ""} /></Field>
        {mode === "full" ? (
          <>
            <Field label="Payment terms" htmlFor="ed-payment"><Input id="ed-payment" name="payment_terms" defaultValue={data.paymentTerms ?? ""} placeholder="e.g. 50% on order, 50% 30 days after the event" /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Installation starts" htmlFor="ed-install"><Input id="ed-install" name="install_start" type="date" defaultValue={data.installStart ?? ""} /></Field>
              <Field label="Show starts" htmlFor="ed-start"><Input id="ed-start" name="event_start" type="date" defaultValue={data.eventStart ?? ""} /></Field>
              <Field label="Show ends" htmlFor="ed-end"><Input id="ed-end" name="event_end" type="date" defaultValue={data.eventEnd ?? ""} /></Field>
            </div>
            <Field label="Location" htmlFor="ed-location"><Input id="ed-location" name="location" defaultValue={data.location ?? ""} /></Field>
            <TechnologiesEditor initial={data.technologies} />
            <Field label="Scope" htmlFor="ed-scope" hint="What is being supplied."><Textarea id="ed-scope" name="scope" rows={3} defaultValue={data.scope ?? ""} /></Field>
            <Field label="Exclusions" htmlFor="ed-exclusions" hint="What is not included."><Textarea id="ed-exclusions" name="exclusions" rows={2} defaultValue={data.exclusions ?? ""} /></Field>
            <Field label="Risks" htmlFor="ed-risks" hint="One per line."><Textarea id="ed-risks" name="risks" rows={3} defaultValue={data.risks.join("\n")} /></Field>
            <Field label="Waiting on" htmlFor="ed-waiting">
              <Select id="ed-waiting" name="waiting_on" defaultValue={data.waitingOn ?? ""}>
                <option value="">Nobody</option>
                <option value="client">The client</option>
                <option value="internal">Our own team</option>
              </Select>
            </Field>
          </>
        ) : null}
      </ActionForm>
    </Modal>
  );
}

export function EditDetailsButton(p: EditDetailsProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>{p.mode === "value" ? "Edit value" : "Edit details"}</Button>
      <EditDetailsDialog open={open} onClose={() => setOpen(false)} {...p} />
    </>
  );
}
