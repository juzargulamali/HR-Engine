"use client";

import { useState } from "react";
import { addSiteActivities, removeShipment, saveShipment, saveSiteActivity, setActivityReadiness, setSiteCrew } from "@/lib/actions/projectsPhase2";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog, type Done, type Option } from "@/components/projects/delivery/delivery-forms";
import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, CREW_ROLE_LABELS, CREW_ROLES, dayIn, READY_LABELS, timeIn, toLocalInput, type ActivityKind, type CrewRole, type ReadyLevel, type SiteActivity, type SiteShipment } from "@/lib/projects/phase2/model";
import { COMMON_TIME_ZONES } from "@/lib/projects/format";

const zones = (tz: string | null, extra: (string | null | undefined)[] = []) => [...new Set([tz, ...extra, ...COMMON_TIME_ZONES].filter((z): z is string => !!z))];

/** Add or edit ONE site activity. Incomplete plans save: a date with no time is "time to confirm"; Confirmed needs a date; a confirmed date or time cannot change without a reason. */
export function ActivityDialog({ projectId, activity, members, tz, label, triggerVariant = "outline" }: { projectId: string; activity?: SiteActivity; members: Option[]; tz: string | null; label?: string; triggerVariant?: "outline" | "default" | "ghost" }) {
  const a = activity;
  const atz = a?.tz ?? tz;
  const startDay = a?.starts_at ? dayIn(a.starts_at, atz) : (a?.start_date ?? "");
  const endDay = a?.ends_at ? dayIn(a.ends_at, atz) : (a?.end_date ?? "");
  const [timed, setTimed] = useState(!!a?.starts_at);
  const [state, setState] = useState<"tentative" | "confirmed">(a?.state ?? "tentative");
  return (
    <FormDialog label={label ?? (a ? "Edit" : "Add activity")} variant={triggerVariant} title={a ? `Edit ${a.title}` : "Add a site activity"} dialogSize="wide" testId={a ? undefined : "site-add-activity"}
      description="Where and when something happens on site. Save what you know: the time and the crew can follow. Tentative until you confirm it.">
      {(done) => (
        <ActionForm action={saveSiteActivity} submitLabel={a ? "Save" : "Add activity"} onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          {a ? <><input type="hidden" name="itemId" value={a.id} /><input type="hidden" name="expectedVersion" value={a.version} /></> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind" htmlFor="sa-kind"><Select id="sa-kind" name="kind" defaultValue={a?.kind ?? "setup"}>{ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_KIND_LABELS[k]}</option>)}</Select></Field>
            <Field label="Run (optional)" htmlFor="sa-run" hint="Run 1, Run 2: separate runs are separate records, so nothing says the equipment stays installed between them."><Input id="sa-run" name="run" maxLength={60} defaultValue={a?.run_label ?? ""} /></Field>
          </div>
          <Field label="Name" htmlFor="sa-title" hint="Leave empty to use the kind and run."><Input id="sa-title" name="title" maxLength={200} defaultValue={a?.title ?? ""} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Location" htmlFor="sa-loc"><Input id="sa-loc" name="location" maxLength={200} defaultValue={a?.location ?? ""} /></Field>
            <Field label="Owner" htmlFor="sa-owner"><Select id="sa-owner" name="owner" defaultValue={a?.owner_id ?? ""}><option value="">No owner yet</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date" htmlFor="sa-start"><Input id="sa-start" name="start" type="date" defaultValue={startDay} /></Field>
            <Field label="End date" htmlFor="sa-end" hint="Same as the start when it is one day."><Input id="sa-end" name="end" type="date" defaultValue={endDay} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="h-4 w-4" /> The time window is known</label>
          {timed ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="From" htmlFor="sa-from"><Input id="sa-from" name="startTime" type="time" defaultValue={a?.starts_at ? timeIn(a.starts_at, atz) : ""} /></Field>
              <Field label="To" htmlFor="sa-to"><Input id="sa-to" name="endTime" type="time" defaultValue={a?.ends_at ? timeIn(a.ends_at, atz) : ""} /></Field>
              <Field label="Time zone of this activity" htmlFor="sa-tz" hint="For travel or overseas work."><Select id="sa-tz" name="tz" defaultValue={atz ?? ""}>{zones(atz).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</Select></Field>
            </div>
          ) : <p className="text-[13px] text-muted-foreground">Without a time window the activity is a date with its time still to confirm.</p>}
          <Field label="State" htmlFor="sa-state"><Select id="sa-state" name="state" value={state} onChange={(e) => setState(e.target.value as "tentative" | "confirmed")}><option value="tentative">Tentative</option><option value="confirmed">Confirmed</option></Select></Field>
          {a?.state === "confirmed" ? <Field label="Why is a date or time changing? (required if it does)" htmlFor="sa-reason" hint="A confirmed activity does not change silently. The reason is kept in the history."><Input id="sa-reason" name="reason" maxLength={300} /></Field> : null}
          <Field label="Notes (optional)" htmlFor="sa-notes"><Textarea id="sa-notes" name="notes" rows={2} maxLength={2000} defaultValue={a?.notes ?? ""} /></Field>
        </ActionForm>
      )}
    </FormDialog>
  );
}

type Row = { id: number; kind: ActivityKind; title: string; run: string; location: string; owner: string; state: "tentative" | "confirmed"; start: string; end: string; time: string };
const START_ROWS = 4;

/** Quick entry: several activities in one save (up to 25). Saving again adds nothing twice. Time as 09:00-18:00, or empty while it is to be confirmed. */
export function QuickAddActivitiesDialog({ projectId, members }: { projectId: string; members: Option[] }) {
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: START_ROWS }, (_, id) => ({ id, kind: id === 1 ? "show" : "setup", title: "", run: "", location: "", owner: "", state: "tentative", start: "", end: "", time: "" })));
  const set = (id: number, p: Partial<Row>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const next = () => Math.max(-1, ...rows.map((r) => r.id)) + 1;
  return (
    <FormDialog label="Quick add" title="Add several site activities" dialogSize="xl" testId="site-quick-add"
      description="One row per activity. Rows already on the schedule (same kind, name and start day) are never added twice, so saving again is safe. A row needs at least a date, a name, a run or a location.">
      {(done) => (
        <ActionForm action={addSiteActivities} submitLabel="Add activities" pendingLabel="Adding…" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          <div className="space-y-2">
            {rows.map((r, n) => (
              <div key={r.id} className="space-y-2 rounded-md border border-border p-2" data-testid={`sq-row-${n}`}>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[10rem_minmax(0,1.4fr)_8rem_minmax(0,1fr)_auto]">
                  <Select name="rowKind" aria-label={`Row ${n + 1} kind`} value={r.kind} onChange={(e) => set(r.id, { kind: e.target.value as ActivityKind })}>{ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_KIND_LABELS[k]}</option>)}</Select>
                  <Input name="rowTitle" aria-label={`Row ${n + 1} name`} placeholder="Name (optional)" value={r.title} onChange={(e) => set(r.id, { title: e.target.value })} maxLength={200} />
                  <Input name="rowRun" aria-label={`Row ${n + 1} run`} placeholder="Run 1" value={r.run} onChange={(e) => set(r.id, { run: e.target.value })} maxLength={60} />
                  <Input name="rowLocation" aria-label={`Row ${n + 1} location`} placeholder="Location" value={r.location} onChange={(e) => set(r.id, { location: e.target.value })} maxLength={200} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))} aria-label={`Remove row ${n + 1}`}>Remove</Button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1.4fr)_9rem_9rem_9rem_9rem]">
                  <Select name="rowOwner" aria-label={`Row ${n + 1} owner`} value={r.owner} onChange={(e) => set(r.id, { owner: e.target.value })}><option value="">No owner yet</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
                  <Input name="rowStart" aria-label={`Row ${n + 1} start date`} type="date" value={r.start} onChange={(e) => set(r.id, { start: e.target.value })} />
                  <Input name="rowEnd" aria-label={`Row ${n + 1} end date`} type="date" value={r.end} onChange={(e) => set(r.id, { end: e.target.value })} />
                  <Input name="rowTime" aria-label={`Row ${n + 1} time`} placeholder="09:00-18:00" value={r.time} onChange={(e) => set(r.id, { time: e.target.value })} maxLength={11} />
                  <Select name="rowState" aria-label={`Row ${n + 1} state`} value={r.state} onChange={(e) => set(r.id, { state: e.target.value as "tentative" | "confirmed" })}><option value="tentative">Tentative</option><option value="confirmed">Confirmed</option></Select>
                  <input type="hidden" name="rowTz" value="" />
                </div>
              </div>
            ))}
          </div>
          {rows.length < 25 ? <Button type="button" variant="outline" size="sm" onClick={() => setRows((all) => [...all, { id: next(), kind: "setup", title: "", run: "", location: "", owner: "", state: "tentative", start: "", end: "", time: "" }])}>Add a row</Button> : null}
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** The crew of ONE activity, by role, set as a whole: separate runs can have different people. People may be members of the project or site-only technicians of the company; each can have a call time and instructions. */
export function CrewDialog({ projectId, activity, members, label }: { projectId: string; activity: SiteActivity; members: (Option & { siteOnly?: boolean })[]; label?: string }) {
  type Row = { id: number; user: string; role: CrewRole; call: string; note: string };
  const localCall = (iso: string | null | undefined, tz: string | null | undefined) => {
    if (!iso) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? activity.tz ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
      const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
      return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
    } catch { return ""; }
  };
  const [rows, setRows] = useState<Row[]>(() => (activity.crew.length > 0 ? activity.crew.map((c, id) => ({ id, user: c.user_id, role: c.role, call: localCall(c.call_at, c.call_tz), note: c.instructions ?? "" })) : [{ id: 0, user: "", role: "installation" as CrewRole, call: "", note: "" }]));
  const set = (id: number, patch: Partial<Row>) => setRows((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <FormDialog label={label ?? (activity.crew.length > 0 ? "Crew" : "Assign crew")} title={`Crew: ${activity.title}`} dialogSize="wide" testId={`site-crew-${activity.id}`}
      description="Who works this activity, and in which role: Installation, Standby, Backup or Dismantling. Another run has its own crew. People removed here are taken off this activity only.">
      {(done) => (
        <ActionForm action={setSiteCrew} submitLabel="Save crew" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="itemId" value={activity.id} />
          <Alert role="note" data-testid="crew-site-only-note">People marked <strong>site-only</strong> are company employees who are not on the project. They see only this assignment: the activity, their role, the venue, their call time, the instructions below and brief readiness. They get no Project Chat, tasks, files, reviews or commercial information, and lose even that when you remove them here or the activity ends.</Alert>
          {rows.map((r, n) => (
            <div key={r.id} className="space-y-2 rounded-md border border-border p-2.5" data-testid={`crew-row-${n}`}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
                <Select name="crewUser" aria-label={`Crew ${n + 1} person`} value={r.user} onChange={(e) => set(r.id, { user: e.target.value })}><option value="">Choose a person…</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.siteOnly ? " (site-only)" : ""}</option>)}</Select>
                <Select name="crewRole" aria-label={`Crew ${n + 1} role`} value={r.role} onChange={(e) => set(r.id, { role: e.target.value as CrewRole })}>{CREW_ROLES.map((c) => <option key={c} value={c}>{CREW_ROLE_LABELS[c]}</option>)}</Select>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))} aria-label={`Remove crew row ${n + 1}`}>Remove</Button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                <Field label="Call time" htmlFor={`cw-call-${r.id}`} hint={`In the activity's zone${activity.tz ? ` (${activity.tz})` : ""}.`}><Input id={`cw-call-${r.id}`} name="crewCall" type="datetime-local" value={r.call} onChange={(e) => set(r.id, { call: e.target.value })} /></Field>
                <Field label="Instructions for this person (optional)" htmlFor={`cw-note-${r.id}`}><Input id={`cw-note-${r.id}`} name="crewNote" maxLength={1000} value={r.note} onChange={(e) => set(r.id, { note: e.target.value })} placeholder="Where to meet, what to bring" /></Field>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((all) => [...all, { id: Math.max(-1, ...all.map((x) => x.id)) + 1, user: "", role: "installation", call: "", note: "" }])}>Add a person</Button>
          <details className="text-sm"><summary className="cursor-pointer font-medium">Someone is already booked at this time?</summary>
            <div className="mt-2"><Field label="Reason to assign them anyway (needs site-conflict authority)" htmlFor="cw-override" hint="On a confirmed activity an overlap with a confirmed booking or another confirmed activity is refused unless a founder, or someone a founder gave site-conflict authority to, gives a reason."><Input id="cw-override" name="overrideReason" maxLength={300} /></Field></div>
          </details>
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** The crew's brief: instructions every assigned person can read, and a quick hardware / content / app readiness. Project Manager only. */
export function ReadinessDialog({ projectId, activity }: { projectId: string; activity: SiteActivity }) {
  const r = activity.ready ?? { hardware: "unknown", content: "unknown", app: "unknown", note: null };
  const sel = (name: "hardware" | "content" | "app", label: string) => (
    <Field label={label} htmlFor={`rd-${name}`}><Select id={`rd-${name}`} name={name} defaultValue={r[name]}>{(Object.keys(READY_LABELS) as ReadyLevel[]).map((k) => <option key={k} value={k}>{READY_LABELS[k]}</option>)}</Select></Field>
  );
  return (
    <FormDialog label="Brief" title={`Brief for the crew: ${activity.title}`} testId={`site-brief-${activity.id}`}
      description="What everyone assigned to this activity should know. They see this, their own role, the venue and their call time, and nothing else about the project.">
      {(done) => (
        <ActionForm action={setActivityReadiness} submitLabel="Save brief" onDone={(s) => done(s as Done)}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="itemId" value={activity.id} />
          <div className="grid gap-3 sm:grid-cols-3">{sel("hardware", "Hardware")}{sel("content", "Content")}{sel("app", "App")}</div>
          <Field label="Readiness note (optional)" htmlFor="rd-note"><Input id="rd-note" name="note" maxLength={500} defaultValue={r.note ?? ""} placeholder="For example: final video due Thursday" /></Field>
          <Field label="Instructions for the crew (optional)" htmlFor="rd-ins" hint="Access, parking, safety, who to ask for on arrival."><Textarea id="rd-ins" name="crewInstructions" rows={4} maxLength={2000} defaultValue={activity.crew_instructions ?? ""} /></Field>
        </ActionForm>
      )}
    </FormDialog>
  );
}

/** A shipment: departure, expected arrival and return, each with its own time zone (overseas legs), the setup it supports and the Inventory request it carries (its reservation, dispatch and return state is READ from Inventory). */
export function ShipmentDialog({ projectId, shipment, activities, requests, tz, label }: { projectId: string; shipment?: SiteShipment; activities: { id: string; name: string }[]; requests: { id: string; name: string }[]; tz: string | null; label?: string }) {
  const s = shipment;
  const [state, setState] = useState<"tentative" | "confirmed">(s?.state ?? "tentative");
  const dtz = s?.departs_tz ?? tz, atz = s?.arrives_tz ?? tz, rtz = s?.returns_tz ?? atz;
  return (
    <FormDialog label={label ?? (s ? "Edit" : "Add shipment")} variant={s ? "outline" : "default"} title={s ? `Edit ${s.label}` : "Add a shipment"} dialogSize="wide" testId={s ? undefined : "site-add-shipment"}
      description="Departure, expected arrival and return, each in its own time zone. Save what you know. If it arrives after the setup it supports, the schedule says so.">
      {(done) => (
        <ActionForm action={saveShipment} submitLabel={s ? "Save" : "Add shipment"} onDone={(r) => done(r as Done)}>
          <input type="hidden" name="projectId" value={projectId} />
          {s ? <><input type="hidden" name="shipmentId" value={s.id} /><input type="hidden" name="expectedVersion" value={s.version} /></> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="sh-label"><Input id="sh-label" name="label" maxLength={200} defaultValue={s?.label ?? ""} placeholder="Equipment from Mumbai" required={!s} /></Field>
            <Field label="Supports this setup" htmlFor="sh-act"><Select id="sh-act" name="planItemId" defaultValue={s?.plan_item_id ?? ""}><option value="">Not linked</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          </div>
          <Field label="Equipment request" htmlFor="sh-req" hint="Optional. Its reservation, dispatch and return state is read from Inventory, never typed here."><Select id="sh-req" name="requestId" defaultValue={s?.request?.id ?? ""}><option value="">None</option>{requests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          {([["departs", "Departs", s?.departs_at, dtz], ["arrives", "Expected arrival", s?.arrives_at, atz], ["returns", "Returns", s?.returns_at, rtz]] as const).map(([k, title, at, z]) => (
            <div key={k} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Field label={title} htmlFor={`sh-${k}`}><Input id={`sh-${k}`} name={`${k}Local`} type="datetime-local" defaultValue={toLocalInput(at, z)} /></Field>
              <Field label={`${title}: time zone`} htmlFor={`sh-${k}-tz`}><Select id={`sh-${k}-tz`} name={`${k}Tz`} defaultValue={z ?? ""}>{zones(z, [dtz, atz, "Asia/Kolkata"]).map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</Select></Field>
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Carrier" htmlFor="sh-car"><Input id="sh-car" name="carrier" maxLength={200} defaultValue={s?.carrier ?? ""} /></Field>
            <Field label="Reference" htmlFor="sh-ref"><Input id="sh-ref" name="reference" maxLength={200} defaultValue={s?.reference ?? ""} /></Field>
            <Field label="State" htmlFor="sh-state"><Select id="sh-state" name="state" value={state} onChange={(e) => setState(e.target.value as "tentative" | "confirmed")}><option value="tentative">Tentative</option><option value="confirmed">Confirmed</option></Select></Field>
          </div>
          {s?.state === "confirmed" ? <Field label="Why is a time changing? (required if it does)" htmlFor="sh-reason"><Input id="sh-reason" name="reason" maxLength={300} /></Field> : null}
          <Field label="Notes (optional)" htmlFor="sh-notes"><Textarea id="sh-notes" name="notes" rows={2} maxLength={1000} defaultValue={s?.notes ?? ""} /></Field>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function RemoveShipmentDialog({ projectId, shipment }: { projectId: string; shipment: SiteShipment }) {
  return (
    <FormDialog label="Remove" variant="ghost" title="Remove shipment" description={`"${shipment.label}" is taken off the schedule. The Inventory request it carried is not changed.`}>
      {(done) => (
        <ActionForm action={removeShipment} submitLabel="Remove" variant="destructive" onDone={(r) => done(r as Done)}>
          <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="shipmentId" value={shipment.id} />
          <Alert role="status">This cannot be undone, but the shipment can be added again.</Alert>
        </ActionForm>
      )}
    </FormDialog>
  );
}
