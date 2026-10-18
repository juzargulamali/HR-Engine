"use client";

import { DEPENDENCY_KIND_LABELS, CONFIRMATION_LABELS } from "@enginious-hr/domain";
import { saveExternalDependency } from "@/lib/actions/projectsPlans";
import { Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DialogActionForm } from "./dialog";

export interface DependencyFormProps {
  projectId: string;
  siteTimezone: string;
  milestones: { id: string; title: string }[];
  dependency?: {
    id: string; kind: string; label: string; expectedDate: string; expectedTime: string; organisation: string; contact: string; confirmation: string;
    milestoneId: string; clientFacing: boolean; notes: string; version: number;
  };
}

/** Something outside the team that has to happen first. Recorded here only: no account, portal or message is involved. */
export function DependencyForm({ projectId, siteTimezone, milestones, dependency: d }: DependencyFormProps) {
  const id = d?.id ?? "new";
  return (
    <DialogActionForm action={saveExternalDependency} submitLabel={d ? "Save dependency" : "Add dependency"}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientFacingPresent" value="1" />
      {d ? <><input type="hidden" name="dependencyId" value={d.id} /><input type="hidden" name="expectedVersion" value={d.version} /></> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind" htmlFor={`dp-k-${id}`}>
          <Select id={`dp-k-${id}`} name="kind" defaultValue={d?.kind ?? "other"}>{Object.entries(DEPENDENCY_KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="Confirmation" htmlFor={`dp-c-${id}`}>
          <Select id={`dp-c-${id}`} name="confirmation" defaultValue={d?.confirmation ?? "pending"}>{Object.entries(CONFIRMATION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
      </div>
      <Field label="What are you waiting for" htmlFor={`dp-l-${id}`}><Input id={`dp-l-${id}`} name="label" required defaultValue={d?.label ?? ""} placeholder="e.g. Power and network drop at the stand" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expected date" htmlFor={`dp-d-${id}`}><Input id={`dp-d-${id}`} name="expectedDate" type="date" defaultValue={d?.expectedDate ?? ""} /></Field>
        <Field label={`Expected time (optional, ${siteTimezone.replace(/_/g, " ")} site time)`} htmlFor={`dp-t-${id}`}><Input id={`dp-t-${id}`} name="expectedTime" type="time" defaultValue={d?.expectedTime ?? ""} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Responsible organisation" htmlFor={`dp-o-${id}`}><Input id={`dp-o-${id}`} name="organisation" defaultValue={d?.organisation ?? ""} placeholder="e.g. the standbuilder" /></Field>
        <Field label="Contact (internal)" htmlFor={`dp-p-${id}`} hint="Never printed on the client timeline."><Input id={`dp-p-${id}`} name="contact" defaultValue={d?.contact ?? ""} /></Field>
      </div>
      <Field label="Linked milestone (optional)" htmlFor={`dp-m-${id}`}>
        <Select id={`dp-m-${id}`} name="milestoneId" defaultValue={d?.milestoneId ?? ""}><option value="">None</option>{milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</Select>
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="clientFacing" defaultChecked={d?.clientFacing ?? false} className="mt-1" />
        <span>Offer this on the client timeline (label, date, organisation and confirmation only).</span>
      </label>
      <Field label="Notes (internal)" htmlFor={`dp-n-${id}`}><Textarea id={`dp-n-${id}`} name="notes" rows={2} defaultValue={d?.notes ?? ""} /></Field>
      {d ? <Field label="Reason for a change of date" htmlFor={`dp-r-${id}`}><Input id={`dp-r-${id}`} name="reason" /></Field> : null}
      <p className="text-sm text-muted-foreground">This is a record for the team. Nothing is sent to the standbuilder or the client, and they get no account.</p>
    </DialogActionForm>
  );
}
