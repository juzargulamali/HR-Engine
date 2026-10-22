"use client";

import { useState } from "react";
import { saveRequestPlan } from "@/lib/actions/inventoryPlanning";
import { PLAN_FIELDS, formatLocalPlan, planToFormValues } from "@/lib/inventory/planning";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Field, InvForm, type InvAction } from "./inv-form";

/**
 * The planning dates of a request: eight named phases, each a local date and time in the request's own time zone (shown, and
 * changeable). A draft saves them directly. A submitted request changes them through the date-change function, which rechecks every
 * reservation, never takes equipment away from anybody and reports what could not move; that report is shown here in words.
 */
export function PlanForm({ requestId, version, status, timezone, plan, projectId, editable, hasReservations }: {
  requestId: string; version: number; status: string; timezone: string; plan: Record<string, string | null>; projectId?: string | null; editable: boolean; hasReservations: boolean;
}) {
  const values = planToFormValues(plan);
  const [result, setResult] = useState<{ summary: string; conflicts: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);

  if (!editable) {
    const filled = PLAN_FIELDS.filter((f) => values[f.key]);
    return filled.length === 0 ? <p className="text-sm text-muted-foreground">No planning dates were set.</p> : (
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {filled.map((f) => (
          <div key={f.key}><dt className="text-muted-foreground">{f.label}</dt><dd>{formatLocalPlan(values[f.key])} <span className="text-muted-foreground">({timezone})</span></dd></div>
        ))}
      </dl>
    );
  }

  // The result is kept here (not inside the form) so it stays on screen while the page refreshes with the new version.
  const wrapped: InvAction = async (prev, fd) => {
    const r = await saveRequestPlan(prev, fd);
    if (r.error === null) {
      setDirty(false);
      setResult({ summary: r.warning ?? "The dates are saved.", conflicts: (r.detail?.conflicts as string[] | undefined) ?? [] });
      return { ...r, warning: undefined };
    }
    setResult(null);
    return r;
  };
  const moving = status !== "draft";
  return (
    <div onInput={() => { setResult(null); setDirty(true); }} className="space-y-3">
      <InvForm action={wrapped} submitLabel={moving ? "Change the dates" : "Save the dates"} pendingLabel={moving ? "Checking reservations…" : "Saving…"}>
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="expectedVersion" value={version} />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {PLAN_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`plan-${requestId}-${f.key}`}>
              <Input id={`plan-${requestId}-${f.key}`} name={f.key} type="datetime-local" defaultValue={values[f.key]} />
            </Field>
          ))}
        </div>
        <Field label="Time zone of these dates" htmlFor={`tz-${requestId}`} hint="Every date above is the local time at the place it happens, in this time zone. Daylight saving is taken care of.">
          <Input id={`tz-${requestId}`} name="timezone" list={`tz-list-${requestId}`} defaultValue={timezone} maxLength={64} />
          <datalist id={`tz-list-${requestId}`}>{COMMON_TIME_ZONES.map((z) => <option key={z} value={z} />)}</datalist>
        </Field>
        {moving ? (
          <p className="text-sm text-muted-foreground">
            {hasReservations
              ? "Equipment is already reserved. Changing the dates rechecks every reservation: lines that are free for the new dates move, the others keep their earlier dates and are listed here. Nobody else's reservation is ever taken away."
              : "Nothing is reserved yet, so the new dates apply straight away."}
          </p>
        ) : null}
        {dirty ? <p className="sr-only" role="status">Unsaved changes</p> : null}
      </InvForm>
      {result ? (
        <Alert role="status" variant={result.conflicts.length > 0 ? "warning" : "success"}>
          <p>{result.summary}</p>
          {result.conflicts.length > 0 ? <ul className="mt-2 list-disc space-y-1 pl-5">{result.conflicts.map((c) => <li key={c}>{c}</li>)}</ul> : null}
        </Alert>
      ) : null}
    </div>
  );
}
