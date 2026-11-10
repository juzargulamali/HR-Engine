"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CRM_SOURCES } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ConfirmResult, EnquiryCard, EnquiryValues, OrgChoice, OrgField, SendResult, StatusResult } from "@/lib/jarvis/protocol";

export interface CardApi {
  review: (a: { companyId: string; fields: EnquiryValues; typed: { agency: string | null; client: string | null }; search?: { agency?: string | null; client?: string | null }; fromBrief: string[] }) => Promise<SendResult>;
  confirm: (a: { companyId: string; token: string; values: EnquiryValues; duplicateIds: string[] }) => Promise<ConfirmResult>;
  status: (confirmationId: string) => Promise<StatusResult>;
}

export interface CardState { card: EnquiryCard; confirmation: { id: string; token: string; expiresAt: string } | null }
type Phase =
  | { kind: "idle" }
  | { kind: "reviewing" }
  | { kind: "saving" }
  | { kind: "checking"; confirmationId: string; tries: number; message: string; settled: boolean }
  | { kind: "done"; reference: string; href: string; replayed: boolean }
  | { kind: "failed"; message: string };

const KINDS: { id: EnquiryValues["nextKind"]; label: string }[] = [{ id: "call", label: "Call" }, { id: "email", label: "Email" }, { id: "meeting", label: "Meeting" }, { id: "proposal", label: "Proposal work" }, { id: "other", label: "Other" }];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The review card: editable form fields (exactly the new-enquiry form's), the exact company, the linked organisations, flagged duplicates, missing required fields and the
 * ONE button that can save. "Create enquiry" is enabled only when the card is complete, unchanged since its review (a changed field needs "Review changes" first), for the
 * current company, and any likely duplicate has been acknowledged. The real reference and the link appear only after the app confirms the save; an unknown answer shows
 * "Checking the original result" and never offers a second create.
 */
export function ReviewCard({ state, companyStale, api, onState, onRegisterOrg }: { state: CardState; companyStale: boolean; api: CardApi; onState: (s: CardState) => void; onRegisterOrg?: (name: string) => void }) {
  const uid = useId();
  const { card, confirmation } = state;
  const [draft, setDraft] = useState<EnquiryValues>(card.values);
  const [typed, setTyped] = useState<{ agency: string; client: string }>({ agency: card.agency.typedName ?? "", client: card.client.typedName ?? "" });
  const [searching, setSearching] = useState<{ agency: boolean; client: boolean }>({ agency: false, client: false });
  const [ack, setAck] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const lock = useRef(false);

  // A new reviewed card arrives with a new `key` from the panel (see JarvisLauncher), so this component starts again from the reviewed values: no effect is needed to reset the draft.

  const dirty = useMemo(() => !same(draft, card.values) || typed.agency !== (card.agency.typedName ?? "") || typed.client !== (card.client.typedName ?? ""), [draft, card, typed]);
  const likely = card.duplicates.filter((d) => d.level === "likely");
  const ackOk = likely.length === 0 || ack;
  const busy = phase.kind === "reviewing" || phase.kind === "saving";
  const finished = phase.kind === "done" || phase.kind === "checking";
  const canCreate = card.valid && !!confirmation && !dirty && !companyStale && ackOk && phase.kind === "idle";
  const err = (f: string) => card.problems.find((p) => p.field === f)?.message;
  const set = <K extends keyof EnquiryValues>(k: K, v: EnquiryValues[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const idf = (n: string) => `${uid}-${n}`;

  async function review(search?: { agency?: string | null; client?: string | null }, over?: Partial<EnquiryValues>) {
    if (busy || finished) return;
    setPhase({ kind: "reviewing" });
    const r = await api.review({ companyId: card.company.id, fields: { ...draft, ...over }, typed: { agency: typed.agency.trim() || null, client: typed.client.trim() || null }, search, fromBrief: card.fromBrief });
    if (r.ok && r.kind === "card") { onState({ card: r.card, confirmation: r.confirmation }); setAck(false); setPhase({ kind: "idle" }); }
    else setPhase({ kind: "failed", message: r.ok ? "JARVIS could not review that." : r.message });
  }

  async function create() {
    if (lock.current || !canCreate || !confirmation) return; // a double click is ignored here, and the database makes a repeat safe anyway
    lock.current = true;
    setPhase({ kind: "saving" });
    let r: ConfirmResult;
    try { r = await api.confirm({ companyId: card.company.id, token: confirmation.token, values: card.values, duplicateIds: likely.map((d) => d.id) }); }
    catch { r = { ok: false, code: "ambiguous", message: "We did not get an answer to the save. Checking the original result: nothing will be created twice.", confirmationId: confirmation.id }; }
    if (r.ok) { setPhase({ kind: "done", reference: r.reference, href: r.href, replayed: r.replayed }); return; }
    if (r.code === "ambiguous") { setPhase({ kind: "checking", confirmationId: r.confirmationId ?? confirmation.id, tries: 0, message: r.message, settled: false }); return; }
    lock.current = false;
    setPhase({ kind: "failed", message: r.message });
  }

  // "Checking the original result": read-only, by confirmation id. It never creates anything.
  useEffect(() => {
    if (phase.kind !== "checking" || phase.settled) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const s = await api.status(phase.confirmationId).catch(() => null);
      if (cancelled) return;
      if (s && s.ok && s.state === "done") setPhase({ kind: "done", reference: s.reference, href: s.href ?? `/sales/opportunities/${s.opportunityId}`, replayed: true });
      else if (s && s.ok && s.state === "failed") { lock.current = false; setPhase({ kind: "failed", message: s.message }); }
      else setPhase((p) => (p.kind === "checking" ? { ...p, tries: p.tries + 1, settled: p.tries + 1 >= 4 } : p));
    }, phase.tries === 0 ? 400 : 2000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [phase, api]);

  const field = (name: string, label: string, control: React.ReactNode, hint?: string) => (
    <div className="space-y-1">
      <label htmlFor={idf(name)} className="text-xs font-medium text-muted-foreground">{label}</label>
      {control}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {err(name) ? <p className="text-xs text-destructive" data-testid={`problem-${name}`}>{err(name)}</p> : null}
    </div>
  );
  const fromBrief = (f: string) => card.fromBrief.includes(f);
  const tag = (f: string) => (fromBrief(f) ? <span className="ml-1 rounded bg-secondary px-1 text-[10px] font-normal text-muted-foreground">from your brief</span> : null);

  if (phase.kind === "done") {
    return (
      <section aria-label="Enquiry created" className="space-y-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm" data-testid="jarvis-result">
        <p className="font-medium text-success">Enquiry {phase.reference} was created.</p>
        <p className="text-muted-foreground">{phase.replayed ? "This had already been saved; nothing was created twice. " : ""}JARVIS added it to {card.company.name} with you as the owner, and recorded that you approved it.</p>
        <Link href={phase.href} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:brightness-110">Open {phase.reference}</Link>
      </section>
    );
  }
  if (phase.kind === "checking") {
    return (
      <section aria-label="Checking the original result" className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm" role="status" data-testid="jarvis-checking">
        <p className="font-medium">Checking the original result</p>
        <p className="text-muted-foreground">{phase.message}</p>
        {phase.settled ? (
          <>
            <p className="text-muted-foreground">No save has been recorded yet. It may still be arriving. Check again in a moment; nothing will be created a second time, and if it never appears you can look in the Enquiries list.</p>
            <Button size="sm" variant="outline" onClick={() => setPhase({ ...phase, tries: 0, settled: false })}>Check again</Button>
          </>
        ) : <p className="text-muted-foreground">One moment…</p>}
      </section>
    );
  }

  /** An optional text, date or number field: blank means "not stated" (null), never an empty string. */
  const text = (name: "eventStart" | "eventEnd" | "installStart" | "location" | "currency" | "value" | "budgetNote", label: string, opts: { max?: number; type?: string; hint?: string } = {}) =>
    field(name, label, (
      <Input id={idf(name)} type={opts.type ?? "text"} maxLength={opts.max} min={opts.type === "number" ? 0 : undefined} value={String(draft[name] ?? "")} disabled={busy}
        onChange={(e) => { const v = e.target.value; set(name, (v === "" ? null : name === "value" ? Number(v) : name === "currency" ? v.toUpperCase() : v) as never); }} />
    ), opts.hint);

  return (
    <section aria-label="Review the enquiry" className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-card">
      <header className="space-y-1">
        <h3 className="font-heading text-sm font-semibold">Review before anything is saved</h3>
        <p className="text-xs text-muted-foreground">New enquiry for <strong className="text-foreground" data-testid="card-company">{card.company.name}</strong>. You will be the owner. Nothing is created until you press Create enquiry.</p>
      </header>

      {card.notice ? <p className="rounded-md border border-border bg-secondary/50 px-2 py-1.5 text-xs" data-testid="card-notice">{card.notice}</p> : null}
      {companyStale ? <Alert variant="warning">The company changed after this review, so it can no longer be used. Paste the brief again for the new company.</Alert> : null}
      {card.questions.length > 0 && !companyStale ? (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2" data-testid="card-questions">
          <p className="text-xs font-medium">JARVIS needs your answer:</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">{card.questions.map((q) => <li key={`${q.field}-${q.text}`}>{q.text}</li>)}</ul>
        </div>
      ) : null}

      <div className="space-y-3">
        {field("title", "What is the enquiry?", <Input id={idf("title")} value={draft.title} maxLength={200} onChange={(e) => set("title", e.target.value)} disabled={busy} />)}
        {field("source", "Where did it come from?", (
          <Select id={idf("source")} value={draft.source} onChange={(e) => { set("source", e.target.value); void review(undefined, { source: e.target.value }); }} disabled={busy}>
            <option value="">Choose a source…</option>
            {CRM_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        ))}
        <OrgBlock idf={idf} label="Agency" hint="The intermediary that sent the brief." field="agency" choice={card.agency} id={draft.agencyOrgId} typed={typed.agency} searching={searching.agency} disabled={busy}
          error={err("agencyOrgId")} tag={tag("agencyOrgId")}
          onTyped={(v) => setTyped((t) => ({ ...t, agency: v }))} onSearching={(v) => setSearching((s) => ({ ...s, agency: v }))}
          onRegister={onRegisterOrg} onSearch={() => void review({ agency: typed.agency })} onPick={(id) => { set("agencyOrgId", id); void review(undefined, { agencyOrgId: id }); }} onClear={() => { set("agencyOrgId", null); setTyped((t) => ({ ...t, agency: "" })); }} />
        <OrgBlock idf={idf} label="End client" hint="The brand the work is for." field="client" choice={card.client} id={draft.clientOrgId} typed={typed.client} searching={searching.client} disabled={busy}
          error={card.problems.find((p) => p.field === "clientOrgId")?.message} tag={tag("clientOrgId")}
          onTyped={(v) => setTyped((t) => ({ ...t, client: v }))} onSearching={(v) => setSearching((s) => ({ ...s, client: v }))}
          onRegister={onRegisterOrg} onSearch={() => void review({ client: typed.client })} onPick={(id) => { set("clientOrgId", id); void review(undefined, { clientOrgId: id }); }} onClear={() => { set("clientOrgId", null); setTyped((t) => ({ ...t, client: "" })); }} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
          {field("nextTitle", "Next action", <Input id={idf("nextTitle")} value={draft.nextTitle} maxLength={300} onChange={(e) => set("nextTitle", e.target.value)} disabled={busy} placeholder="e.g. Call to qualify the brief" />)}
          {field("nextDate", "Due", <Input id={idf("nextDate")} type="date" value={draft.nextDate} onChange={(e) => set("nextDate", e.target.value)} disabled={busy} />)}
        </div>
        {field("nextKind", "Type of next action", <Select id={idf("nextKind")} value={draft.nextKind} onChange={(e) => set("nextKind", e.target.value as EnquiryValues["nextKind"])} disabled={busy}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select>)}
      </div>

      <details className="rounded-md border border-border p-2">
        <summary className="cursor-pointer text-xs font-medium">More details (optional){card.fromBrief.some((f) => !["title", "source", "agencyOrgId", "clientOrgId", "nextTitle", "nextDate", "nextKind"].includes(f)) ? " · some filled from your brief" : ""}</summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {text("eventStart", "Event start", { type: "date" })}
            {text("eventEnd", "Event end", { type: "date" })}
            {text("installStart", "Installation", { type: "date" })}
          </div>
          {text("location", "Location", { max: 200 })}
          <div className="grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,8rem)] gap-3">
            <div />
            {text("currency", "Currency", { max: 3 })}
            {text("value", "Budget or value", { type: "number" })}
          </div>
          {text("budgetNote", "Budget note", { max: 1000 })}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Technologies requested</legend>
            {draft.technologies.map((t, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] items-center gap-2">
                <Input aria-label={`Technology ${i + 1} name`} value={t.name} maxLength={120} onChange={(e) => set("technologies", draft.technologies.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} disabled={busy} />
                <Input aria-label={`Technology ${i + 1} quantity`} type="number" min={1} value={t.qty} onChange={(e) => set("technologies", draft.technologies.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x)))} disabled={busy} />
                <Button type="button" size="sm" variant="ghost" onClick={() => set("technologies", draft.technologies.filter((_, j) => j !== i))} disabled={busy} aria-label={`Remove technology ${i + 1}`}>Remove</Button>
              </div>
            ))}
            {draft.technologies.length < 20 ? <Button type="button" size="sm" variant="outline" onClick={() => set("technologies", [...draft.technologies, { name: "", qty: 1 }])} disabled={busy}>Add a technology</Button> : null}
          </fieldset>
          {field("waitingOn", "Waiting on", (
            <Select id={idf("waitingOn")} value={draft.waitingOn ?? ""} onChange={(e) => set("waitingOn", (e.target.value || null) as EnquiryValues["waitingOn"])} disabled={busy}>
              <option value="">Nobody</option><option value="client">The client</option><option value="internal">Our own team</option>
            </Select>
          ))}
          {field("brief", "Brief", <Textarea id={idf("brief")} rows={3} maxLength={4000} value={draft.brief ?? ""} onChange={(e) => set("brief", e.target.value || null)} disabled={busy} />, "JARVIS keeps a short summary, not the pasted text.")}
          {field("scope", "Scope", <Textarea id={idf("scope")} rows={2} maxLength={4000} value={draft.scope ?? ""} onChange={(e) => set("scope", e.target.value || null)} disabled={busy} />)}
        </div>
      </details>

      {card.duplicates.length > 0 ? (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="card-duplicates">
          <p className="font-medium">This may be the same enquiry as:</p>
          <ul className="space-y-1">
            {card.duplicates.map((d) => (
              <li key={d.id}><Link href={`/sales/opportunities/${d.id}`} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">{d.reference}</Link> · {d.title} <span className="text-muted-foreground">({d.level === "likely" ? "likely" : "possible"}: {d.reasons.join(", ")})</span></li>
            ))}
          </ul>
          {likely.length > 0 ? (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" data-testid="ack-duplicates" />
              <span>These are not the same enquiry. Create a new one anyway.</span>
            </label>
          ) : null}
        </div>
      ) : null}

      {card.problems.length > 0 && !dirty ? (
        <p className="text-xs text-muted-foreground" data-testid="card-missing">Still needed before you can create it: {card.problems.map((p) => p.message.replace(/\.$/, "")).join("; ")}.</p>
      ) : null}
      {phase.kind === "failed" ? <Alert variant="destructive" role="alert" data-testid="card-failed">{phase.message}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        {dirty || !card.valid || !confirmation ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => void review()} disabled={busy || !dirty && card.valid && !!confirmation}>{phase.kind === "reviewing" ? "Reviewing…" : "Review changes"}</Button>
        ) : null}
        <Button type="button" size="sm" onClick={() => void create()} disabled={!canCreate} aria-disabled={!canCreate} data-testid="create-enquiry">{phase.kind === "saving" ? "Creating…" : "Create enquiry"}</Button>
        {dirty ? <span className="text-xs text-muted-foreground">You changed something: review the changes first.</span> : null}
      </div>
      {confirmation && card.valid && !dirty ? <p className="text-[11px] text-muted-foreground">This review is valid until {new Date(confirmation.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p> : null}
    </section>
  );
}

function OrgBlock(p: {
  idf: (n: string) => string; label: string; hint: string; field: OrgField; choice: OrgChoice; id: string | null; typed: string; searching: boolean; disabled: boolean; error?: string; tag: React.ReactNode;
  onTyped: (v: string) => void; onSearching: (v: boolean) => void; onSearch: () => void; onPick: (id: string) => void; onClear: () => void; onRegister?: (name: string) => void;
}) {
  const name = `${p.field}OrgId`;
  const picked = p.id && p.choice.selectedId === p.id && !p.searching;
  return (
    <div className="space-y-1" data-testid={`org-${p.field}`}>
      <label htmlFor={p.idf(name)} className="text-xs font-medium text-muted-foreground">{p.label}{p.tag}</label>
      {picked ? (
        <div className="flex items-center gap-2">
          <span id={p.idf(name)} className="min-w-0 flex-1 truncate rounded-md border border-border bg-field px-3 py-1.5" data-testid={`org-${p.field}-selected`}>{p.choice.selectedName}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => p.onSearching(true)} disabled={p.disabled}>Change</Button>
          <Button type="button" size="sm" variant="ghost" onClick={p.onClear} disabled={p.disabled}>Clear</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input id={p.idf(name)} value={p.typed} maxLength={200} onChange={(e) => p.onTyped(e.target.value)} placeholder="Search by name" disabled={p.disabled} />
            <Button type="button" size="sm" variant="outline" onClick={p.onSearch} disabled={p.disabled || p.typed.trim().length < 3}>Search</Button>
          </div>
          {p.choice.options.length > 0 ? (
            <Select aria-label={`Choose the ${p.label.toLowerCase()}`} value={p.id ?? ""} onChange={(e) => e.target.value && p.onPick(e.target.value)} disabled={p.disabled}>
              <option value="">Choose…</option>
              {p.choice.options.map((o) => <option key={o.id} value={o.id}>{o.place ? `${o.name} (${o.place})` : o.name}</option>)}
            </Select>
          ) : null}
        </div>
      )}
      {!picked && p.choice.guidance ? <p className="text-xs text-muted-foreground" data-testid={`guidance-${p.field}`}>{p.choice.guidance}</p> : <p className="text-xs text-muted-foreground">{p.hint}</p>}
      {!picked && p.choice.status === "not_found" && p.onRegister && p.choice.typedName ? (
        <Button type="button" size="sm" variant="outline" onClick={() => p.onRegister?.(p.choice.typedName!)} data-testid={`register-${p.field}`}>Register “{p.choice.typedName}” with JARVIS</Button>
      ) : null}
      {p.error && !picked ? <p className="text-xs text-destructive">{p.error}</p> : null}
    </div>
  );
}
