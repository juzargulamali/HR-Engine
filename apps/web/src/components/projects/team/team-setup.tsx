"use client";

import { useMemo, useState } from "react";
import { setupProjectTeams } from "@/lib/actions/projectsPhase2";
import { accessAdditions, ACCESS_NOTICE, buildSetup, leadLabel, leadOf, SITE_TEAM_NOTE, sameTeam, TEAM_PRESETS, type TeamRow } from "@/lib/projects/teams/model";
import { ActionForm, Field } from "@/components/sales/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormDialog, type Done } from "@/components/projects/delivery/delivery-forms";

export interface LeadOption { id: string; name: string; onProject: boolean }
export interface TeamWithLead extends TeamRow { leadName: string | null }
const key = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Set up (or manage) the project's teams in one go. Presets are reusable; a custom team is for an exception. A lead is optional per team: the team is saved and flagged
 * "Lead needed". Choosing a lead who is not on the project yet says so, in words, before saving, and the database refuses to add anyone until that is confirmed. An existing team
 * is never created twice and its lead is never replaced here (Edit team on People & access changes a lead on purpose). Choosing Site / Installation enrols nobody.
 */
export function TeamSetupDialog({ projectId, teams, leads, label, variant = "default", testId = "team-setup-open" }: {
  projectId: string; teams: TeamWithLead[]; leads: LeadOption[]; label: string; variant?: "default" | "outline"; testId?: string;
}) {
  return (
    <FormDialog label={label} variant={variant} size="default" testId={testId} dialogSize="wide" title={teams.length === 0 ? "Set up your project team" : "Manage project team"}
      description="Choose the teams this project needs. These are teams inside this project, not HR departments. You can save before every lead is known.">
      {(done) => <TeamSetupForm projectId={projectId} teams={teams} leads={leads} done={done} />}
    </FormDialog>
  );
}

function TeamSetupForm({ projectId, teams, leads, done }: { projectId: string; teams: TeamWithLead[]; leads: LeadOption[]; done: (s: Done) => void }) {
  const [presets, setPresets] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = teams;
  const pick = useMemo(() => ({ presets, custom, leads: chosen }), [presets, custom, chosen]);
  const rows = useMemo(() => buildSetup(pick, existing), [pick, existing]);
  const memberIds = useMemo(() => new Set(leads.filter((l) => l.onProject).map((l) => l.id)), [leads]);
  const nameOf = (id: string) => leads.find((l) => l.id === id)?.name ?? "Someone";
  const additions = accessAdditions(rows, memberIds, nameOf);
  // The teams that need a lead choice now: every new team chosen, and every existing team without a lead.
  const working = [
    ...TEAM_PRESETS.filter((p) => presets.includes(p.key) && !existing.some((t) => sameTeam(t.name, p.name))).map((p) => p.name),
    ...custom.filter((c) => !existing.some((t) => sameTeam(t.name, c))),
  ];
  const addCustom = () => {
    const name = draft.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (name.length > 80) return setError("A team name is at most 80 characters.");
    if (existing.some((t) => sameTeam(t.name, name)) || custom.some((c) => sameTeam(c, name)) || TEAM_PRESETS.some((p) => sameTeam(p.name, name) && presets.includes(p.key))) return setError(`${name} is already in the list.`);
    setError(null); setCustom((c) => [...c, name]); setDraft("");
  };
  const leadSelect = (name: string) => (
    <Select id={`ts-lead-${key(name).replace(/[^a-z0-9]+/g, "-")}`} aria-label={leadLabel(name)} value={leadOf(pick, name)} data-testid={`ts-lead-${key(name).replace(/[^a-z0-9]+/g, "-")}`}
      onChange={(e) => setChosen((c) => ({ ...c, [key(name)]: e.target.value }))}>
      <option value="">Lead not known yet</option>
      {leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.onProject ? " (on the project)" : " (will be added to the project)"}</option>)}
    </Select>
  );
  const needsConfirm = additions.length > 0;
  return (
    <ActionForm action={setupProjectTeams} submitLabel="Save team" pendingLabel="Saving…" onDone={(s) => done(s as Done)} disabled={rows.length === 0 || (needsConfirm && !confirmed)}
      secondary={<Button type="button" variant="ghost" onClick={() => done({ error: null } as Done)}>Cancel</Button>}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="teams" value={JSON.stringify(rows)} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Teams this project needs</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {TEAM_PRESETS.map((p) => {
            const have = existing.find((t) => sameTeam(t.name, p.name));
            return (
              <li key={p.key} className="rounded-md border border-border p-2.5">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!have || presets.includes(p.key)} disabled={!!have} data-testid={`ts-preset-${p.key}`}
                    onChange={(e) => setPresets((c) => (e.target.checked ? [...c, p.key] : c.filter((k) => k !== p.key)))} />
                  <span><span className="font-medium">{p.name}</span>{have ? <span className="ml-1 text-muted-foreground">(already on the project)</span> : null}<span className="block text-[13px] text-muted-foreground">{p.hint}</span></span>
                </label>
              </li>
            );
          })}
        </ul>
        {presets.includes("site_installation") || existing.some((t) => t.preset_key === "site_installation") ? <Alert role="note" data-testid="ts-site-note">{SITE_TEAM_NOTE}</Alert> : null}
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="ts-custom" className="text-sm font-medium">Add custom team <span className="font-normal text-muted-foreground">(for an exception, for example Lighting)</span></label>
        <div className="flex gap-2">
          <Input id="ts-custom" value={draft} maxLength={80} onChange={(e) => setDraft(e.target.value)} placeholder="Team name" data-testid="ts-custom-input"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
          <Button type="button" variant="outline" onClick={addCustom} data-testid="ts-custom-add">Add custom team</Button>
        </div>
        {custom.length > 0 ? <ul className="flex flex-wrap gap-1.5" aria-label="Custom teams">{custom.map((c) => <li key={c}><Badge variant="outline">{c} <button type="button" className="ml-1 underline" aria-label={`Remove ${c}`} onClick={() => setCustom((x) => x.filter((n) => n !== c))}>remove</button></Badge></li>)}</ul> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>

      {working.length > 0 || existing.length > 0 ? (
        <fieldset className="space-y-2" data-testid="ts-leads">
          <legend className="text-sm font-medium">Team leads</legend>
          <p className="text-[13px] text-muted-foreground">A lead is optional now. A team without one is saved and shown as Lead needed. Only people with Projects access in this company can lead a team.</p>
          <ul className="space-y-2">
            {existing.map((t) => (
              <li key={t.id} className="grid items-center gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]" data-testid={`ts-existing-${key(t.name).replace(/[^a-z0-9]+/g, "-")}`}>
                <span className="text-sm font-medium">{leadLabel(t.name)}</span>
                {t.head_user_id ? <span className="text-sm">{t.leadName ?? "Lead"} <span className="text-muted-foreground">(set; change it with Edit on People &amp; access)</span></span> : (
                  <span className="flex flex-wrap items-center gap-2">{leadSelect(t.name)}{leadOf(pick, t.name) ? null : <Badge variant="outline" className="border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]">Lead needed</Badge>}</span>
                )}
              </li>
            ))}
            {working.map((name) => (
              <li key={name} className="grid items-center gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                <span className="text-sm font-medium">{leadLabel(name)}</span>
                <span className="flex flex-wrap items-center gap-2">{leadSelect(name)}{leadOf(pick, name) ? null : <Badge variant="outline" className="border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]">Lead needed</Badge>}</span>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {needsConfirm ? (
        <Alert role="note" data-testid="ts-access">
          <p className="font-medium">Project access you are about to give</p>
          <ul className="list-disc pl-5 text-sm">{additions.map((a) => <li key={a.id}>{a.name}</li>)}</ul>
          <p className="text-sm">{ACCESS_NOTICE}</p>
          <label className="mt-1 flex items-start gap-2 text-sm"><input type="checkbox" name="confirmAccess" className="mt-0.5 h-4 w-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="ts-confirm" /> <span>Add {additions.length === 1 ? "this person" : "these people"} to the project</span></label>
        </Alert>
      ) : null}
      {rows.length === 0 ? <p className="text-[13px] text-muted-foreground">Choose a team, add a custom one, or pick a lead for a team that needs one.</p> : null}
    </ActionForm>
  );
}

/** The compact summary on Work once teams exist: each team with its lead (or Lead needed) and how many people it has. */
export function TeamSummary({ teams, counts }: { teams: TeamWithLead[]; counts: Record<string, number> }) {
  return (
    <ul className="flex flex-wrap gap-2" data-testid="team-summary" aria-label="Project teams">
      {teams.map((t) => (
        <li key={t.id} className="rounded-md border border-border px-2.5 py-1.5 text-sm" data-testid={`team-chip-${key(t.name).replace(/[^a-z0-9]+/g, "-")}`}>
          <span className="font-medium">{t.name}</span>
          <span className="text-muted-foreground"> · {counts[t.id] ?? 0} {(counts[t.id] ?? 0) === 1 ? "person" : "people"} · </span>
          {t.head_user_id ? <span>{leadLabelShort(t)}</span> : <Badge variant="outline" className="border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]">Lead needed</Badge>}
        </li>
      ))}
    </ul>
  );
}
const leadLabelShort = (t: TeamWithLead) => `${leadLabel(t.name)}: ${t.leadName ?? "named"}`;
// Field is re-exported so a caller can build a matching label without a second import.
export { Field };
