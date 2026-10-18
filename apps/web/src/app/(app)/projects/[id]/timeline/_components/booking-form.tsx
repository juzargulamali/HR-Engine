"use client";

import { saveSiteBooking } from "@/lib/actions/projectsPlans";
import { Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";
import { DialogActionForm } from "./dialog";

export interface BookingFormProps {
  projectId: string;
  siteTimezone: string;
  people: { id: string; name: string }[];
  siteItems: { id: string; title: string }[];
  booking?: { id: string; userId: string; location: string; startsLocal: string; endsLocal: string; tz: string; lead: number; trail: number; planItemId: string; notes: string; confirmed: boolean; version: number };
}

/** A physical site booking for one person: where, when (wall-clock time in the site's zone), with preparation and travel allowances. */
export function BookingForm({ projectId, siteTimezone, people, siteItems, booking: b }: BookingFormProps) {
  const id = b?.id ?? "new";
  const zones = [...new Set([b?.tz || siteTimezone, siteTimezone, ...COMMON_TIME_ZONES])];
  return (
    <DialogActionForm action={saveSiteBooking} submitLabel={b ? "Save booking" : "Add booking (tentative)"}>
      <input type="hidden" name="projectId" value={projectId} />
      {b ? <><input type="hidden" name="bookingId" value={b.id} /><input type="hidden" name="expectedVersion" value={b.version} /></> : null}
      <Field label="Who is booked" htmlFor={`bk-u-${id}`}>
        <Select id={`bk-u-${id}`} name="userId" required defaultValue={b?.userId ?? ""}>
          <option value="" disabled>Choose a person</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Site / location" htmlFor={`bk-l-${id}`}><Input id={`bk-l-${id}`} name="location" required defaultValue={b?.location ?? ""} placeholder="e.g. Expo Hall 3, stand B12" /></Field>
      <Field label="Time zone of the site" htmlFor={`bk-tz-${id}`} hint="The start and end are the wall-clock times in this zone.">
        <Select id={`bk-tz-${id}`} name="tz" defaultValue={b?.tz || siteTimezone}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts" htmlFor={`bk-s-${id}`}><Input id={`bk-s-${id}`} name="startsLocal" type="datetime-local" required defaultValue={b?.startsLocal ?? ""} /></Field>
        <Field label="Ends" htmlFor={`bk-e-${id}`} hint="May be the next day or later."><Input id={`bk-e-${id}`} name="endsLocal" type="datetime-local" required defaultValue={b?.endsLocal ?? ""} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Preparation / travel before (minutes)" htmlFor={`bk-lead-${id}`}><Input id={`bk-lead-${id}`} name="leadMinutes" type="number" min={0} max={1440} step={5} defaultValue={b?.lead ?? 0} /></Field>
        <Field label="Travel after (minutes)" htmlFor={`bk-trail-${id}`}><Input id={`bk-trail-${id}`} name="trailMinutes" type="number" min={0} max={1440} step={5} defaultValue={b?.trail ?? 0} /></Field>
      </div>
      <Field label="Site activity (optional)" htmlFor={`bk-p-${id}`}>
        <Select id={`bk-p-${id}`} name="planItemId" defaultValue={b?.planItemId ?? ""}><option value="">None</option>{siteItems.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</Select>
      </Field>
      <Field label="Notes (internal)" htmlFor={`bk-n-${id}`}><Textarea id={`bk-n-${id}`} name="notes" rows={2} defaultValue={b?.notes ?? ""} /></Field>
      {b ? <Field label="Reason for the change" htmlFor={`bk-r-${id}`}><Input id={`bk-r-${id}`} name="reason" /></Field> : null}
      <p className="text-sm text-muted-foreground">
        A booking starts as tentative and is checked for overlaps when it is confirmed.{b?.confirmed ? " Changing who, when or the allowances withdraws the confirmation: it has to be confirmed again." : ""}
      </p>
    </DialogActionForm>
  );
}
