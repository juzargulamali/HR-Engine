"use client";

import { PRIORITY_LABELS } from "@enginious-hr/domain";
import { reopenProject } from "@/lib/actions/projectsClose";
import { updateProject } from "@/lib/actions/projectsCore";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Modal } from "@/components/ui/modal";

export interface EditableProject {
  id: string;
  version: number;
  kind: "client" | "internal";
  name: string;
  priority: string;
  isOngoing: boolean;
  startDate: string | null;
  endDate: string | null;
  clientName: string | null;
  location: string | null;
  siteTimezone: string;
  installStart: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  scope: string | null;
  exclusions: string | null;
}

/** Edit the project's details. A client project's agreed scope is not editable here: it changes only through a recorded scope change. */
export function EditDetailsDialog({ p, open, onClose }: { p: EditableProject; open: boolean; onClose: () => void }) {
  const internal = p.kind === "internal";
  const zones = COMMON_TIME_ZONES.includes(p.siteTimezone) ? COMMON_TIME_ZONES : [p.siteTimezone, ...COMMON_TIME_ZONES];
  return (
    <>
      <Modal open={open} onClose={onClose} title="Edit project details" description={internal ? undefined : "The agreed scope of a client project is not changed here. Use a scope change under Manage project, Feedback & changes."}>
        <ActionForm action={updateProject} submitLabel="Save details" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
          <input type="hidden" name="projectId" value={p.id} />
          <input type="hidden" name="expectedVersion" value={p.version} />
          <Field label="Name" htmlFor="ed-name"><Input id="ed-name" name="name" required defaultValue={p.name} maxLength={200} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Priority" htmlFor="ed-priority">
              <Select id="ed-priority" name="priority" defaultValue={p.priority}>
                {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Site time zone" htmlFor="ed-tz" hint="Installation and show bookings use this zone.">
              <Select id="ed-tz" name="siteTimezone" defaultValue={p.siteTimezone}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</Select>
            </Field>
            <Field label="Project start" htmlFor="ed-start"><Input id="ed-start" name="startDate" type="date" defaultValue={p.startDate ?? ""} /></Field>
            <Field label="Project end" htmlFor="ed-end"><Input id="ed-end" name="endDate" type="date" defaultValue={p.endDate ?? ""} /></Field>
            <Field label="Installation starts" htmlFor="ed-install"><Input id="ed-install" name="installStart" type="date" defaultValue={p.installStart ?? ""} /></Field>
            <span className="hidden sm:block" />
            <Field label="Event starts" htmlFor="ed-event-start"><Input id="ed-event-start" name="eventStart" type="date" defaultValue={p.eventStart ?? ""} /></Field>
            <Field label="Event ends" htmlFor="ed-event-end"><Input id="ed-event-end" name="eventEnd" type="date" defaultValue={p.eventEnd ?? ""} /></Field>
          </div>
          {!internal ? <Field label="Client" htmlFor="ed-client"><Input id="ed-client" name="clientName" defaultValue={p.clientName ?? ""} /></Field> : null}
          <Field label="Location" htmlFor="ed-location"><Input id="ed-location" name="location" defaultValue={p.location ?? ""} /></Field>
          {internal ? (
            <>
              <Field label="Scope" htmlFor="ed-scope"><Textarea id="ed-scope" name="scope" rows={4} defaultValue={p.scope ?? ""} /></Field>
              <Field label="Exclusions" htmlFor="ed-excl"><Textarea id="ed-excl" name="exclusions" rows={3} defaultValue={p.exclusions ?? ""} /></Field>
              <input type="hidden" name="isOngoingPresent" value="1" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isOngoing" defaultChecked={p.isOngoing} /> Ongoing work (not forced through installation and show stages)</label>
            </>
          ) : null}
        </ActionForm>
      </Modal>
    </>
  );
}

/** Reopen a completed project. Needs the reopen capability (the database checks) and a reason; the completion record stays. */
export function ReopenDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  return (
    <>
      <Modal open={open} onClose={onClose} title="Reopen project" description="The earlier completion stays in the history. Anything cancelled or deferred when it was completed stays that way until the Project Manager reinstates it.">
        <ActionForm action={reopenProject} submitLabel="Reopen" onDone={onClose} secondary={<Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>}>
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="Why is it being reopened?" htmlFor="ro-reason"><Textarea id="ro-reason" name="reason" required rows={3} /></Field>
        </ActionForm>
      </Modal>
    </>
  );
}
