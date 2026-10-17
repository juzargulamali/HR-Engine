"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { HOLD_REASONS, LOST_REASONS, PIPELINE_STAGES, SETTINGS_HISTORY, SOURCES, STAGES, allowedMoves, fmtDateTime, personName, stageLabel } from "../../_lib/data";
import { usePreview } from "../../_components/context";
import { Chip, Field, PageHeader, Panel, Restriction, StateGate, useNotice } from "../../_components/ui";

function Unset() { return <span className="text-xs text-muted-foreground">Not set. To be decided by the owner.</span>; }

export default function SalesSettings() {
  const { roleDef } = usePreview();
  const can = roleDef.canConfigureSales;
  const { notify, node } = useNotice();
  const [labels, setLabels] = useState<Record<string, string>>(Object.fromEntries(STAGES.map((s) => [s.id, s.label])));
  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="Sales settings" description="Everything the team may need to tune without a code change. Blank means the business has not decided yet: nothing is guessed." />
      {!can ? <div className="mb-5"><Restriction>Only people with the “configure Sales” capability can change these. You can read them.</Restriction></div> : null}
      <StateGate what="Sales settings" emptyTitle="Nothing configured yet" emptyText="Defaults are used until settings are saved.">
        <form noValidate onSubmit={(e) => { e.preventDefault(); notify("Settings recorded in history"); }} className="space-y-6">
          <fieldset disabled={!can} className="space-y-6 disabled:opacity-90">
            <Panel title="Stages" description="Labels can change. The id stays fixed, so history and reports are never rewritten.">
              <ul className="divide-y divide-border/70">
                {STAGES.map((s) => (
                  <li key={s.id} className="grid items-center gap-2 py-2 sm:grid-cols-[10rem_1fr_auto] first:pt-0 last:pb-0">
                    <code className="text-xs text-muted-foreground">{s.id}</code>
                    <Input aria-label={`Label for ${s.id}`} value={labels[s.id]} onChange={(e) => setLabels({ ...labels, [s.id]: e.target.value })} />
                    <Chip>{s.open ? "Open stage" : "Closed"}</Chip>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Allowed stage moves" description="Controlled by the system. Won and lost always need evidence or a reason.">
              <ul className="space-y-1.5 text-sm">
                {[...PIPELINE_STAGES, "on_hold" as const].map((s) => <li key={s}><strong>{stageLabel(s)}</strong> <span className="text-muted-foreground">can move to</span> {allowedMoves(s).map(stageLabel).join(", ")}, or be won or lost with confirmation.</li>)}
              </ul>
            </Panel>
            <Panel title="Follow-up rules" description="No deadline is built in. Enter the targets the business agrees.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First-response target (working hours)" htmlFor="s-first" hint="Left blank until agreed."><Input id="s-first" inputMode="numeric" placeholder="Not set" /></Field>
                <Field label="Default days to next follow-up" htmlFor="s-days" hint="Left blank until agreed."><Input id="s-days" inputMode="numeric" placeholder="Not set" /></Field>
                <Field label="Reminder before due (hours)" htmlFor="s-rem"><Input id="s-rem" inputMode="numeric" placeholder="Not set" /></Field>
                <Field label="Escalate after overdue (days) and to whom" htmlFor="s-esc"><Input id="s-esc" placeholder="Not set" /></Field>
              </div>
            </Panel>
            <Panel title="Working hours and calendar" description="Deadlines use this, not the event's country or someone's browser.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sales operating timezone" htmlFor="s-tz" required><Select id="s-tz" defaultValue="Asia/Dubai"><option value="Asia/Dubai">Asia/Dubai (GST, UTC+4) · sample value</option><option>Asia/Riyadh</option><option>Europe/Berlin</option></Select></Field>
                <Field label="Working days and hours" htmlFor="s-wh"><Input id="s-wh" placeholder="Not set" /></Field>
                <div className="sm:col-span-2"><Field label="Holiday calendar" htmlFor="s-hol" hint="Per owning company when decided."><Input id="s-hol" placeholder="Not set" /></Field></div>
              </div>
            </Panel>
            <Panel title="Lists">
              {[{ t: "Sources", v: [...SOURCES] }, { t: "Lost reasons", v: [...LOST_REASONS] }, { t: "On-hold reasons", v: [...HOLD_REASONS] }].map((l) => (
                <div key={l.t} className="mb-4 last:mb-0"><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{l.t}</h3><div className="flex flex-wrap gap-1.5">{l.v.map((x) => <Chip key={x}>{x}</Chip>)}</div></div>
              ))}
              <p className="text-xs text-muted-foreground">Starting lists, proposed for review. Retiring an item hides it from new records; old records keep it.</p>
            </Panel>
            <Panel title="Internal commercial approval" description="Off until the business supplies the rule.">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" /> Require internal approval before a proposal or quote is sent</label>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">{["AED", "SAR", "EUR"].map((c) => <Field key={c} label={`Approval needed above (${c})`} htmlFor={`s-th-${c}`}><Input id={`s-th-${c}`} placeholder="Not set" /></Field>)}</div>
              <p className="mt-3 text-sm">Who can approve: <Unset /></p>
            </Panel>
            <Panel title="Notifications" description="A failed email never loses the activity it relates to.">
              <div className="space-y-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" /> In-app reminders</label><label className="flex items-center gap-2"><input type="checkbox" /> Email reminders to the owner</label><p className="text-xs text-muted-foreground">No message is ever sent to a client automatically.</p></div>
            </Panel>
          </fieldset>
          <div className="flex items-center gap-3">{can ? <Button type="submit">Save changes</Button> : null}<p className="text-xs text-muted-foreground">Every change is recorded below with who made it and when.</p></div>
        </form>
        <Panel title="Change history" className="mt-6" flush>
          <ol className="divide-y divide-border/70">{SETTINGS_HISTORY.map((h) => <li key={h.at} className="px-4 py-3 text-sm"><p>{h.what}</p><p className="text-xs text-muted-foreground">{personName(h.by)} · {fmtDateTime(h.at)}</p></li>)}</ol>
        </Panel>
      </StateGate>
      {node}
    </>
  );
}
