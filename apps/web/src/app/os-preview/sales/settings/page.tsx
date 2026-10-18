"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { APPROVAL_POLICY, COMPANIES, HOLD_REASONS, LOST_REASONS, PIPELINE_STAGES, SETTINGS_HISTORY, SOURCES, STAGES, allowedMoves, fmtDateTime, personName, stageLabel, type ApprovalPolicy, type CompanyId } from "../../_lib/data";
import { usePreview } from "../../_components/context";
import { Chip, Field, Hint, PageHeader, Panel, Restriction, StateGate, useNotice } from "../../_components/ui";

const POLICY_LABEL: Record<ApprovalPolicy, string> = { not_configured: "Not configured", not_required: "No approval required", required: "Approval required" };

export default function SalesSettings() {
  const { roleDef } = usePreview();
  const founderOnly = roleDef.canConfigureSales;
  const operational = roleDef.canConfigureFollowups;
  const { notify, node } = useNotice();
  const [labels, setLabels] = useState<Record<string, string>>(Object.fromEntries(STAGES.map((s) => [s.id, s.label])));
  const [policy, setPolicy] = useState<Record<CompanyId, ApprovalPolicy>>({ uae: APPROVAL_POLICY.uae.policy, ksa: APPROVAL_POLICY.ksa.policy, eu: APPROVAL_POLICY.eu.policy });
  const save = (what: string) => (e: React.FormEvent) => { e.preventDefault(); notify(`${what} saved and recorded in the history`); };

  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="Sales settings" />
      <StateGate what="Sales settings" emptyTitle="Nothing configured yet" emptyText="Defaults are used until settings are saved.">
        <div className="space-y-6">
          <form noValidate onSubmit={save("Follow-up settings")} className="space-y-6">
            <fieldset disabled={!operational} className="space-y-6">
              <Panel title="Follow-up rules" help="Left blank until the team agrees the targets. Nothing is guessed.">
                {!operational ? <div className="mb-4"><Restriction>You can read these but not change them.</Restriction></div> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First response target (working hours)" htmlFor="s-first"><Input id="s-first" inputMode="numeric" placeholder="Not set" /></Field>
                  <Field label="Default days to next follow-up" htmlFor="s-days"><Input id="s-days" inputMode="numeric" placeholder="Not set" /></Field>
                  <Field label="Reminder before due (hours)" htmlFor="s-rem"><Input id="s-rem" inputMode="numeric" placeholder="Not set" /></Field>
                  <Field label="Escalate after overdue (days)" htmlFor="s-esc"><Input id="s-esc" inputMode="numeric" placeholder="Not set" /></Field>
                </div>
              </Panel>
              <Panel title="Working hours and calendar" help="Deadlines use this timezone, not the event's country or someone's browser.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Sales timezone" htmlFor="s-tz" required><Select id="s-tz" defaultValue="Asia/Dubai"><option value="Asia/Dubai">Dubai time (UTC+4)</option><option>Saudi time (UTC+3)</option><option>Berlin time</option></Select></Field>
                  <Field label="Working days and hours" htmlFor="s-wh"><Input id="s-wh" placeholder="Not set" /></Field>
                  <div className="sm:col-span-2"><Field label="Holiday calendar" htmlFor="s-hol"><Input id="s-hol" placeholder="Not set" /></Field></div>
                </div>
              </Panel>
              <Panel title="Lists">
                {[{ t: "Sources", v: [...SOURCES] }, { t: "Lost reasons", v: [...LOST_REASONS] }, { t: "On-hold reasons", v: [...HOLD_REASONS] }].map((l) => (
                  <div key={l.t} className="mb-4 last:mb-0"><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{l.t}</h3><div className="flex flex-wrap gap-1.5">{l.v.map((x) => <Chip key={x}>{x}</Chip>)}</div></div>
                ))}
              </Panel>
              <Panel title="Reminders">
                <div className="space-y-2 text-sm"><label className="flex items-center gap-2"><input type="checkbox" /> In-app reminders</label><label className="flex items-center gap-2"><input type="checkbox" /> Email reminders to the owner</label><p className="text-xs text-muted-foreground">Nothing is ever sent to a client automatically.</p></div>
              </Panel>
            </fieldset>
            {operational ? <Button type="submit">Save follow-up settings</Button> : null}
          </form>

          <form noValidate onSubmit={save("Approval and stage settings")} className="space-y-6">
            <fieldset disabled={!founderOnly} className="space-y-6">
              <Panel title="Commercial approval" help="Decides whether a proposal or quote needs internal approval before it is sent. Thresholds and approvers are not set; the founders decide them. Only founders can change this.">
                {!founderOnly ? <div className="mb-4"><Restriction>Only the founders can change approval rules. You cannot give yourself approval powers.</Restriction></div> : null}
                <ul className="space-y-3">
                  {(Object.keys(COMPANIES) as CompanyId[]).map((c) => (
                    <li key={c} className="grid items-center gap-2 sm:grid-cols-[16rem_1fr]">
                      <label htmlFor={`pol-${c}`} className="text-sm font-medium">{COMPANIES[c].name.replace(" (sample entity)", "")}</label>
                      <div className="flex flex-wrap items-center gap-2"><Select id={`pol-${c}`} value={policy[c]} onChange={(e) => setPolicy({ ...policy, [c]: e.target.value as ApprovalPolicy })} className="w-60">{(Object.keys(POLICY_LABEL) as ApprovalPolicy[]).map((k) => <option key={k} value={k}>{POLICY_LABEL[k]}</option>)}</Select>
                        {policy[c] === "not_configured" ? <Chip tone="warn">Nobody has decided yet</Chip> : null}</div>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">{["AED", "SAR", "EUR"].map((c) => <Field key={c} label={`Approval needed above (${c})`} htmlFor={`s-th-${c}`}><Input id={`s-th-${c}`} placeholder="Not set" /></Field>)}</div>
                <p className="mt-3 text-sm">Who approves: <span className="text-muted-foreground">Not set. The founders will decide.</span></p>
              </Panel>
              <Panel title="Stages" help="Labels can change. The id stays fixed, so earlier history and reports keep their meaning.">
                <ul className="divide-y divide-border/70">
                  {STAGES.map((s) => (
                    <li key={s.id} className="grid items-center gap-2 py-2 first:pt-0 last:pb-0 sm:grid-cols-[10rem_1fr_auto]">
                      <code className="text-xs text-muted-foreground">{s.id}</code>
                      <Input aria-label={`Label for ${s.id}`} value={labels[s.id]} onChange={(e) => setLabels({ ...labels, [s.id]: e.target.value })} />
                      <Chip>{s.open ? "Open stage" : "Closed"}</Chip>
                    </li>
                  ))}
                </ul>
                <h3 className="mb-1.5 mt-5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Allowed moves <Hint text="Won and lost always need evidence or a reason, so they are not plain moves." /></h3>
                <ul className="space-y-1 text-sm">{[...PIPELINE_STAGES, "on_hold" as const].map((s) => <li key={s}><strong>{stageLabel(s)}</strong> <span className="text-muted-foreground">can move to</span> {allowedMoves(s).map(stageLabel).join(", ")}.</li>)}</ul>
              </Panel>
            </fieldset>
            {founderOnly ? <Button type="submit">Save approval and stage settings</Button> : null}
          </form>

          <Panel title="Change history" flush>
            <ol className="divide-y divide-border/70">{SETTINGS_HISTORY.map((h) => <li key={h.at} className="px-4 py-3 text-sm"><p>{h.what}</p><p className="text-xs text-muted-foreground">{personName(h.by)} · {fmtDateTime(h.at)}</p></li>)}</ol>
          </Panel>
        </div>
      </StateGate>
      {node}
    </>
  );
}
