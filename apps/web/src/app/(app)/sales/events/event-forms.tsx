"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { removeEdition, removeEvent, saveEdition, saveEvent } from "@/lib/actions/events";
import { EVENT_KIND_LABEL } from "@/lib/crm/events/model";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";

export interface EventValues { id?: string; name: string; kind: string; website: string; note: string }
export interface EditionValues { id?: string; eventId?: string; start: string; end: string; city: string; country: string; venue: string; note: string }

/** Add an event (the recurring thing: "GITEX Global"). Its dates and place belong to its editions, added next. */
export function AddEventButton({ label = "Add event" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden /> {label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add an event" description="The recurring event, for example GITEX Global. Its dates and place are recorded per edition, which you add next.">
        <ActionForm action={saveEvent} submitLabel="Add event" onDone={(s) => { setOpen(false); if (s.id) router.push(`/sales/events/${s.id}`); }} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <EventFields values={{ name: "", kind: "exhibition", website: "", note: "" }} />
        </ActionForm>
      </Modal>
    </>
  );
}

export function EditEventButton({ values }: { values: EventValues }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><Pencil className="h-4 w-4" aria-hidden /> Edit event</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit event" description="Only the person who added the event, or a founder, can change it.">
        <ActionForm action={saveEvent} submitLabel="Save event" onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          <input type="hidden" name="id" value={values.id} />
          <EventFields values={values} />
        </ActionForm>
      </Modal>
    </>
  );
}

function EventFields({ values }: { values: EventValues }) {
  return (
    <>
      <Field label="Event name" htmlFor="ev-name"><Input id="ev-name" name="name" required maxLength={200} defaultValue={values.name} placeholder="e.g. GITEX Global" autoComplete="off" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind" htmlFor="ev-kind">
          <Select id="ev-kind" name="kind" defaultValue={values.kind}>{Object.entries(EVENT_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
        <Field label="Website (optional)" htmlFor="ev-web"><Input id="ev-web" name="website" maxLength={300} defaultValue={values.website} placeholder="https://" autoComplete="off" /></Field>
      </div>
      <Field label="Note (optional)" htmlFor="ev-note"><Textarea id="ev-note" name="note" rows={2} maxLength={1000} defaultValue={values.note} /></Field>
    </>
  );
}

/** Add the next edition of an event (earlier editions and their dates are never touched), or correct one edition's dates and place. */
export function EditionButton({ events, values, eventId, label, variant = "outline" }: {
  /** The events to choose from when adding (omit when `eventId` fixes it). */
  events?: { id: string; name: string }[]; values?: EditionValues; eventId?: string; label?: string; variant?: "outline" | "default" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const editing = !!values?.id;
  const v: EditionValues = values ?? { eventId, start: "", end: "", city: "", country: "", venue: "", note: "" };
  return (
    <>
      <Button type="button" variant={editing ? "ghost" : variant} size={editing ? "sm" : "default"} onClick={() => setOpen(true)} aria-label={editing ? "Edit edition" : undefined}>
        {editing ? <Pencil className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}{editing ? null : ` ${label ?? "Add edition"}`}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit edition" : "Add an edition"} description={editing ? "Correct this edition's dates or place. Other editions are not changed." : "One occurrence of the event, with its own dates and place. Earlier editions keep their dates."}>
        <ActionForm action={saveEdition} submitLabel={editing ? "Save edition" : "Add edition"} onDone={() => setOpen(false)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}>
          {editing ? <input type="hidden" name="id" value={v.id} /> : null}
          {!editing && eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}
          {!editing && !eventId ? (
            <Field label="Event" htmlFor="ed-event"><Select id="ed-event" name="eventId" required defaultValue=""><option value="" disabled>Choose the event…</option>{(events ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" htmlFor="ed-start"><Input id="ed-start" name="start" type="date" required defaultValue={v.start} /></Field>
            <Field label="Ends" htmlFor="ed-end"><Input id="ed-end" name="end" type="date" required defaultValue={v.end} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="City" htmlFor="ed-city"><Input id="ed-city" name="city" maxLength={100} defaultValue={v.city} autoComplete="off" /></Field>
            <Field label="Country code" htmlFor="ed-country" hint="Two letters, e.g. AE"><Input id="ed-country" name="country" maxLength={2} defaultValue={v.country} className="uppercase" autoComplete="off" /></Field>
            <Field label="Venue" htmlFor="ed-venue"><Input id="ed-venue" name="venue" maxLength={200} defaultValue={v.venue} autoComplete="off" /></Field>
          </div>
          <Field label="Note (optional)" htmlFor="ed-note"><Textarea id="ed-note" name="note" rows={2} maxLength={1000} defaultValue={v.note} /></Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Removes an unused edition or event, and ARCHIVES one with linked enquiries or observations (every link and observation stays). Says which happened. */
export function RemoveButton({ kind, id, name }: { kind: "event" | "edition"; id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error?: string; note?: string } | null>(null);
  async function run() {
    const what = kind === "event" ? "this event and its editions" : "this edition";
    if (!confirm(`Remove ${name}?\n\nIf nothing uses ${what} it is deleted. If enquiries or observations are linked to it, it is archived instead and every link and observation stays.`)) return;
    setBusy(true); setResult(null);
    try {
      const r = kind === "event" ? await removeEvent(id) : await removeEdition(id);
      if (r.error) setResult({ error: r.error });
      else { setResult({ note: r.archived ? "Archived: it has enquiries or observations, which are kept." : "Removed." }); router.refresh(); }
    } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-col items-start">
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={run} aria-label={`Remove ${kind} ${name}`}><Trash2 className="h-4 w-4" aria-hidden /></Button>
      {result?.error ? <Alert variant="destructive" role="alert" className="mt-1 px-2 py-1 text-xs">{result.error}</Alert> : null}
      {result?.note ? <span role="status" className="text-xs text-muted-foreground">{result.note}</span> : null}
    </span>
  );
}
