"use client";

import { useEffect, useRef, useState } from "react";
import { loadInquiryOrganisations, updateOpportunity } from "@/lib/actions/crm";
import type { EditionOption } from "@/lib/crm/events/data";
import { FIELD_NOUN, offeredFor, type InquiryField } from "@/lib/crm/organisation-roles";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { SearchCombobox, type ComboOption } from "@/components/sales/combobox";
import { Plus } from "lucide-react";
import { EventEditionDialog, type CreatedEdition } from "@/components/sales/event-edition-dialog";
import { useEditionDates } from "@/components/sales/use-edition-dates";
import type { EventChoice } from "@/lib/crm/events/model";
import { organisationDetail } from "../../new/new-enquiry-form";

export interface EditableOpportunity {
  id: string;
  version: number;
  agencyOrgId: string | null;
  clientOrgId: string | null;
  /** The event edition the enquiry is linked to, or null. */
  eventEditionId?: string | null;
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

type PartyOrganisation = { id: string; name: string; kind: string; roles: string[]; place: string | null; country: string | null; website: string | null };

/**
 * Agency, end client and Event / Exhibition of the inquiry, each ONE search-as-you-type field. Each party list offers only organisations that hold that role: one
 * recorded as both an agency and an end client is in both; one recorded as neither is in neither. Saving a role the organisation lacks is also refused by the database.
 * A field is posted ONLY when changed, so saving other details never rewrites (or logs a change to) the agency, end client or event link.
 */
function PartyFields({ agencyOrgId, clientOrgId, eventEditionId, event, onEdition, onLoaded, added, onCreate }: {
  agencyOrgId: string | null; clientOrgId: string | null; eventEditionId: string | null;
  /** The chosen edition ("" = none), held by the form so a newly created edition can be selected. */
  event: string;
  /** The Event / Exhibition choice changed ("" = cleared): the dates follow it by the shared rules. */
  onEdition: (id: string) => void;
  /** The editions and events arrived (the dates need the editions' own dates; the create form needs the events). */
  onLoaded: (editions: EditionOption[], events: EventChoice[]) => void;
  /** Editions created from this form since it opened (offered and selected at once). */
  added: readonly CreatedEdition[];
  /** Opens the form that adds a missing event or edition, with the text typed so far. */
  onCreate: (typed: string) => void;
}) {
  const [orgs, setOrgs] = useState<PartyOrganisation[] | null>(null);
  const [editions, setEditions] = useState<EditionOption[]>([]);
  const [editionsFailed, setEditionsFailed] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [initial] = useState<Record<InquiryField | "event", string>>({ agency: agencyOrgId ?? "", client: clientOrgId ?? "", event: eventEditionId ?? "" });
  const [parties, setParties] = useState<Record<InquiryField, string>>({ agency: initial.agency, client: initial.client });
  const value: Record<InquiryField | "event", string> = { ...parties, event };
  const loaded = useRef(onLoaded);
  useEffect(() => { loaded.current = onLoaded; });
  useEffect(() => {
    let live = true;
    loadInquiryOrganisations(eventEditionId).then((r) => {
      if (!live) return;
      if (r.ok) { setOrgs(r.organisations); setEditions(r.editions); setEditionsFailed(r.editionsFailed); loaded.current(r.editions, r.events); } else setFailed(r.error);
    }).catch(() => { if (live) setFailed("Could not load the organisations. Close this and try again."); });
    return () => { live = false; };
  }, [eventEditionId]);
  const partyOptions = (field: InquiryField): ComboOption[] => offeredFor(orgs ?? [], field, value[field]).map((o) => ({ id: o.id, label: o.name, detail: organisationDetail(o) }));
  const known = new Set(editions.map((e) => e.id));
  const editionOptions: ComboOption[] = [
    ...added.filter((a) => !known.has(a.editionId)).map((a) => ({ id: a.editionId, label: a.label, detail: a.detail })),
    ...editions.map((e) => ({ id: e.id, label: e.archived ? `${e.label} (archived)` : e.label, detail: e.detail })),
  ];
  const nameFor = (field: InquiryField, name: string) => (value[field] !== initial[field] ? name : undefined);
  // `key` forces the field to re-read its options when the lists arrive (it shows the current choice's name as soon as it can).
  const party = (field: InquiryField, label: string, name: string, id: string) => (
    <SearchCombobox key={`${field}-${orgs ? "ready" : "loading"}`} id={id} name={nameFor(field, name)} label={label} hint={orgs ? `Organisations recorded as ${FIELD_NOUN[field]}.` : "Loading…"}
      options={partyOptions(field)} value={value[field]} onChange={(v) => setParties((x) => ({ ...x, [field]: v }))} disabled={!orgs} placeholder="Type a name to search" />
  );
  if (failed) return <Alert variant="destructive">{failed}</Alert>;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">{party("agency", "Agency", "agency_org_id", "ed-agency")}{party("client", "End client", "client_org_id", "ed-client")}</div>
      {editionsFailed ? <p className="text-sm text-destructive" role="alert">Could not load the events, so the event link cannot be changed right now.</p> : (
        <SearchCombobox key={`event-${orgs ? "ready" : "loading"}`} id="ed-event" name={value.event !== initial.event ? "event_edition_id" : undefined} label="Event / Exhibition (optional)"
          hint="Set, change or clear the show this enquiry is for. Choosing one fills the show dates below that you have not set yourself." options={editionOptions}
          value={value.event} onChange={onEdition} onQueryChange={setTyped} disabled={!orgs} placeholder="Type an event name or year"
          emptyText={(q) => <>Nothing matches “{q}”. Use Create event or edition below to add it.</>}
          footer={orgs ? <Button type="button" size="sm" variant="ghost" onClick={() => onCreate(value.event ? "" : typed.trim())}><Plus className="h-4 w-4" aria-hidden /> Create event or edition</Button> : undefined} />
      )}
    </div>
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
      <EditDetailsForm onClose={onClose} data={data} mode={mode} availabilityWillNeedRecheck={availabilityWillNeedRecheck} />
    </Modal>
  );
}

/** The form itself: mounted only while the dialog is open, so it always starts from the saved enquiry. */
function EditDetailsForm({ onClose, data, mode, availabilityWillNeedRecheck }: EditDetailsProps & { onClose: () => void }) {
  const [editions, setEditions] = useState<EditionOption[]>([]);
  const [events, setEvents] = useState<EventChoice[]>([]);
  const [added, setAdded] = useState<CreatedEdition[]>([]);
  const [eventDialog, setEventDialog] = useState<{ name: string } | null>(null);
  // The saved show dates are the enquiry's own: opening the form never changes them. Choosing a DIFFERENT edition fills only a date that is empty (or was itself
  // filled from an edition in this form); a saved or typed date is kept, with the offer to use the edition's.
  const allEditions = [...added.map((a) => ({ id: a.editionId, start: a.start, end: a.end })), ...editions];
  const dates = useEditionDates({ start: data.eventStart, end: data.eventEnd, editionId: data.eventEditionId ?? "", editions: allEditions });
  const [eventChoice, setEventChoice] = useState(data.eventEditionId ?? "");
  return (
    <>
      <ActionForm action={updateOpportunity} submitLabel="Save changes" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
        <input type="hidden" name="id" value={data.id} />
        <input type="hidden" name="expectedVersion" value={data.version} />
        {mode === "full" ? (
          <>
            {availabilityWillNeedRecheck ? <Alert variant="warning">Equipment availability was checked for the current dates and quantities. Changing the installation or show dates, or the technologies, means the check must be repeated.</Alert> : null}
            <PartyFields agencyOrgId={data.agencyOrgId} clientOrgId={data.clientOrgId} eventEditionId={data.eventEditionId ?? null} added={added} event={eventChoice}
              onEdition={(id) => { setEventChoice(id); dates.setEdition(id); }} onLoaded={(e, ev) => { setEditions(e); setEvents(ev); }} onCreate={(name) => setEventDialog({ name })} />
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
              <Field label="Show starts" htmlFor="ed-start"><Input id="ed-start" name="event_start" type="date" value={dates.start} onChange={(e) => dates.setStart(e.target.value)} /></Field>
              <Field label="Show ends" htmlFor="ed-end"><Input id="ed-end" name="event_end" type="date" min={dates.start || undefined} value={dates.end} onChange={(e) => dates.setEnd(e.target.value)} /></Field>
            </div>
            {dates.note}
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
      {/* Its own explicit save, outside the edit form: nothing typed in the edit form is submitted or lost by it. On success the new edition is selected and the dates follow the shared rules. */}
      {mode === "full" ? (
        <EventEditionDialog open={eventDialog !== null} onClose={() => setEventDialog(null)} events={events}
          initial={{ name: eventDialog?.name ?? "", start: dates.start, end: dates.end }}
          onCreated={(c) => { setAdded((prev) => [...prev, c]); setEventChoice(c.editionId); dates.setEdition(c.editionId, { id: c.editionId, start: c.start, end: c.end }); }} />
      ) : null}
    </>
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
