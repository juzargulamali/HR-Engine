"use client";

import { useState } from "react";
import { PLAN_LABELS } from "@enginious-hr/domain";
import { savePlanItem } from "@/lib/actions/projectsPlans";
import { Field } from "@/components/sales/action-form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";
import { DialogActionForm } from "./dialog";

export interface PlanItemFormProps {
  projectId: string;
  plan: "delivery" | "site";
  siteTimezone: string;
  milestones: { id: string; title: string }[];
  item?: {
    id: string; title: string; mode: "undated" | "dates" | "timed"; startDate: string; endDate: string; startsLocal: string; endsLocal: string; tz: string;
    status: string; clientFacing: boolean; milestoneId: string; notes: string; version: number;
  };
}

/** Add or edit one timeline item: undated, date-only, or timed in a named zone (the wall-clock time is converted by the database). */
export function PlanItemForm({ projectId, plan, siteTimezone, milestones, item }: PlanItemFormProps) {
  const [mode, setMode] = useState<"undated" | "dates" | "timed">(item?.mode ?? (plan === "site" ? "dates" : "dates"));
  const editing = !!item;
  const zones = [...new Set([item?.tz || siteTimezone, siteTimezone, ...COMMON_TIME_ZONES])];
  const id = item?.id ?? `new-${plan}`;
  return (
    <DialogActionForm action={savePlanItem} submitLabel={editing ? "Save item" : "Add item"}>
      <input type="hidden" name="projectId" value={projectId} />
      {item ? <><input type="hidden" name="itemId" value={item.id} /><input type="hidden" name="expectedVersion" value={item.version} /></> : <input type="hidden" name="plan" value={plan} />}
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="clientFacingPresent" value="1" />
      <Field label="What" htmlFor={`pi-title-${id}`}><Input id={`pi-title-${id}`} name="title" required defaultValue={item?.title ?? ""} placeholder={plan === "delivery" ? "e.g. First draft" : "e.g. Installation"} /></Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">When</legend>
        <div className="flex flex-wrap gap-3">
          {([["dates", "Dates"], ["timed", "Date and time at the site"], ["undated", "Not scheduled yet"]] as const).map(([v, l]) => (
            <label key={v} className="flex items-center gap-2 text-sm"><input type="radio" name={`pi-mode-${id}`} checked={mode === v} onChange={() => setMode(v)} />{l}</label>
          ))}
        </div>
      </fieldset>
      {mode === "dates" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First day" htmlFor={`pi-sd-${id}`} hint="Plain dates: they never move with a time zone."><Input id={`pi-sd-${id}`} name="startDate" type="date" defaultValue={item?.startDate ?? ""} required /></Field>
          <Field label="Last day (optional)" htmlFor={`pi-ed-${id}`}><Input id={`pi-ed-${id}`} name="endDate" type="date" defaultValue={item?.endDate ?? ""} /></Field>
        </div>
      ) : null}
      {mode === "timed" ? (
        <div className="space-y-3">
          <Field label="Time zone of the site" htmlFor={`pi-tz-${id}`} hint="The times below are the wall-clock times in this zone. Daylight-saving changes are handled for you.">
            <Select id={`pi-tz-${id}`} name="tz" defaultValue={item?.tz || siteTimezone}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" htmlFor={`pi-sl-${id}`}><Input id={`pi-sl-${id}`} name="startsLocal" type="datetime-local" defaultValue={item?.startsLocal ?? ""} required /></Field>
            <Field label="Ends" htmlFor={`pi-el-${id}`}><Input id={`pi-el-${id}`} name="endsLocal" type="datetime-local" defaultValue={item?.endsLocal ?? ""} required /></Field>
          </div>
        </div>
      ) : null}
      {editing ? (
        <Field label="Status" htmlFor={`pi-st-${id}`}>
          <Select id={`pi-st-${id}`} name="status" defaultValue={item.status}>
            {[["planned", "Planned"], ["in_progress", "In progress"], ["done", "Done"], ["cancelled", "Cancelled"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
      ) : null}
      <Field label="Linked milestone (optional)" htmlFor={`pi-ms-${id}`}>
        <Select id={`pi-ms-${id}`} name="milestoneId" defaultValue={item?.milestoneId ?? ""}>
          <option value="">None</option>
          {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </Select>
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="clientFacing" defaultChecked={item?.clientFacing ?? false} className="mt-1" />
        <span>Offer this on the client timeline. <span className="text-muted-foreground">Nothing is shown to the client unless it is ticked here and you then issue the timeline.</span></span>
      </label>
      <Field label="Notes (internal)" htmlFor={`pi-n-${id}`}><Textarea id={`pi-n-${id}`} name="notes" rows={2} defaultValue={item?.notes ?? ""} /></Field>
      {editing ? <Field label="Reason for a change of dates" htmlFor={`pi-r-${id}`} hint="Kept in the change history."><Input id={`pi-r-${id}`} name="reason" /></Field> : null}
      <p className="text-sm text-muted-foreground">{PLAN_LABELS[plan]}: an editable plan, not a commitment to anyone. Changing a date moves nothing else.</p>
    </DialogActionForm>
  );
}
