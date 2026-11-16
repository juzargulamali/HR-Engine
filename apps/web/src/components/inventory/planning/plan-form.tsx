"use client";

import { useState } from "react";
import { saveRequestPlan } from "@/lib/actions/inventoryPlanning";
import { PLAN_FIELDS, formatLocalPlan, planToFormValues } from "@/lib/inventory/planning";
import { coverOfRuns, staysOutSentence, suggestWindow, type RunOption } from "@/lib/inventory/runs";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Field, InvForm, type InvAction } from "./inv-form";

/** The two dates the warehouse works to. They stay in the main form; the other six phases are under "More dates". */
const MAIN_KEYS = ["dispatch", "return_due"] as const;
const MAIN_HELP: Record<(typeof MAIN_KEYS)[number], string> = {
  dispatch: "The day and time the equipment leaves the warehouse for the site. The warehouse picks and sends to this date.",
  return_due: "The day and time the equipment is due back in the warehouse. Until then it is not offered to anyone else.",
};

export interface RunChoice {
  /** The project's site runs (Site schedule), in date order. */
  options: RunOption[];
  /** The runs this request serves now. */
  selected: string[];
}

/**
 * The dates of a request, in the request's own time zone. LEAVES WAREHOUSE and DUE BACK are always in the main form; the other six planning phases are
 * one click away under "More dates" (the booking window still runs from the earliest to the latest of all of them, so preparation and inspection time stay in the
 * availability calculation). For a project request the Project Manager also ticks the SITE RUNS it serves: dates are suggested from them and shown in place
 * (never applied silently), and each ticked run says whether the dates cover it. A draft saves the dates directly. A submitted request changes them through the
 * date-change function, which rechecks every reservation, never takes equipment away from anybody and reports what could not move; that report is shown here.
 */
export function PlanForm({ requestId, version, status, timezone, plan, projectId, editable, hasReservations, runs }: {
  requestId: string; version: number; status: string; timezone: string; plan: Record<string, string | null>; projectId?: string | null; editable: boolean; hasReservations: boolean;
  /** Present for a project request on a database that has the run links (Inventory Phase 1). */
  runs?: RunChoice | null;
}) {
  const values = planToFormValues(plan);
  const [result, setResult] = useState<{ summary: string; conflicts: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [main, setMain] = useState<Record<(typeof MAIN_KEYS)[number], string>>({ dispatch: values.dispatch, return_due: values.return_due });
  const [chosen, setChosen] = useState<string[]>(runs?.selected ?? []);
  const served = runs ? runs.options.filter((r) => chosen.includes(r.id)) : [];
  const cover = runs ? coverOfRuns(runs.options, chosen, main.dispatch, main.return_due) : [];
  const suggestion = runs ? suggestWindow(runs.options, chosen) : null;
  const suggestionDiffers = !!suggestion && (suggestion.dispatch !== main.dispatch || suggestion.returnDue !== main.return_due);

  if (!editable) {
    const filled = PLAN_FIELDS.filter((f) => values[f.key]);
    return (
      <div className="space-y-3">
        {filled.length === 0 ? <p className="text-sm text-muted-foreground">No planning dates were set.</p> : (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {filled.map((f) => (
              <div key={f.key}><dt className="text-muted-foreground">{f.label}</dt><dd>{formatLocalPlan(values[f.key])} <span className="text-muted-foreground">({timezone})</span></dd></div>
            ))}
          </dl>
        )}
        {runs && cover.length > 0 ? <RunsCovered cover={cover} /> : null}
      </div>
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
  const other = PLAN_FIELDS.filter((f) => !(MAIN_KEYS as readonly string[]).includes(f.key));
  const mainFields = MAIN_KEYS.map((k) => PLAN_FIELDS.find((f) => f.key === k)!);
  return (
    <div onInput={() => { setResult(null); setDirty(true); }} className="space-y-3" data-testid={`send-to-warehouse-${requestId}`}>
      <InvForm action={wrapped} submitLabel={moving ? "Change the dates" : runs ? "Save the dates and site runs" : "Save the dates"} pendingLabel={moving ? "Checking reservations…" : "Saving…"}>
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="expectedVersion" value={version} />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}

        {runs ? (
          <fieldset className="space-y-2 rounded-md border border-border p-3" data-testid="runs-served">
            <legend className="flex items-center gap-1 px-1 text-sm font-medium">Site runs this request serves
              <InfoHint label="site runs this request serves">Tick every site run this equipment is needed for. When the same equipment stays on site between two runs, tick both: it is sent once and comes back once. The warehouse and Operations then see the status of this request under each run.</InfoHint>
            </legend>
            <input type="hidden" name="runsIncluded" value="1" />
            {runs.options.length === 0 ? <p className="text-sm text-muted-foreground">The Site schedule has no runs yet. Add them in the Site schedule, then tick them here; the dates below can be set by hand meanwhile.</p> : (
              <ul className="space-y-1">
                {runs.options.map((r) => (
                  <li key={r.id}>
                    <label className="flex min-h-[2.75rem] cursor-pointer items-center gap-3 rounded-md px-1 text-sm hover:bg-secondary/40">
                      <input type="checkbox" name="runIds" value={r.id} checked={chosen.includes(r.id)} onChange={(e) => { setChosen((c) => (e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id))); setDirty(true); setResult(null); }} className="h-5 w-5 flex-none accent-[hsl(var(--accent))]" />
                      <span className="min-w-0"><span className="font-medium">{r.title}</span> <span className="text-muted-foreground">· {r.when}{r.location ? ` · ${r.location}` : ""}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {suggestion && suggestionDiffers ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/50 px-3 py-2 text-sm" data-testid="runs-suggestion">
                <span className="min-w-0 flex-1">Suggested from the Site schedule: leaves warehouse <strong>{formatLocalPlan(suggestion.dispatch)}</strong>, due back <strong>{formatLocalPlan(suggestion.returnDue)}</strong> (the day before {suggestion.firstRun} starts, the day after {suggestion.lastRun} ends).</span>
                <Button type="button" size="sm" variant="outline" className="h-10 sm:h-8" onClick={() => { setMain({ dispatch: suggestion.dispatch, return_due: suggestion.returnDue }); setDirty(true); setResult(null); }}>Use these dates</Button>
              </div>
            ) : null}
          </fieldset>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {mainFields.map((f) => (
            <Field key={f.key} label={f.label} help={MAIN_HELP[f.key as (typeof MAIN_KEYS)[number]]} htmlFor={`plan-${requestId}-${f.key}`}>
              <Input id={`plan-${requestId}-${f.key}`} name={f.key} type="datetime-local" value={main[f.key as (typeof MAIN_KEYS)[number]]} onChange={(e) => setMain({ ...main, [f.key]: e.target.value })} className="h-11 sm:h-9" />
            </Field>
          ))}
        </div>
        {runs && cover.length > 0 ? <RunsCovered cover={cover} /> : null}
        {runs && served.length === 0 && runs.options.length > 0 ? <p className="text-sm text-muted-foreground">No site run is ticked, so the status of this request is not shown under any run.</p> : null}

        <details className="rounded-md border border-border">
          <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">More dates <span className="font-normal text-muted-foreground">(preparation, installation, show, dismantling, inspection; time zone)</span></summary>
          <div className="space-y-3 border-t border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {other.map((f) => (
                <Field key={f.key} label={f.label} htmlFor={`plan-${requestId}-${f.key}`}>
                  <Input id={`plan-${requestId}-${f.key}`} name={f.key} type="datetime-local" defaultValue={values[f.key]} />
                </Field>
              ))}
            </div>
            <Field label="Time zone of these dates" htmlFor={`tz-${requestId}`} hint="Every date is the local time at the place it happens, in this time zone. Daylight saving is taken care of.">
              <Input id={`tz-${requestId}`} name="timezone" list={`tz-list-${requestId}`} defaultValue={timezone} maxLength={64} />
              <datalist id={`tz-list-${requestId}`}>{COMMON_TIME_ZONES.map((z) => <option key={z} value={z} />)}</datalist>
            </Field>
            <p className="text-xs text-muted-foreground">The equipment is held for this request from the earliest to the latest of all its dates, so preparation and inspection time are counted when availability is checked.</p>
          </div>
        </details>
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

/** Each ticked run with "Covered" or why not, in words as well as colour, and the sentence about equipment that stays out between runs. */
function RunsCovered({ cover }: { cover: ReturnType<typeof coverOfRuns> }) {
  const between = staysOutSentence(cover.filter((c) => c.covered !== false));
  return (
    <div className="space-y-1.5 text-sm" data-testid="runs-covered">
      <p className="font-medium">Site runs covered by these dates</p>
      <ul className="space-y-1">
        {cover.map((c) => (
          <li key={c.run.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-covered={c.covered === null ? "unknown" : String(c.covered)}>
            <Badge variant={c.covered === true ? "success" : c.covered === false ? "warning" : "outline"}>{c.covered === true ? "Covered" : c.covered === false ? "Not covered" : "Not checked"}</Badge>
            <span className="font-medium">{c.run.title}</span><span className="text-muted-foreground">{c.run.when}</span>
            {c.reason ? <span className="basis-full text-[hsl(var(--os-amber))]">{c.reason}</span> : null}
          </li>
        ))}
      </ul>
      {between ? <p className="text-muted-foreground" data-testid="runs-stay-out">{between}</p> : null}
    </div>
  );
}
