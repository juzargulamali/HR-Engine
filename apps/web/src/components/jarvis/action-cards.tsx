"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { ActionCard, ActionConfirmResult, ChatReplyCard, ConfirmationView, FollowUpsLookupCard, LookupSection, SalesLookupCard, SalesSummaryCard, ScopeDraftCard, EnquiryStageCard, EnquiryUpdateCard, HelpAnswerCard, MeetingCard, MeetingValues, OrgRegisterCard, OrgRole, OrgValues, ReplyDraftCard, SendResult, StatusResult, UpdateForm } from "@/lib/jarvis/protocol";

/** What the cards of the other actions call. Each is a server action that re-authorises the person on every call; this file decides nothing about access. */
export interface ActionApi {
  act: (a: { companyId: string; actionId: string; input: unknown }) => Promise<SendResult>;
  confirmAction: (a: { companyId: string; actionId: string; token: string; values: unknown; acknowledgements?: Record<string, unknown> }) => Promise<ActionConfirmResult>;
  status: (confirmationId: string) => Promise<StatusResult>;
  /** Sends a suggested correction to a guidance topic for review. */
  suggest?: (a: { topicId: string; text: string }) => Promise<SendResult>;
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
    case "help.answer": return <HelpAnswerView card={p.state.card} api={p.api} companyId={p.companyId} actionId={p.actionId} onState={p.onState} />;
    case "chat.reply": return <ChatReplyView card={p.state.card} />;
    case "lookup.followups": return <FollowUpsView card={p.state.card} />;
    case "lookup.sales": return <SalesLookupView card={p.state.card} api={p.api} companyId={p.companyId} actionId={p.actionId} onState={p.onState} companyStale={p.companyStale} />;
    case "summary.sales": return <SalesSummaryView card={p.state.card} api={p.api} companyId={p.companyId} actionId={p.actionId} onState={p.onState} companyStale={p.companyStale} />;
    case "estimate.scope": return <ScopeDraftView card={p.state.card} />;
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

/** An answer from the published guidance, with links to the real screens. Reads and writes nothing. A correction can be suggested: it goes for review, not into the answer. */
function HelpAnswerView({ card, api, companyId, actionId, onState }: { card: HelpAnswerCard; api: ActionApi; companyId: string; actionId: string; onState: (s: ActionCardState) => void }) {
  const [choosing, setChoosing] = useState(false);
  /** The person picks which guide they meant: the same question goes back with that guide named (no new routing, no provider). */
  async function choose(topicId: string) {
    setChoosing(true);
    const r = await api.act({ companyId, actionId, input: { question: card.question ?? "", topicId } }).catch(() => null);
    setChoosing(false);
    if (r && r.ok && r.kind === "action") onState({ card: r.card, confirmation: r.confirmation });
  }
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "done" | "error"; message: string }>({ kind: "idle" });
  const topicId = card.entries[0]?.id ?? null;
  async function send() {
    if (!api.suggest || !topicId) return;
    setState({ kind: "busy" });
    const r = await api.suggest({ topicId, text }).catch(() => null);
    if (r && r.ok && r.kind === "reply") { setState({ kind: "done", message: r.text }); setOpen(false); setText(""); }
    else setState({ kind: "error", message: r && !r.ok ? r.message : "Could not send your suggestion just now." });
  }
  return (
    <section aria-label="Answer" className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-help-card" data-mode={card.mode}>
      {card.screen ? <p className="text-xs text-muted-foreground" data-testid="help-screen">For the screen you are on: <strong>{card.screen.label}</strong></p> : null}
      {card.mode === "choose" ? <p data-testid="help-choose">{card.note}</p> : null}
      {card.lead ? <p className="font-heading text-sm font-semibold" data-testid="help-lead">{card.lead}</p> : null}
      {card.entries.map((e) => (
        <div key={e.id} className="space-y-1" data-testid={`help-entry-${e.id}`}>
          <h3 className="font-heading text-sm font-semibold">{e.title}</h3>
          <p>{e.summary}</p>
          {e.steps.length > 0 ? <ol className="list-decimal space-y-0.5 pl-5 text-xs">{e.steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : null}
          {e.links.length > 0 ? <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{e.links.map((l) => <Link key={l.href} href={l.href} className="font-medium underline underline-offset-2">{l.label}</Link>)}</p> : null}
        </div>
      ))}
      {card.topics.length > 0 ? <ul className="list-disc space-y-0.5 pl-5 text-xs" data-testid="help-topics">{card.topics.map((t) => <li key={t.id}>{t.title}</li>)}</ul> : null}
      {card.choices && card.choices.length > 0 ? (
        <div className="space-y-1" data-testid="help-choices">
          {card.mode === "guidance" ? <p className="text-xs text-muted-foreground">Also on this screen:</p> : null}
          <div className="flex flex-wrap gap-2">{card.choices.map((c) => <Button key={c.id} type="button" size="sm" variant="outline" disabled={choosing} onClick={() => void choose(c.id)}>{c.title}</Button>)}</div>
        </div>
      ) : null}
      {card.places && card.places.length > 0 ? <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs" data-testid="help-places">{card.places.map((l) => <Link key={l.href} href={l.href} className="font-medium underline underline-offset-2">{l.label}</Link>)}</p> : null}
      {card.mode !== "choose" ? <p className="text-xs text-muted-foreground">{card.note}</p> : null}
      {api.suggest && topicId && state.kind !== "done" ? (
        open ? (
          <div className="space-y-2" data-testid="suggest-form">
            <label htmlFor="jarvis-suggest" className="text-xs font-medium">What should be corrected?</label>
            <Textarea id="jarvis-suggest" rows={2} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={state.kind === "busy" || text.trim().length < 5} onClick={() => void send()} data-testid="suggest-send">Send for review</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        ) : <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={() => setOpen(true)} data-testid="suggest-open">Suggest a correction</button>
      ) : null}
      {state.kind === "done" ? <p className="text-xs" role="status" data-testid="suggest-done">{state.message}</p> : null}
      {state.kind === "error" ? <Alert variant="destructive" role="alert">{state.message}</Alert> : null}
    </section>
  );
}

/** A general answer, or a draft to copy. There is no send button: JARVIS never sends anything. */
function ChatReplyView({ card }: { card: ChatReplyCard }) {
  const [copied, setCopied] = useState<"idle" | "yes" | "no">("idle");
  async function copy() {
    try { await navigator.clipboard.writeText(card.text); setCopied("yes"); } catch { setCopied("no"); }
  }
  return (
    <section aria-label={card.draft ? "Draft" : "Answer"} className="space-y-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm" data-testid="jarvis-chat-reply" data-draft={card.draft ? "yes" : "no"}>
      <p className="whitespace-pre-wrap break-words" data-testid="chat-text">{card.text}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {card.draft ? <Button type="button" size="sm" variant="outline" onClick={() => void copy()} data-testid="chat-copy">{copied === "yes" ? "Copied" : "Copy"}</Button> : null}
        {copied === "no" ? <span>Could not copy: select the text instead.</span> : null}
        {card.draft ? <span>A draft for you to review and send yourself. JARVIS does not send messages.</span> : null}
        {card.applied.length > 0 ? <span data-testid="chat-applied">Your preferences applied: {card.applied.join("; ")}.</span> : null}
      </div>
    </section>
  );
}

/** A live lookup, computed inside Enginious OS: the company, the cutoff and links to the records. An empty list means no matching records (a failed read is shown as an error instead). */
function FollowUpsView({ card }: { card: FollowUpsLookupCard }) {
  return (
    <section aria-label="Overdue follow-ups" className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-lookup" data-period={card.period} data-count={card.total}>
      <h3 className="font-heading text-sm font-semibold">Your overdue Sales follow-ups</h3>
      <p className="text-xs text-muted-foreground" data-testid="lookup-scope">{card.company.name} · assigned to you · still open · {card.periodLabel} · as of {card.cutoffLabel}</p>
      {card.items.length === 0 ? <p data-testid="lookup-empty">No matching follow-ups: nothing assigned to you in {card.company.name} is overdue for these dates.</p> : (
        <ul className="space-y-1.5" data-testid="lookup-items">
          {card.items.map((f) => (
            <li key={f.id} className="rounded-md border border-border px-2 py-1.5">
              <p className={f.hidden ? "text-muted-foreground" : "font-medium"}>{f.title}</p>
              <p className="text-xs text-muted-foreground">{f.kindLabel} · due {f.dueDate} · {f.daysOverdue === 0 ? "overdue today" : `${f.daysOverdue} day${f.daysOverdue === 1 ? "" : "s"} overdue`}</p>
              {f.enquiry ? <Link href={f.enquiry.href} className="text-xs font-medium underline underline-offset-2">{f.enquiry.reference} · {f.enquiry.title}</Link> : null}
            </li>
          ))}
        </ul>
      )}
      {card.truncated ? <p className="text-xs text-muted-foreground">Showing the {card.total} oldest. The Follow-ups page has them all.</p> : null}
      <p className="text-xs"><Link href={card.followUpsHref} className="font-medium underline underline-offset-2">Open Follow-ups</Link> <span className="text-muted-foreground">· Say &quot;show last month instead&quot; to change the dates.</span></p>
    </section>
  );
}

/** Rows of a lookup or a summary: records with links, or label and value pairs of one record. The heading states the exact total next to what is shown. */
function SectionList({ s }: { s: LookupSection }) {
  return (
    <div className="space-y-1" data-testid="lookup-section" data-total={s.total}>
      <p className="text-xs font-semibold">{s.heading}{s.facts ? "" : ` (${s.total})`}</p>
      {s.note ? <p className="text-xs text-muted-foreground">{s.note}</p> : null}
      {s.facts ? (
        <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
          {s.rows.map((r) => <div key={r.id} className="contents"><dt className="text-muted-foreground">{r.primary}</dt><dd className="break-words">{r.secondary}</dd></div>)}
        </dl>
      ) : s.rows.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : (
        <ul className="space-y-1.5">
          {s.rows.map((r) => (
            <li key={r.id} className="rounded-md border border-border px-2 py-1.5">
              {r.href ? <Link href={r.href} className="font-medium underline underline-offset-2 break-words">{r.primary}</Link> : <p className="font-medium break-words">{r.primary}</p>}
              {r.secondary ? <p className="text-xs text-muted-foreground break-words">{r.secondary}</p> : null}
              {r.meta ? <p className="text-xs text-muted-foreground break-words">{r.meta}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {!s.facts && s.total > s.rows.length ? <p className="text-xs text-muted-foreground" data-testid="lookup-more">Showing {s.rows.length} of {s.total}. Open the screen to see them all.</p> : null}
    </div>
  );
}
const CardLinks = ({ links }: { links: { label: string; href: string }[] }) => (links.length === 0 ? null : <p className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-xs" data-testid="card-links">{links.map((l) => <Link key={l.href + l.label} href={l.href} className="font-medium text-primary underline underline-offset-2">{l.label} →</Link>)}</p>);
type ReadCardProps = { api: ActionApi; companyId: string; actionId: string; onState: (s: ActionCardState) => void; companyStale: boolean };
/** Runs the same read action again with another descriptor (a choice, "add AI wording"). The server validates and authorises it like any request; a refusal is shown in words. */
function useRerun(p: ReadCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(input: unknown) {
    if (busy || p.companyStale) return;
    setBusy(true); setError(null);
    let r: SendResult;
    try { r = await p.api.act({ companyId: p.companyId, actionId: p.actionId, input }); } catch { r = { ok: false, code: "unavailable", message: "That could not be loaded just now. Try again in a moment." }; }
    setBusy(false);
    if (r.ok && r.kind === "action") p.onState({ card: r.card, confirmation: r.confirmation }); else if (!r.ok) setError(r.message);
  }
  return { busy, error, run };
}

/** A Sales lookup: computed inside Enginious OS. The result comes first (title and exact count), then one compact line of scope, filters and time; a partial read or a limited scan is said next to the result. */
function SalesLookupView({ card, ...p }: { card: SalesLookupCard } & ReadCardProps) {
  const { busy, error, run } = useRerun(p);
  return (
    <section aria-label={card.title} className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-sales-lookup" data-kind={card.descriptor.kind} data-total={card.total ?? ""}>
      <h3 className="flex flex-wrap items-baseline gap-x-2 font-heading text-sm font-semibold" data-testid="lookup-title">
        <span className="break-words">{card.title}</span>
        {card.total !== null ? <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-semibold" data-testid="lookup-count">{card.total}</span> : null}
      </h3>
      <p className="text-xs text-muted-foreground break-words" data-testid="lookup-scope">{[card.company.name, card.scope, ...card.filters, `as of ${card.asOfLabel}`].filter(Boolean).join(" · ")}</p>
      {p.companyStale ? <Alert variant="destructive">You have selected another company since this was shown. Ask again for the company you want.</Alert> : null}
      {card.unavailable.length > 0 ? <Alert variant="destructive" data-testid="lookup-partial">This answer is incomplete. I could not load: {card.unavailable.join("; ")}. Those parts are missing, not empty.</Alert> : null}
      {card.note ? <p className="rounded-md border border-border bg-secondary/60 px-2 py-1 text-xs" data-testid="lookup-note">{card.note}</p> : null}
      {card.empty ? <p data-testid="lookup-empty">{card.empty}</p> : null}
      {card.choices.length > 0 ? <div className="flex flex-wrap gap-2" data-testid="lookup-choices">{card.choices.map((c) => <Button key={c.label} type="button" size="sm" variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal py-1 text-left" disabled={busy || p.companyStale} onClick={() => void run(c.descriptor)}>{c.label}</Button>)}</div> : null}
      {card.sections.map((s) => <SectionList key={s.heading} s={s} />)}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <CardLinks links={card.links} />
    </section>
  );
}

/** The result of a summary in one line, from the figures the server computed (nothing is calculated here): "5 created · 2 won · 1 lost · 67% won". */
function summaryHeadline(card: SalesSummaryCard): string | null {
  const v = (label: string) => card.metrics.find((m) => m.label === label)?.value;
  const created = v("Enquiries created"), won = v("Won"), lost = v("Lost"), share = v("Share won of those closed (%)");
  const parts = [typeof created === "number" ? `${created} created` : null, typeof won === "number" ? `${won} won` : null, typeof lost === "number" ? `${lost} lost` : null,
    typeof share === "number" ? `${share}% won` : typeof won === "number" && typeof lost === "number" ? "no share won (nothing closed)" : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Coverage notes that say a BREAKDOWN covers only some of the records ("The breakdowns below cover the 2000 newest of the 2600 ...", "The lost reasons below cover 400 of
 * the 520 ..."). They are the server's own coverage lines, shown next to the breakdown they limit so they are seen with "How this is counted" closed; every other
 * coverage line stays in that disclosure. Nothing is calculated here.
 */
const LOST_REASONS_PARTIAL = /^The lost reasons below cover\b/;
const BREAKDOWNS_PARTIAL = /^The breakdowns below cover\b/;
function partialCoverage(card: SalesSummaryCard): { forGroup: (heading: string) => string[]; rest: string[] } {
  const lost = card.coverage.filter((c) => LOST_REASONS_PARTIAL.test(c));
  const breakdowns = card.coverage.filter((c) => BREAKDOWNS_PARTIAL.test(c));
  const shown = new Set<string>();
  const forGroup = (heading: string) => { const notes = heading === "Recorded lost reasons" ? lost : breakdowns; for (const n of notes) shown.add(n); return notes; };
  // A partial note whose breakdown is not on the card (it could not be loaded, or was not asked for) is not hidden: it stays with the other notes.
  for (const g of card.groups) forGroup(g.heading);
  return { forGroup, rest: card.coverage.filter((c) => !shown.has(c)) };
}

/**
 * A factual summary. The result leads (one line of the app's own figures), then the company and period; a partial read stays next to it. Definitions and the notes on how
 * things are counted are one disclosure away ("How this is counted"). "In words" for a period is written by the app; the AI model's suggestions are in their own block.
 */
function SalesSummaryView({ card, ...p }: { card: SalesSummaryCard } & ReadCardProps) {
  const { busy, error, run } = useRerun(p);
  const d = card.descriptor;
  const headline = summaryHeadline(card);
  const partial = partialCoverage(card);
  const canExplain = d.kind === "period" && !card.narrative && !d.narrative;
  const counted = card.metrics.length > 0 || card.groups.length > 0 || partial.rest.length > 0;
  return (
    <section aria-label={card.title} className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-sales-summary" data-kind={d.kind}>
      <h3 className="font-heading text-sm font-semibold">{card.title}</h3>
      {headline ? <p className="text-base font-semibold leading-snug break-words" data-testid="summary-headline">{headline}</p> : null}
      <p className="text-xs text-muted-foreground break-words" data-testid="summary-scope">{[card.company.name, card.period, card.comparedWith ? `compared with ${card.comparedWith}` : null, card.scope, `as of ${card.asOfLabel}`].filter(Boolean).join(" · ")}</p>
      {p.companyStale ? <Alert variant="destructive">You have selected another company since this was shown. Ask again for the company you want.</Alert> : null}
      {card.unavailable.length > 0 ? <Alert variant="destructive" data-testid="summary-partial">This summary is incomplete. I could not load: {card.unavailable.join("; ")}. Those parts are missing, not zero.</Alert> : null}
      {card.metrics.length > 0 ? (
        <dl className="flex flex-wrap gap-1.5" data-testid="summary-metrics">
          {card.metrics.map((m) => (
            <div key={m.label} className="min-w-0 rounded-md border border-border px-2 py-1">
              <dt className="text-[11px] text-muted-foreground">{m.label}</dt>
              <dd><span className="font-semibold" data-testid="metric-value">{m.value}</span>{typeof m.previous === "number" ? <span className="text-xs text-muted-foreground"> · before: {m.previous} ({m.value === m.previous ? "no change" : `${m.value > m.previous ? "+" : ""}${m.value - m.previous}`})</span> : null}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.groups.map((g) => (
        <div key={g.heading} className="space-y-0.5" data-testid="summary-group">
          <p className="text-xs font-semibold">{g.heading}</p>
          {partial.forGroup(g.heading).map((n) => <p key={n} className="rounded-md border border-border bg-secondary/60 px-2 py-1 text-xs" data-testid="summary-partial-coverage">{n}</p>)}
          {g.rows.length === 0 ? <p className="text-xs text-muted-foreground">None.</p> : <ul className="text-xs">{g.rows.map((r) => <li key={r.label} className="flex justify-between gap-2"><span className="min-w-0 break-words">{r.label}</span><span className="font-medium">{r.count}</span></li>)}</ul>}
          {g.more > 0 ? <p className="text-xs text-muted-foreground">and {g.more} more.</p> : null}
        </div>
      ))}
      {card.narrative ? (
        <div className="space-y-1 rounded-md bg-secondary/60 px-2 py-1.5" data-testid="summary-narrative">
          <p className="text-xs font-semibold">{card.narrativeBy === "ai" ? "Summary by the AI model (check it against the record)" : "In words (written by Enginious OS from the figures above)"}</p>
          <p className="whitespace-pre-wrap break-words">{card.narrative}</p>
        </div>
      ) : null}
      {card.suggestions.length > 0 ? (
        <div className="space-y-1 rounded-md border border-dashed border-border px-2 py-1.5" data-testid="summary-suggestions">
          <p className="text-xs font-semibold">Suggestions from the AI model (ideas, not recorded facts)</p>
          <ul className="list-disc pl-4 text-xs">{card.suggestions.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      ) : null}
      {card.narrativeNote ? <p className="text-xs text-muted-foreground" data-testid="summary-narrative-note">{card.narrativeNote}</p> : null}
      {card.supporting.map((s) => <SectionList key={s.heading} s={s} />)}
      {counted ? (
        <details className="rounded-md border border-border px-2 py-1 text-xs" data-testid="summary-counted">
          <summary className="cursor-pointer font-medium">How this is counted</summary>
          <div className="mt-1 max-h-48 space-y-1 overflow-y-auto text-muted-foreground">
            {card.metrics.length > 0 ? <dl className="space-y-1" data-testid="summary-definitions">{card.metrics.map((m) => <div key={m.label}><dt className="font-medium text-foreground">{m.label}</dt><dd>{m.definition}</dd></div>)}</dl> : null}
            {card.groups.map((g) => <p key={g.heading}><span className="font-medium text-foreground">{g.heading}: </span>{g.definition}</p>)}
            {partial.rest.length > 0 ? <ul className="list-disc pl-4" data-testid="summary-coverage">{partial.rest.map((x) => <li key={x}>{x}</li>)}</ul> : null}
          </div>
        </details>
      ) : null}
      {d.kind === "period" && (!d.compare || canExplain) ? (
        <div className="space-y-1.5" data-testid="summary-actions">
          {/* What the AI action sends is said BEFORE the button that sends it. */}
          {canExplain ? <p className="text-xs leading-snug text-muted-foreground break-words" data-testid="summary-ai-notice">Explain &amp; suggest sends these counts and names to Anthropic for suggestions. The sentences are written by Enginious OS.</p> : null}
          <div className="flex flex-wrap gap-2">
            {!d.compare ? <Button type="button" size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal py-1" disabled={busy || p.companyStale} onClick={() => void run({ ...d, compare: true })}>Compare periods</Button> : null}
            {canExplain ? <Button type="button" size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal py-1" disabled={busy || p.companyStale} onClick={() => void run({ ...d, narrative: true })}>Explain &amp; suggest</Button> : null}
          </div>
        </div>
      ) : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <CardLinks links={card.links} />
    </section>
  );
}

/** Scope wording for an estimate: a draft to copy into the Estimate screen. No prices, nothing saved. */
function ScopeDraftView({ card }: { card: ScopeDraftCard }) {
  const [copied, setCopied] = useState<"idle" | "yes" | "no">("idle");
  async function copy() { try { await navigator.clipboard.writeText(card.text); setCopied("yes"); } catch { setCopied("no"); } }
  return (
    <section aria-label="Scope draft" className="space-y-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm" data-testid="jarvis-scope-draft">
      <h3 className="font-heading text-sm font-semibold">Scope wording{card.enquiry ? ` for ${card.enquiry.reference}` : ""} (draft, no prices)</h3>
      <p className="whitespace-pre-wrap break-words" data-testid="scope-text">{card.text}</p>
      {card.questions.length > 0 ? <><p className="text-xs font-semibold">Questions to ask</p><ul className="list-disc pl-4 text-xs" data-testid="scope-questions">{card.questions.map((q) => <li key={q}>{q}</li>)}</ul></> : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()} data-testid="scope-copy">{copied === "yes" ? "Copied" : "Copy"}</Button>
        {copied === "no" ? <span>Could not copy: select the text instead.</span> : null}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="scope-note">{card.note}</p>
      <CardLinks links={card.links} />
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
        <ul className="flex flex-wrap gap-2">
          {card.transitions.filter((t) => t.enabled).map((t) => (
            <li key={t.to} data-testid={`transition-${t.to}`} data-enabled="true">
              <Button type="button" size="sm" variant={card.to === t.to ? "secondary" : "outline"} disabled={busy || saved} aria-pressed={card.to === t.to}
                onClick={() => void run({ mode: "propose", enquiryId: card.enquiry.id, to: t.to })}>{t.direction === "back" ? "Back to " : "Forward to "}{t.toLabel}</Button>
            </li>
          ))}
        </ul>
        {card.transitions.some((t) => t.enabled) ? null : <p className="text-xs text-muted-foreground">No move is available from here through JARVIS.</p>}
        {card.transitions.some((t) => !t.enabled) ? (
          <details className="rounded-md border border-border p-2 text-xs" data-testid="stage-disabled">
            <summary className="cursor-pointer font-medium">Moves not available from here, and why</summary>
            <ul className="mt-2 space-y-1.5">
              {card.transitions.filter((t) => !t.enabled).map((t) => (
                <li key={t.to} data-testid={`transition-${t.to}`} data-enabled="false">
                  <Button type="button" size="sm" variant="outline" disabled aria-disabled>{t.direction === "back" ? "Back to " : "Forward to "}{t.toLabel}</Button>
                  <span className="ml-2 text-muted-foreground">{t.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
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
