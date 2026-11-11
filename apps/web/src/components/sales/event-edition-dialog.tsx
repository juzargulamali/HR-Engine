"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { saveEventEdition, type EventEditionState } from "@/lib/actions/events";
import { addEditionLabel, editionLabel, EVENT_KIND_LABEL, eventWithName, type EventChoice } from "@/lib/crm/events/model";
import type { EditionOption } from "@/lib/crm/events/data";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";

/** What the form starts with: the name typed so far and any dates already entered (for example on the enquiry it was opened from). */
export interface EventEditionInitial { name?: string; start?: string; end?: string; eventId?: string }
/** What was just saved: the event (new or existing), its new edition and the words a picker shows for it. */
export interface CreatedEdition { eventId: string; eventName: string; newEvent: boolean; editionId: string; label: string; detail: string }

/**
 * The ONE form that adds an event together with its first edition, or adds a missing edition to an existing event. Used by Add event on Events & Exhibitions and by
 * Create event or edition on an enquiry. It is its own explicit save: nothing around it (an enquiry being written) is saved or changed by it. Typing the name of an
 * event that already exists shows that event and offers to add the edition to it instead; the database refuses a second event with the same name either way.
 */
export function EventEditionDialog({ open, onClose, events, initial, onCreated }: {
  open: boolean; onClose: () => void; events: readonly EventChoice[]; initial?: EventEditionInitial; onCreated: (created: CreatedEdition) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add an event or edition" description="An event (for example GITEX Global) and the dated edition of it. One save adds both. Every company sees the same events.">
      <EventEditionForm onClose={onClose} events={events} initial={initial ?? {}} onCreated={onCreated} />
    </Modal>
  );
}

function EventEditionForm({ onClose, events, initial, onCreated }: { onClose: () => void; events: readonly EventChoice[]; initial: EventEditionInitial; onCreated: (created: CreatedEdition) => void }) {
  const [mode, setMode] = useState<"new" | "existing">(initial.eventId ? "existing" : "new");
  const [name, setName] = useState(initial.name ?? "");
  const [eventId, setEventId] = useState(initial.eventId ?? "");
  const [start, setStart] = useState(initial.start ?? "");
  const [end, setEnd] = useState(initial.end ?? "");
  const [city, setCity] = useState("");
  const [venue, setVenue] = useState("");
  const match = mode === "new" ? eventWithName(events, name) : null;
  const chosen = mode === "existing" ? events.find((e) => e.id === eventId) ?? null : null;
  const submitLabel = mode === "new" ? "Add event and first edition" : chosen ? addEditionLabel(chosen.editions) : "Add edition";

  const done = (state: EventEditionState) => {
    if (!state.id || !state.editionId) return;
    const eventName = mode === "new" ? name.trim() : chosen?.name ?? "";
    onCreated({
      eventId: state.id, eventName, newEvent: mode === "new", editionId: state.editionId,
      label: editionLabel({ name: eventName }, { start_date: start, city: city.trim() || null }), detail: [venue.trim(), start].filter(Boolean).join(" · "),
    });
    onClose();
  };

  return (
    <ActionForm action={saveEventEdition} submitLabel={submitLabel} onDone={done} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
      {mode === "new" ? (
        <>
          <Field label="Event name" htmlFor="ee-name">
            <Input id="ee-name" name="name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GITEX Global" autoComplete="off" />
          </Field>
          {match ? (
            <Alert role="status" className="space-y-2">
              <p><strong>{match.name}</strong> is already in Events &amp; Exhibitions{match.editions > 0 ? ` (${match.editions} ${match.editions === 1 ? "edition" : "editions"})` : " (no edition yet)"}. A second event with the same name cannot be added: add this as an edition of it instead.</p>
              <Button type="button" size="sm" variant="outline" className="h-auto min-h-9 max-w-full whitespace-normal py-1.5 text-left" onClick={() => { setEventId(match.id); setMode("existing"); }}><Plus className="h-4 w-4 shrink-0" aria-hidden /> Add an edition to {match.name}</Button>
            </Alert>
          ) : null}
          <Field label="Type" htmlFor="ee-kind">
            <Select id="ee-kind" name="kind" defaultValue="exhibition">{Object.entries(EVENT_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          </Field>
          {events.length > 0 && !match ? <button type="button" className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setMode("existing")}>The event already exists: add an edition to it instead</button> : null}
        </>
      ) : (
        <>
          <Field label="Event" htmlFor="ee-event">
            <Select id="ee-event" name="eventId" required value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="" disabled>Choose the event…</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <button type="button" className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setMode("new")}>Add a new event instead</button>
        </>
      )}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">{mode === "new" ? "First edition" : chosen && chosen.editions === 0 ? "First edition" : "Edition"}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts" htmlFor="ee-start"><Input id="ee-start" name="start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Ends" htmlFor="ee-end"><Input id="ee-end" name="end" type="date" required min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="City" htmlFor="ee-city"><Input id="ee-city" name="city" maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} autoComplete="off" /></Field>
          <Field label="Country code" htmlFor="ee-country" hint="Two letters, e.g. AE"><Input id="ee-country" name="country" maxLength={2} className="uppercase" autoComplete="off" /></Field>
          <Field label="Venue" htmlFor="ee-venue"><Input id="ee-venue" name="venue" maxLength={200} value={venue} onChange={(e) => setVenue(e.target.value)} autoComplete="off" /></Field>
        </div>
        <Field label="Note (optional)" htmlFor="ee-note"><Textarea id="ee-note" name="note" rows={2} maxLength={1000} /></Field>
      </fieldset>
    </ActionForm>
  );
}

/**
 * For a form that holds an Event / Exhibition field: the editions and events it was given, plus the ones added from it since. The page behind may or may not have
 * re-read the list yet, so an edition that is in both is shown once.
 */
export function useCreatedEditions(editions: readonly EditionOption[], events: readonly EventChoice[]) {
  const [added, setAdded] = useState<CreatedEdition[]>([]);
  const allEditions = useMemo<EditionOption[]>(() => {
    const have = new Set(editions.map((e) => e.id));
    return [...added.filter((a) => !have.has(a.editionId)).map((a) => ({ id: a.editionId, label: a.label, detail: a.detail, archived: false })), ...editions];
  }, [added, editions]);
  const allEvents = useMemo<EventChoice[]>(() => {
    const have = new Set(editions.map((e) => e.id));
    const byId = new Map(events.map((e) => [e.id, { ...e }]));
    for (const a of added) {
      const e = byId.get(a.eventId);
      if (!e) byId.set(a.eventId, { id: a.eventId, name: a.eventName, editions: 1 });
      else if (!have.has(a.editionId)) e.editions += 1;
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [added, editions, events]);
  return { allEditions, allEvents, add: (c: CreatedEdition) => setAdded((prev) => [...prev, c]) };
}
