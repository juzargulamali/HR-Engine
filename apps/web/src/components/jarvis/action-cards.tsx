"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionCard, ActionConfirmResult, ConfirmationView, HelpAnswerCard, OrgRegisterCard, OrgRole, OrgValues, ReplyDraftCard, SendResult, StatusResult } from "@/lib/jarvis/protocol";

/** What the cards of the other actions call. Each is a server action that re-authorises the person on every call; this file decides nothing about access. */
export interface ActionApi {
  act: (a: { companyId: string; actionId: string; input: unknown }) => Promise<SendResult>;
  confirmAction: (a: { companyId: string; actionId: string; token: string; values: unknown; acknowledgements?: Record<string, unknown> }) => Promise<ActionConfirmResult>;
  status: (confirmationId: string) => Promise<StatusResult>;
}

export interface ActionCardState { card: ActionCard; confirmation: ConfirmationView | null }

export interface ActionCardProps {
  actionId: string;
  state: ActionCardState;
  /** The company the person has selected NOW differs from the one this card was made for: it can no longer be used. */
  companyStale: boolean;
  companyId: string;
  api: ActionApi;
  onState: (s: ActionCardState) => void;
}

export function ActionCardView(p: ActionCardProps) {
  switch (p.state.card.kind) {
    case "reply.draft": return <ReplyDraftView card={p.state.card} companyStale={p.companyStale} />;
    case "help.answer": return <HelpAnswerView card={p.state.card} />;
    case "org.register": return <OrgRegisterView {...p} card={p.state.card} confirmation={p.state.confirmation} />;
    default: return null;
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type SavePhase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "checking"; confirmationId: string; tries: number; message: string; settled: boolean }
  | { kind: "done"; reference: string; href: string | null; summary: string; replayed: boolean }
  | { kind: "failed"; message: string };

/**
 * The ONE button that can save, for every card that writes, and what follows it: the real reference and a link only after the app confirms the save; an unknown answer shows
 * "Checking the original result" (a read-only look at the ledger by confirmation id) and never offers a second save; a refusal is shown in words and the card can be reviewed again.
 */
function SaveBox(p: { actionId: string; companyId: string; confirmation: ConfirmationView | null; values: unknown; acknowledgements?: Record<string, unknown>; canSave: boolean; label: string; busyLabel: string; api: ActionApi; testId: string; onSettled?: (open: boolean) => void }) {
  const [phase, setPhase] = useState<SavePhase>({ kind: "idle" });
  const lock = useRef(false);
  const { api } = p;

  async function save() {
    if (lock.current || !p.canSave || !p.confirmation) return; // a double click is ignored here, and the database makes a repeat safe anyway
    lock.current = true;
    setPhase({ kind: "saving" });
    let r: ActionConfirmResult;
    try { r = await api.confirmAction({ companyId: p.companyId, actionId: p.actionId, token: p.confirmation.token, values: p.values, acknowledgements: p.acknowledgements }); }
    catch { r = { ok: false, code: "ambiguous", message: "We did not get an answer to the save. Checking the original result: nothing will be saved twice.", confirmationId: p.confirmation.id }; }
    if (r.ok) { setPhase({ kind: "done", reference: r.reference, href: r.href, summary: r.summary, replayed: r.replayed }); return; }
    if (r.code === "ambiguous") { setPhase({ kind: "checking", confirmationId: r.confirmationId ?? p.confirmation.id, tries: 0, message: r.message, settled: false }); return; }
    lock.current = false;
    setPhase({ kind: "failed", message: r.message });
  }

  useEffect(() => {
    if (phase.kind !== "checking" || phase.settled) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const s = await api.status(phase.confirmationId).catch(() => null);
      if (cancelled) return;
      if (s && s.ok && s.state === "done") setPhase({ kind: "done", reference: s.reference, href: s.href, summary: s.summary ?? "Saved.", replayed: true });
      else if (s && s.ok && s.state === "failed") { lock.current = false; setPhase({ kind: "failed", message: s.message }); }
      else setPhase((q) => (q.kind === "checking" ? { ...q, tries: q.tries + 1, settled: q.tries + 1 >= 4 } : q));
    }, phase.tries === 0 ? 400 : 2000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [phase, api]);
  const finished = phase.kind === "done" || phase.kind === "checking";
  useEffect(() => { p.onSettled?.(finished); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (phase.kind === "done") {
    return (
      <div className="space-y-2 rounded-lg border border-success/40 bg-success/10 p-3" data-testid="jarvis-result">
        <p className="font-medium text-success">{phase.summary}</p>
        {phase.replayed ? <p className="text-muted-foreground">This had already been saved; nothing was saved twice.</p> : null}
        {phase.href ? <Link href={phase.href} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:brightness-110">Open {phase.reference}</Link> : null}
      </div>
    );
  }
  if (phase.kind === "checking") {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3" role="status" data-testid="jarvis-checking">
        <p className="font-medium">Checking the original result</p>
        <p className="text-muted-foreground">{phase.message}</p>
        {phase.settled ? (
          <>
            <p className="text-muted-foreground">No save has been recorded yet. It may still be arriving. Check again in a moment; nothing will be saved a second time.</p>
            <Button size="sm" variant="outline" onClick={() => setPhase({ ...phase, tries: 0, settled: false })}>Check again</Button>
          </>
        ) : <p className="text-muted-foreground">One moment…</p>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {phase.kind === "failed" ? <Alert variant="destructive" role="alert" data-testid="card-failed">{phase.message}</Alert> : null}
      <Button type="button" size="sm" onClick={() => void save()} disabled={!p.canSave || phase.kind === "saving"} aria-disabled={!p.canSave} data-testid={p.testId}>{phase.kind === "saving" ? p.busyLabel : p.label}</Button>
    </div>
  );
}

/** Ask the server to propose again (search, choose, revise) and show the new card; a refusal is shown in words. */
function usePropose(p: ActionCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(input: unknown) {
    if (busy) return;
    setBusy(true); setError(null);
    const r = await p.api.act({ companyId: p.companyId, actionId: p.actionId, input }).catch(() => null);
    setBusy(false);
    if (r && r.ok && r.kind === "action") p.onState({ card: r.card, confirmation: r.confirmation });
    else setError(r && !r.ok ? r.message : "JARVIS could not do that. Sales & CRM is not affected.");
  }
  return { busy, error, run };
}

/** Register a client or agency: search first, then (a separate step) the exact type and details with their own confirmation. */
function OrgRegisterView(p: ActionCardProps & { card: OrgRegisterCard; confirmation: ConfirmationView | null }) {
  const { card, confirmation } = p;
  const [draft, setDraft] = useState<OrgValues>(card.values);
  const [ack, setAck] = useState(false);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = usePropose(p);
  const dirty = !same(draft, card.values);
  const binding = card.matches.filter((m) => m.binding);
  const ackOk = binding.length === 0 || ack;
  const set = <K extends keyof OrgValues>(k: K, v: OrgValues[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const err = (f: string) => card.problems.find((x) => x.field === f)?.message;
  const toggleRole = (r: OrgRole) => set("roles", draft.roles.includes(r) ? draft.roles.filter((x) => x !== r) : [...draft.roles, r]);
  const roleLabel = (id: string) => card.roleOptions.find((r) => r.id === id)?.label ?? id;
  const matchList = card.matches.length > 0 ? (
    <ul className="space-y-1.5" data-testid="org-matches">
      {card.matches.map((m) => (
        <li key={m.id} className="rounded-md border border-border bg-field px-2 py-1.5 text-xs" data-testid={`org-match-${m.id}`}>
          <Link href={`/sales/accounts/${m.id}?company=${card.company.id}`} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">{m.name}</Link>{" "}
          <span className="text-muted-foreground">{[m.roles.map(roleLabel).join(", "), m.place, m.country, m.website].filter(Boolean).join(" · ")} ({m.reasons.join(", ")})</span>
        </li>
      ))}
    </ul>
  ) : null;

  if (p.companyStale && !saved) return <Alert variant="warning">The company changed after this review, so it can no longer be used. Ask again for the new company.</Alert>;

  if (card.stage === "search") {
    return (
      <section aria-label="Register a client or agency" className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-org-card" data-stage="search">
        <header className="space-y-1">
          <h3 className="font-heading text-sm font-semibold">Register a client or agency</h3>
          <p className="text-xs text-muted-foreground">Looking for <strong className="text-foreground">{card.query}</strong> in Clients &amp; Agencies. Nothing is added unless you choose to.</p>
        </header>
        {card.matches.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Already recorded (use one of these, or register a new one below):</p>
            {matchList}
          </div>
        ) : <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs" data-testid="org-none">No organisation with that name or a similar one is recorded.</p>}
        {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
        <Button type="button" size="sm" variant={card.matches.length > 0 ? "outline" : "default"} disabled={busy} onClick={() => void run({ mode: "details", name: card.query })} data-testid="org-new">
          {busy ? "One moment…" : `Register “${card.query}” as a new organisation`}
        </Button>
      </section>
    );
  }

  const canSave = card.valid && !!confirmation && !dirty && ackOk && !p.companyStale;
  const field = (id: string, label: string, control: React.ReactNode, hint?: string) => (
    <div className="space-y-1">
      <label htmlFor={`${id}`} className="text-xs font-medium text-muted-foreground">{label}</label>
      {control}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {err(id.split("-").pop()!) ? <p className="text-xs text-destructive" data-testid={`problem-${id.split("-").pop()}`}>{err(id.split("-").pop()!)}</p> : null}
    </div>
  );
  const key = card.company.id.slice(0, 8);
  return (
    <section aria-label="Confirm the new organisation" className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-org-card" data-stage="details">
      <header className="space-y-1">
        <h3 className="font-heading text-sm font-semibold">Confirm the type and details</h3>
        <p className="text-xs text-muted-foreground">A new organisation for <strong className="text-foreground">{card.company.name}</strong>. JARVIS sets no account owner, lead source or contacts. Nothing is added until you press Register.</p>
      </header>
      {binding.length > 0 ? (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="org-duplicates">
          <p className="font-medium">An organisation with the same name or website already exists:</p>
          {matchList}
          <label className="flex items-start gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" data-testid="ack-org" /><span>These are different organisations. Register a new one anyway.</span></label>
        </div>
      ) : card.matches.length > 0 ? <div className="space-y-1"><p className="text-xs font-medium">Similar names (not the same):</p>{matchList}</div> : null}
      <div className="space-y-3">
        {field(`${key}-name`, "Name", <Input id={`${key}-name`} value={draft.name} maxLength={200} onChange={(e) => set("name", e.target.value)} disabled={busy} />)}
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground">What kind of organisation is it?</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {card.roleOptions.map((r) => (
              <label key={r.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={draft.roles.includes(r.id)} onChange={() => toggleRole(r.id)} disabled={busy} data-testid={`role-${r.id}`} />{r.label}</label>
            ))}
          </div>
          {err("roles") ? <p className="text-xs text-destructive" data-testid="problem-roles">{err("roles")}</p> : null}
        </fieldset>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field(`${key}-country`, "Country (optional)", <Input id={`${key}-country`} value={draft.country ?? ""} maxLength={80} onChange={(e) => set("country", e.target.value || null)} disabled={busy} placeholder="e.g. UAE" />)}
          {field(`${key}-place`, "City or place (optional)", <Input id={`${key}-place`} value={draft.place ?? ""} maxLength={200} onChange={(e) => set("place", e.target.value || null)} disabled={busy} />)}
        </div>
        {field(`${key}-website`, "Website (optional)", <Input id={`${key}-website`} value={draft.website ?? ""} maxLength={300} onChange={(e) => set("website", e.target.value || null)} disabled={busy} />)}
        {field(`${key}-note`, "Note (optional)", <Textarea id={`${key}-note`} rows={2} maxLength={2000} value={draft.note ?? ""} onChange={(e) => set("note", e.target.value || null)} disabled={busy} />)}
      </div>
      {card.problems.length > 0 && !dirty ? <p className="text-xs text-muted-foreground" data-testid="card-missing">Still needed before you can register it: {card.problems.map((x) => x.message.replace(/\.$/, "")).join("; ")}.</p> : null}
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      {!saved ? (
        <div className="flex flex-wrap items-center gap-2">
          {dirty || !card.valid || !confirmation ? <Button type="button" variant="secondary" size="sm" disabled={busy || (!dirty && card.valid && !!confirmation)} onClick={() => void run({ mode: "details", fields: draft })}>{busy ? "Reviewing…" : "Review changes"}</Button> : null}
          {dirty ? <span className="text-xs text-muted-foreground">You changed something: review the changes first.</span> : null}
        </div>
      ) : null}
      <SaveBox actionId={p.actionId} companyId={p.companyId} confirmation={confirmation} values={card.values} acknowledgements={{ matchIds: ack ? binding.map((m) => m.id) : [] }} canSave={canSave} label="Register organisation" busyLabel="Registering…" api={p.api} testId="register-organisation" onSettled={setSaved} />
      {confirmation && card.valid && !dirty && !saved ? <p className="text-[11px] text-muted-foreground">This review is valid until {new Date(confirmation.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p> : null}
    </section>
  );
}

/** An answer from reviewed guidance, with links to the real screens. Reads and writes nothing. */
function HelpAnswerView({ card }: { card: HelpAnswerCard }) {
  return (
    <section aria-label="Answer" className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-help-card" data-mode={card.mode}>
      {card.answer ? <p className="whitespace-pre-wrap" data-testid="help-general-answer">{card.answer}</p> : null}
      {card.entries.map((e) => (
        <div key={e.id} className="space-y-1" data-testid={`help-entry-${e.id}`}>
          <h3 className="font-heading text-sm font-semibold">{e.title}</h3>
          <p>{e.summary}</p>
          {e.steps.length > 0 ? <ol className="list-decimal space-y-0.5 pl-5 text-xs">{e.steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : null}
          {e.links.length > 0 ? <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{e.links.map((l) => <Link key={l.href} href={l.href} className="font-medium underline underline-offset-2">{l.label}</Link>)}</p> : null}
        </div>
      ))}
      {card.topics.length > 0 ? <ul className="list-disc space-y-0.5 pl-5 text-xs" data-testid="help-topics">{card.topics.map((t) => <li key={t.id}>{t.title}</li>)}</ul> : null}
      <p className="text-xs text-muted-foreground">{card.note}</p>
    </section>
  );
}

/** A DRAFT with a copy button. No send button exists, nothing is written, and the "to confirm" list is shown ABOVE the draft. */
function ReplyDraftView({ card, companyStale }: { card: ReplyDraftCard; companyStale: boolean }) {
  const [subject, setSubject] = useState(card.subject);
  const [body, setBody] = useState(card.body);
  const [copied, setCopied] = useState<"idle" | "yes" | "no">("idle");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (copied === "idle") return; const t = setTimeout(() => setCopied("idle"), 2500); return () => clearTimeout(t); }, [copied]);
  async function copy() {
    const text = `Subject: ${subject}\n\n${body}`;
    try { await navigator.clipboard.writeText(text); setCopied("yes"); }
    catch { area.current?.select(); setCopied("no"); }
  }
  return (
    <section aria-label="Draft reply" className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-reply-card">
      <header className="space-y-1">
        <h3 className="font-heading text-sm font-semibold">Draft reply</h3>
        <p className="text-xs text-muted-foreground">For <Link href={`/sales/opportunities/${card.enquiry.id}`} className="font-medium text-foreground underline underline-offset-2">{card.enquiry.reference}</Link> · {card.enquiry.title} · {card.enquiry.stageLabel}. <strong className="text-foreground">This is only a draft: JARVIS has not sent anything and does not send email.</strong></p>
      </header>
      {companyStale ? <Alert variant="warning">The company changed after this draft, so check that it is still the right enquiry before using it.</Alert> : null}
      {card.toConfirm.length > 0 ? (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2" data-testid="reply-to-confirm" role="group" aria-label="To confirm before sending">
          <p className="text-xs font-medium">To confirm before you send it:</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">{card.toConfirm.map((t, i) => <li key={i} data-kind={t.kind}>{t.text}</li>)}</ul>
        </div>
      ) : <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs" data-testid="reply-nothing-to-confirm">No unconfirmed price, date or availability was found in the draft. Read it before you send it: prices and availability are never confirmed by JARVIS.</p>}
      <div className="space-y-1">
        <label htmlFor={`${card.enquiry.id}-subject`} className="text-xs font-medium text-muted-foreground">Subject</label>
        <input id={`${card.enquiry.id}-subject`} value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} className="h-9 w-full rounded-md border border-border bg-field px-3 text-sm" />
        <label htmlFor={`${card.enquiry.id}-body`} className="text-xs font-medium text-muted-foreground">Draft</label>
        <Textarea id={`${card.enquiry.id}-body`} ref={area} rows={10} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} data-testid="reply-body" />
      </div>
      {card.used.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="reply-used">Used as written: {card.used.map((u) => `${u.value} (from ${u.source === "enquiry" ? "the enquiry" : "your text"})`).join("; ")}.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={() => void copy()} data-testid="reply-copy">Copy draft</Button>
        <span role="status" className="text-xs text-muted-foreground">{copied === "yes" ? "Copied. Paste it into your email." : copied === "no" ? "Could not copy automatically: the draft is selected, press Ctrl+C." : ""}</span>
      </div>
    </section>
  );
}
