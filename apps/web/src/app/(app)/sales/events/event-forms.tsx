"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { archiveEdition, archiveEvent, saveEdition, saveEvent } from "@/lib/actions/events";
import { EVENT_KIND_LABEL, type EventChoice } from "@/lib/crm/events/model";
import { EventEditionDialog } from "@/components/sales/event-edition-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { MoreMenu } from "@/components/workspace/more-menu";

export interface EventValues { id?: string; name: string; kind: string; website: string; note: string }
export interface EditionValues { id?: string; eventId?: string; start: string; end: string; city: string; country: string; venue: string; note: string }

/** The three words the Events pages use, in one place so every ⓘ says the same thing. */
export const EVENT_WORDS = {
  event: "An event is the recurring show, for example GITEX Global. It is added once, with its first edition, and every company sees it.",
  edition: "An edition is one dated occurrence of an event, with its own dates and place. Enquiries and observations are linked to an edition, not to the event.",
  next: "The next edition is the following occurrence of an event that already has one. It starts with the place of the latest edition; earlier editions and their dates are never changed.",
} as const;

/** The event's page with one edition selected, keeping the company (or All my companies) the person was working in. `keep` is that part of the address. */
const eventHref = (eventId: string, editionId: string, keep: string) => `/sales/events/${eventId}?edition=${editionId}${keep ? `&${keep}` : ""}`;

/**
 * Add event: a NEW recurring event TOGETHER with its first edition (dates and place), in one save. Opens the new event with that edition selected. Typing the
 * name of an event that already exists offers to add the edition to that event instead (the database refuses a second event with the same name).
 */
export function AddEventButton({ events, label = "Add event", keep = "" }: { events: readonly EventChoice[]; label?: string; /** `company=<id>` or `scope=all`, carried to the new event's page. */ keep?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} title="A new recurring event, added together with its first edition"><Plus className="h-4 w-4" aria-hidden /> {label}</Button>
      <EventEditionDialog open={open} onClose={() => setOpen(false)} events={events} onCreated={(c) => router.push(eventHref(c.eventId, c.editionId, keep))} />
    </>
  );
}

function EventFields({ values }: { values: EventValues }) {
  return (
    <>
      <Field label="Event name" htmlFor="ev-name" help="The name of the recurring show, without the year. Two events cannot have the same name."><Input id="ev-name" name="name" required maxLength={200} defaultValue={values.name} placeholder="e.g. GITEX Global" autoComplete="off" /></Field>
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

function EditionFields({ v }: { v: EditionValues }) {
  return (
    <>
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
    </>
  );
}

/**
 * Adds an edition of an event that already exists. Three cases, each with its own words:
 *  - "Add edition" (Events list): the person chooses the event;
 *  - "Add first edition": the event on screen has none yet;
 *  - "Add next edition": the following occurrence of the event on screen, starting with the place of its latest edition (`prefill`). The dates are left
 *    empty on purpose: a show rarely repeats on the same days, and a guessed date in a required field is easily saved by mistake.
 * After saving, the event opens with the new edition selected. The database refuses a second edition of the same event starting on the same date.
 */
export function EditionButton({ events, eventId, eventName, label, prefill, keep = "", variant = "outline" }: {
  /** The events to choose from (omit when `eventId` fixes it). */
  events?: { id: string; name: string }[]; eventId?: string; eventName?: string;
  /** "Add edition", "Add first edition" or "Add next edition". */
  label?: string;
  /** The place of the latest edition and what to call it, for "Add next edition". */
  prefill?: { city: string; country: string; venue: string; from: string };
  keep?: string; variant?: "outline" | "default" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const router = useRouter();
  const text = label ?? "Add edition";
  const next = !!prefill;
  const v: EditionValues = { eventId, start: "", end: "", city: prefill?.city ?? "", country: prefill?.country ?? "", venue: prefill?.venue ?? "", note: "" };
  const consequence = !eventId
    ? "Adds one dated occurrence to an event that already exists. Earlier editions keep their dates."
    : next
      ? `Adds the following occurrence of ${eventName ?? "this event"}. The place is copied from ${prefill.from}: change it if the show has moved. Earlier editions are not changed.`
      : `Adds the first dated occurrence of ${eventName ?? "this event"}.`;
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)} title={!eventId ? "A dated occurrence of an event that already exists" : next ? "The following occurrence, starting with the place of the latest edition" : "The first dated occurrence of this event"}>
        <Plus className="h-4 w-4" aria-hidden /> {text}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={text} description={consequence} help={<><p>{EVENT_WORDS.edition}</p><p className="mt-2">{EVENT_WORDS.next}</p><p className="mt-2">An event cannot have two editions starting on the same date.</p></>}>
        <ActionForm action={saveEdition} submitLabel={text} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
          onDone={(state) => { setOpen(false); const ev = eventId ?? chosen; if (ev && state.id) router.push(eventHref(ev, state.id, keep)); }}>
          {eventId ? <input type="hidden" name="eventId" value={eventId} /> : (
            <Field label="Event" htmlFor="ed-event" help={EVENT_WORDS.event}>
              <Select id="ed-event" name="eventId" required value={chosen} onChange={(e) => setChosen(e.target.value)}><option value="" disabled>Choose the event…</option>{(events ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
            </Field>
          )}
          <EditionFields v={v} />
        </ActionForm>
      </Modal>
    </>
  );
}

/**
 * ARCHIVE: the only removal in Sales (nothing is deleted), behind a menu because it is rare. The confirmation says what happens before anything does. The words are
 * the same whatever is attached, so they never reveal an enquiry the person cannot see. Everything stays in history and keeps its links; it is only no longer
 * offered for NEW enquiry links. Who may archive is decided by the database (the person who added it, or a founder), and its refusal is shown in the dialog.
 */
function ArchiveDialog({ kind, id, name, open, onClose }: { kind: "event" | "edition"; id: string; name: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = kind === "event" ? await archiveEvent(id) : await archiveEdition(id);
      if (r.error) setError(r.error);
      else { onClose(); router.refresh(); }
    } catch { setError("The archive did not finish. Reload the page to see whether it went through before trying again."); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Archive ${name}?`}>
      <div className="space-y-3 text-sm">
        <p><strong>What happens:</strong> {kind === "event" ? "this event and all its editions are" : "this edition is"} marked Archived and no longer offered when linking a new enquiry or recording a new observation.</p>
        <p><strong>What stays:</strong> nothing is deleted. {kind === "event" ? "The event, its editions, their" : "The edition, its"} observations and every enquiry link stay in history and can still be opened (tick “Include archived” on the list).</p>
        <p className="text-muted-foreground">Archiving cannot be undone from this screen. Only the person who added {kind === "event" ? "the event" : "the edition"}, or a founder, can archive it.</p>
        {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Keep it</Button>
          <Button type="button" onClick={run} disabled={busy} aria-label={`Archive ${kind} ${name}`}>{busy ? "Archiving…" : `Archive ${kind}`}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The event's infrequent actions: Edit event, and Archive (separated, last). */
export function EventMenu({ values, archived }: { values: EventValues & { id: string }; archived: boolean }) {
  const [open, setOpen] = useState<"edit" | "archive" | null>(null);
  return (
    <>
      <MoreMenu label="More" items={[
        { key: "edit", label: "Edit event", hint: "Name, kind, website and note", onSelect: () => setOpen("edit") },
        ...(archived ? [] : [{ key: "archive", label: "Archive event…", hint: "Kept in history; no longer offered for new enquiry links", separatorBefore: true, onSelect: () => setOpen("archive") }]),
      ]} />
      <Modal open={open === "edit"} onClose={() => setOpen(null)} title="Edit event" description="Changes the event for every company. Its editions are not changed." help="Only the person who added the event, or a founder, can change it. A second event with the same name is refused.">
        <ActionForm action={saveEvent} submitLabel="Save event" onDone={() => setOpen(null)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>}>
          <input type="hidden" name="id" value={values.id} />
          <EventFields values={values} />
        </ActionForm>
      </Modal>
      <ArchiveDialog kind="event" id={values.id} name={values.name} open={open === "archive"} onClose={() => setOpen(null)} />
    </>
  );
}

/** One edition's infrequent actions, in its row: correct its dates and place, or archive it. */
export function EditionMenu({ values, name }: { values: EditionValues & { id: string }; name: string }) {
  const [open, setOpen] = useState<"edit" | "archive" | null>(null);
  return (
    <>
      <MoreMenu label="More" variant="ghost" items={[
        { key: "edit", label: "Edit dates and place", onSelect: () => setOpen("edit") },
        { key: "archive", label: "Archive edition…", hint: "Kept in history; no longer offered for new enquiry links", separatorBefore: true, onSelect: () => setOpen("archive") },
      ]} />
      <Modal open={open === "edit"} onClose={() => setOpen(null)} title={`Edit ${name}`} description="Corrects this edition's dates or place. Other editions are not changed." help="Only the person who added the edition, or a founder, can change it. An event cannot have two editions starting on the same date.">
        <ActionForm action={saveEdition} submitLabel="Save edition" onDone={() => setOpen(null)} secondary={<Button type="button" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>}>
          <input type="hidden" name="id" value={values.id} />
          <EditionFields v={values} />
        </ActionForm>
      </Modal>
      <ArchiveDialog kind="edition" id={values.id} name={name} open={open === "archive"} onClose={() => setOpen(null)} />
    </>
  );
}
