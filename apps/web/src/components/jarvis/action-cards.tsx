"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { ActionCard, ActionConfirmResult, ConfirmationView, EnquiryStageCard, EnquiryUpdateCard, HelpAnswerCard, MeetingCard, MeetingValues, OrgRegisterCard, OrgRole, OrgValues, ReplyDraftCard, SendResult, StatusResult, UpdateForm } from "@/lib/jarvis/protocol";

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
    case "meeting.record": return <MeetingView {...p} card={p.state.card} confirmation={p.state.confirmation} />;
    case "enquiry.stage": return <StageView {...p} card={p.state.card} confirmation={p.state.confirmation} />;
    case "enquiry.update": return <UpdateView {...p} card={p.state.card} confirmation={p.state.confirmation} />;
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


/** Update an enquiry: each change as before -> after, the allowlisted fields editable, and the ONE button that saves them. The record's version is bound to the review. */
function UpdateView(p: ActionCardProps & { card: EnquiryUpdateCard; confirmation: ConfirmationView | null }) {
  const { card, confirmation } = p;
  const [draft, setDraft] = useState<UpdateForm>(card.proposed);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = usePropose(p);
  const dirty = !same(draft, card.proposed);
  const canSave = card.valid && !!confirmation && !dirty && !p.companyStale;
  const set = <K extends keyof UpdateForm>(k: K, v: UpdateForm[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const err = (f: string) => card.problems.find((x) => x.field === f)?.message;
  const key = card.enquiry.id.slice(0, 8);
  const now = (label: string, v: string) => (card.changes.some((c) => c.label === label) ? <p className="text-[11px] text-muted-foreground">Now: {v}</p> : null);
  const cur = card.current;
  const line = (id: string, label: string, control: React.ReactNode, problem?: string) => (
    <div className="space-y-1">
      <label htmlFor={`${key}-${id}`} className="text-xs font-medium text-muted-foreground">{label}</label>
      {control}
      {problem ? <p className="text-xs text-destructive" data-testid={`problem-${id}`}>{problem}</p> : null}
    </div>
  );
  const text = (id: keyof UpdateForm & string, label: string, type = "text", max = 200) => line(id, label, <Input id={`${key}-${id}`} type={type} maxLength={max} value={String(draft[id] ?? "")} disabled={busy || saved} onChange={(e) => set(id, (e.target.value === "" ? (id === "title" ? "" : null) : e.target.value) as never)} />, err(id));
  if (p.companyStale && !saved) return <Alert variant="warning">The company changed after this review, so it can no longer be used. Ask again for the new company.</Alert>;
  return (
    <section aria-label="Review the changes" className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-update-card">
      <header className="space-y-1">
        <h3 className="font-heading text-sm font-semibold">Review before anything is saved</h3>
        <p className="text-xs text-muted-foreground">Changes to <Link href={`/sales/opportunities/${card.enquiry.id}`} className="font-medium text-foreground underline underline-offset-2">{card.enquiry.reference}</Link> · {card.enquiry.title} · {card.enquiry.stageLabel}. Only the fields below can be changed through JARVIS. Nothing is saved until you press Save changes.</p>
      </header>
      {card.changes.length > 0 ? (
        <table className="w-full text-xs" data-testid="update-changes">
          <caption className="sr-only">What will change</caption>
          <thead><tr className="text-left text-muted-foreground"><th className="pb-1 font-medium">Field</th><th className="pb-1 font-medium">Now</th><th className="pb-1 font-medium">After</th></tr></thead>
          <tbody>{card.changes.map((c) => <tr key={c.field} data-testid={`change-${c.field}`} className="border-t border-border align-top"><td className="py-1 pr-2 font-medium">{c.label}</td><td className="py-1 pr-2 text-muted-foreground">{c.before}</td><td className="py-1">{c.after}</td></tr>)}</tbody>
        </table>
      ) : <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs" data-testid="update-nothing">Nothing would change yet. Edit a field below, or say what to change.</p>}
      <details className="rounded-md border border-border p-2" open={card.changes.length === 0 || undefined}>
        <summary className="cursor-pointer text-xs font-medium">Edit the fields</summary>
        <div className="mt-3 space-y-3">
          {text("title", "Title")}{now("Title", cur.title)}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {text("eventStart", "Event start", "date")}{text("eventEnd", "Event end", "date")}{text("installStart", "Installation", "date")}
          </div>
          {text("location", "Location")}
          {text("budgetNote", "Budget note", "text", 1000)}
          {line("waitingOn", "Waiting on", (
            <Select id={`${key}-waitingOn`} value={draft.waitingOn ?? ""} disabled={busy || saved} onChange={(e) => set("waitingOn", (e.target.value || null) as UpdateForm["waitingOn"])}>
              <option value="">Nobody</option><option value="client">The client</option><option value="internal">Our own team</option>
            </Select>))}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Technologies requested</legend>
            {draft.technologies.map((t, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-2">
                <Input aria-label={`Technology ${i + 1} name`} value={t.name} maxLength={120} disabled={busy || saved} onChange={(e) => set("technologies", draft.technologies.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <Input aria-label={`Technology ${i + 1} quantity`} type="number" min={1} value={t.qty} disabled={busy || saved} onChange={(e) => set("technologies", draft.technologies.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x)))} />
                <Button type="button" size="sm" variant="ghost" disabled={busy || saved} aria-label={`Remove technology ${i + 1}`} onClick={() => set("technologies", draft.technologies.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
            {draft.technologies.length < 20 ? <Button type="button" size="sm" variant="outline" disabled={busy || saved} onClick={() => set("technologies", [...draft.technologies, { name: "", qty: 1 }])}>Add a technology</Button> : null}
            {err("technologies") ? <p className="text-xs text-destructive">{err("technologies")}</p> : null}
          </fieldset>
          {line("scope", "Scope", <Textarea id={`${key}-scope`} rows={2} maxLength={4000} value={draft.scope ?? ""} disabled={busy || saved} onChange={(e) => set("scope", e.target.value || null)} />)}
          {line("brief", "Brief", <Textarea id={`${key}-brief`} rows={3} maxLength={4000} value={draft.brief ?? ""} disabled={busy || saved} onChange={(e) => set("brief", e.target.value || null)} />)}
        </div>
      </details>
      {card.problems.length > 0 && !dirty ? <p className="text-xs text-muted-foreground" data-testid="card-missing">{card.problems.map((x) => x.message.replace(/\.$/, "")).join("; ")}.</p> : null}
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      {!saved ? (
        <div className="flex flex-wrap items-center gap-2">
          {dirty || !card.valid || !confirmation ? <Button type="button" variant="secondary" size="sm" disabled={busy || (!dirty && card.valid && !!confirmation)} onClick={() => void run({ mode: "revise", enquiryId: card.enquiry.id, fields: draft })}>{busy ? "Reviewing…" : "Review changes"}</Button> : null}
          {dirty ? <span className="text-xs text-muted-foreground">You changed something: review the changes first.</span> : null}
        </div>
      ) : null}
      <SaveBox actionId={p.actionId} companyId={p.companyId} confirmation={confirmation} values={card.values} canSave={canSave} label="Save changes" busyLabel="Saving…" api={p.api} testId="save-update" onSettled={setSaved} />
      {confirmation && card.valid && !dirty && !saved ? <p className="text-[11px] text-muted-foreground">This review is for version {card.enquiry.version} of the enquiry. If anyone changes it first you will be asked to review again. Valid until {new Date(confirmation.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p> : null}
    </section>
  );
}


/** Change status: current and proposed stage, the evidence the stage needs, what changes, and the ONE button that moves it. Disabled moves say why. */
function StageView(p: ActionCardProps & { card: EnquiryStageCard; confirmation: ConfirmationView | null }) {
  const { card, confirmation } = p;
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = usePropose(p);
  const canSave = card.valid && !!confirmation && !p.companyStale;
  if (p.companyStale && !saved) return <Alert variant="warning">The company changed after this review, so it can no longer be used. Ask again for the new company.</Alert>;
  return (
    <section aria-label="Review the stage change" className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-stage-card">
      <header className="space-y-1">
        <h3 className="font-heading text-sm font-semibold">Review before the stage changes</h3>
        <p className="text-xs text-muted-foreground"><Link href={`/sales/opportunities/${card.enquiry.id}`} className="font-medium text-foreground underline underline-offset-2">{card.enquiry.reference}</Link> · {card.enquiry.title}. Nothing moves until you press Move.</p>
      </header>
      <p className="flex flex-wrap items-center gap-2" data-testid="stage-from-to">
        <span className="rounded-md border border-border bg-field px-2 py-1 font-medium">{card.fromLabel}</span>
        <span aria-hidden>→</span>
        {card.toLabel ? <span className="rounded-md border border-border bg-field px-2 py-1 font-medium">{card.toLabel}</span> : <span className="text-muted-foreground">choose a stage below</span>}
      </p>
      <div className="space-y-1" role="group" aria-label="Stages you can move to">
        <p className="text-xs font-medium">One step at a time:</p>
        <ul className="space-y-1">
          {card.transitions.map((t) => (
            <li key={t.to} className="flex flex-wrap items-start gap-2 text-xs" data-testid={`transition-${t.to}`} data-enabled={t.enabled}>
              <Button type="button" size="sm" variant={card.to === t.to ? "secondary" : "outline"} disabled={!t.enabled || busy || saved} aria-pressed={card.to === t.to}
                onClick={() => void run({ mode: "propose", enquiryId: card.enquiry.id, to: t.to })}>{t.direction === "back" ? "Back to " : "Forward to "}{t.toLabel}</Button>
              {!t.enabled && t.reason ? <span className="min-w-0 flex-1 pt-1 text-muted-foreground">{t.reason}</span> : null}
            </li>
          ))}
        </ul>
      </div>
      {card.evidence.length > 0 ? (
        <ul className="space-y-1 text-xs" data-testid="stage-evidence">
          {card.evidence.map((e) => <li key={e.label}><strong>{e.label}:</strong> <span className={e.met === false ? "text-destructive" : "text-muted-foreground"}>{e.text}</span></li>)}
        </ul>
      ) : null}
      {card.problems.length > 0 ? <p className="text-xs text-muted-foreground" data-testid="card-missing">{card.problems.map((x) => x.message).join(" ")}</p> : null}
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground" data-testid="stage-effects">{card.effects.map((x) => <li key={x}>{x}</li>)}</ul>
      <p className="text-[11px] text-muted-foreground">Won, Lost, On hold, reopening and handover are not available through JARVIS: use the buttons on the enquiry page.</p>
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      <SaveBox actionId={p.actionId} companyId={p.companyId} confirmation={confirmation} values={card.values} canSave={canSave} label={card.toLabel ? `Move to ${card.toLabel}` : "Move"} busyLabel="Moving…" api={p.api} testId="save-stage" onSettled={setSaved} />
      {confirmation && card.valid && !saved ? <p className="text-[11px] text-muted-foreground">This review is for version {card.enquiry.version}. If anyone changes the enquiry first you will be asked to review again.</p> : null}
    </section>
  );
}


const ACTIVITY_OPTIONS = [["meeting", "Meeting"], ["call", "Call"], ["email", "Email"], ["note", "Note"], ["client_response", "Client response"]] as const;
const FOLLOW_UP_OPTIONS = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["proposal", "Proposal work"], ["other", "Other"]] as const;

/** Meeting notes: ONE proposed activity and ONE follow-up for you, saved together by the one button (both or neither). The date is asked for, never guessed. */
function MeetingView(p: ActionCardProps & { card: MeetingCard; confirmation: ConfirmationView | null }) {
  const { card, confirmation } = p;
  const [draft, setDraft] = useState<MeetingValues>(card.values);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = usePropose(p);
  const dirty = !same(draft, card.values);
  const canSave = card.valid && !!confirmation && !dirty && !p.companyStale;
  const set = <K extends keyof MeetingValues>(k: K, v: MeetingValues[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const err = (f: string) => card.problems.find((x) => x.field === f)?.message;
  const key = card.enquiry.id.slice(0, 8);
  const off = busy || saved;
  const line = (id: string, label: string, control: React.ReactNode) => (
    <div className="space-y-1"><label htmlFor={`${key}-${id}`} className="text-xs font-medium text-muted-foreground">{label}</label>{control}{err(id) ? <p className="text-xs text-destructive" data-testid={`problem-${id}`}>{err(id)}</p> : null}</div>
  );
  if (p.companyStale && !saved) return <Alert variant="warning">The company changed after this review, so it can no longer be used. Ask again for the new company.</Alert>;
  return (
    <section aria-label="Review the meeting record" className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-meeting-card">
      <header className="space-y-1">
        <h3 className="font-heading text-sm font-semibold">Review before anything is saved</h3>
        <p className="text-xs text-muted-foreground">For <Link href={`/sales/opportunities/${card.enquiry.id}`} className="font-medium text-foreground underline underline-offset-2">{card.enquiry.reference}</Link> · {card.enquiry.title} · {card.enquiry.stageLabel}. The update and the follow-up are saved together when you press Save, or not at all.</p>
      </header>
      {card.questions.length > 0 ? (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2" data-testid="card-questions">
          <p className="text-xs font-medium">JARVIS needs your answer:</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">{card.questions.map((q) => <li key={q.field}>{q.text}</li>)}</ul>
        </div>
      ) : null}
      <fieldset className="space-y-3 rounded-md border border-border p-2">
        <legend className="px-1 text-xs font-semibold">Update on the timeline</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {line("kind", "Type", <Select id={`${key}-kind`} value={draft.kind} disabled={off} onChange={(e) => set("kind", e.target.value as MeetingValues["kind"])}>{ACTIVITY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>)}
          {line("occurredOn", "Happened on (optional, today if empty)", <Input id={`${key}-occurredOn`} type="date" value={draft.occurredOn ?? ""} disabled={off} onChange={(e) => set("occurredOn", e.target.value || null)} />)}
        </div>
        {line("body", "What happened", <Textarea id={`${key}-body`} rows={5} maxLength={4000} value={draft.body} disabled={off} onChange={(e) => set("body", e.target.value)} />)}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.internal} disabled={off} onChange={(e) => set("internal", e.target.checked)} />Internal note (still visible to everyone with Sales access to the company)</label>
      </fieldset>
      <fieldset className="space-y-3 rounded-md border border-border p-2">
        <legend className="px-1 text-xs font-semibold">Follow-up for you</legend>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.planFollowUp} disabled={off} onChange={(e) => set("planFollowUp", e.target.checked)} data-testid="plan-follow-up" />Plan the next step</label>
        {err("planFollowUp") ? <p className="text-xs text-destructive" data-testid="problem-planFollowUp">{err("planFollowUp")}</p> : null}
        {draft.planFollowUp ? (
          <>
            {line("followUpTitle", "What to do", <Input id={`${key}-followUpTitle`} value={draft.followUpTitle} maxLength={300} disabled={off} onChange={(e) => set("followUpTitle", e.target.value)} />)}
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)]">
              {line("followUpDate", "Due", <Input id={`${key}-followUpDate`} type="date" value={draft.followUpDate} disabled={off} onChange={(e) => set("followUpDate", e.target.value)} />)}
              {line("followUpTime", "Time (Dubai)", <Input id={`${key}-followUpTime`} type="time" value={draft.followUpTime} disabled={off} onChange={(e) => set("followUpTime", e.target.value)} />)}
              {line("followUpKind", "Type", <Select id={`${key}-followUpKind`} value={draft.followUpKind} disabled={off} onChange={(e) => set("followUpKind", e.target.value as MeetingValues["followUpKind"])}>{FOLLOW_UP_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>)}
            </div>
            <p className="text-xs text-muted-foreground">The follow-up is on your list. To give it to someone else, use Add follow-up on the enquiry.</p>
          </>
        ) : null}
      </fieldset>
      {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
      {!saved ? (
        <div className="flex flex-wrap items-center gap-2">
          {dirty || !card.valid || !confirmation ? <Button type="button" variant="secondary" size="sm" disabled={busy || (!dirty && card.valid && !!confirmation)} onClick={() => void run({ mode: "revise", enquiryId: card.enquiry.id, fields: draft })}>{busy ? "Reviewing…" : "Review changes"}</Button> : null}
          {dirty ? <span className="text-xs text-muted-foreground">You changed something: review the changes first.</span> : null}
        </div>
      ) : null}
      <SaveBox actionId={p.actionId} companyId={p.companyId} confirmation={confirmation} values={card.values} canSave={canSave} label={card.values.planFollowUp ? "Save update and follow-up" : "Save update"} busyLabel="Saving…" api={p.api} testId="save-meeting" onSettled={setSaved} />
    </section>
  );
}
