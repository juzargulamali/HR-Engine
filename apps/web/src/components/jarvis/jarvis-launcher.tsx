"use client";

import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFocusTrap } from "@/lib/use-focus-trap";
import Link from "next/link";
import { jarvisAct, jarvisConfirm, jarvisConfirmAction, jarvisContext, jarvisMemory, jarvisReview, jarvisSend, jarvisStatus, jarvisSuggestCorrection } from "@/lib/actions/jarvis";
import { PREFERENCES, PREFERENCE_KEYS, type PreferenceView } from "@/lib/jarvis/preferences";
import { JARVIS_MODES, type JarvisModeKey } from "@/lib/jarvis/modes";
import type { ChatTurn, ContextView, HelpView, JarvisRefusal, LookupPeriod, ReplyLink, SendContext, SendResult } from "@/lib/jarvis/protocol";
import { ActionCardView, type ActionApi, type ActionCardState } from "./action-cards";
import { JarvisMark } from "./jarvis-mark";
import { ReviewCard, type CardApi, type CardState } from "./review-card";

export interface JarvisClientApi extends CardApi, ActionApi {
  send: (a: { companyId: string; text: string; intent?: string | null; enquiryId?: string | null; context?: SendContext | null; briefOutbound?: string | null; screen?: string | null }) => Promise<SendResult>;
  memory?: (a: { op: "list" } | { op: "set"; key: string; value: string } | { op: "delete"; key: string }) => Promise<SendResult>;
  context: (a: { companyId: string | null; enquiryId: string | null }) => Promise<{ ok: true; view: ContextView } | JarvisRefusal>;
}

/** The server actions, adapted to the panel's types. Every one is re-authorised on the server on every call; this file decides nothing about access. */
export const serverApi: JarvisClientApi = {
  send: (a) => jarvisSend(a),
  context: (a) => jarvisContext(a),
  review: (a) => jarvisReview({ companyId: a.companyId, fields: a.fields as unknown as Record<string, unknown>, typed: a.typed, search: a.search, fromBrief: a.fromBrief }),
  confirm: (a) => jarvisConfirm({ companyId: a.companyId, token: a.token, values: a.values, duplicateIds: a.duplicateIds }),
  status: (id) => jarvisStatus(id),
  act: (a) => jarvisAct(a),
  confirmAction: (a) => jarvisConfirmAction(a),
  memory: (a) => jarvisMemory(a),
  suggest: (a) => jarvisSuggestCorrection(a),
};

type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "jarvis"; kind: "text"; text: string; tone?: "error" | "info" }
  | { id: number; role: "jarvis"; kind: "help"; help: HelpView }
  | { id: number; role: "jarvis"; kind: "reply"; text: string; links: ReplyLink[] }
  | { id: number; role: "jarvis"; kind: "clarify"; text: string; original: string; options: { label: string; intent: string }[] }
  | { id: number; role: "jarvis"; kind: "brief_review"; text: string; original: string; outbound: string; formHref: string }
  | { id: number; role: "jarvis"; kind: "memory"; text: string; preferences: PreferenceView[] }
  | { id: number; role: "jarvis"; kind: "card"; state: CardState; companyId: string; rev: number }
  | { id: number; role: "jarvis"; kind: "action"; actionId: string; state: ActionCardState; companyId: string; rev: number };
type NewMsg = Msg extends infer M ? (M extends { id: number } ? Omit<M, "id"> : never) : never;

const ENQUIRY_PATH = /^\/sales\/opportunities\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WELCOME = "Ask me anything: a question, a draft to copy, how something works in Enginious OS, or \"show my overdue Sales follow-ups\". Paste a client brief and I will prepare an enquiry for you to review.";
/** The context kept for follow-ups: a few turns of the general conversation only (never cards, lookups or records), in this component's memory. */
const MAX_TURNS = 4;
let nextId = 1;

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/** Tells the launcher which enquiry the page is about (the route, or the side panel's ?open=). A HINT: it is never permission and never retargets a review. */
function RouteWatcher({ onEnquiry, onScreen }: { onEnquiry: (id: string | null) => void; onScreen: (path: string | null) => void }) {
  const path = usePathname();
  const search = useSearchParams();
  const open = search?.get("open") ?? null;
  useEffect(() => {
    const fromPath = ENQUIRY_PATH.exec(path ?? "")?.[1] ?? null;
    const fromPanel = path?.startsWith("/sales/opportunities") && open && UUID.test(open) ? open : null;
    onEnquiry(fromPath ?? fromPanel);
    // Which screen the person is on: the address path only (no query, no content). The server reduces it to an approved screen identifier before any use.
    onScreen(path ?? null);
  }, [path, open, onEnquiry, onScreen]);
  return null;
}

/**
 * ONE floating launcher on the right edge of the signed-in app, and the JARVIS panel it opens. Drawn only for people the server says may use JARVIS (the (app) layout asks);
 * every call the panel makes is checked again on the server. The conversation lives in this component's memory only: reloading the page clears it, nothing is stored.
 */
const CREATE_ID = "jarvis.sales.enquiry.create_from_brief";

export function JarvisLauncher({ companies, writes, maxInputChars, enabledActionIds = [CREATE_ID], api = serverApi }: { companies: { id: string; name: string }[]; writes: boolean; maxInputChars: number; enabledActionIds?: string[]; api?: JarvisClientApi }) {
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [routeEnquiry, setRouteEnquiry] = useState<string | null>(null);
  const [enquiry, setEnquiry] = useState<ContextView["enquiry"]>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [modeKey, setModeKey] = useState<JarvisModeKey | null>(null);
  const [busy, setBusy] = useState(false);
  const turnsRef = useRef<ChatTurn[]>([]);
  const lookupRef = useRef<{ period: LookupPeriod } | null>(null);
  /** The question behind the Sales lookup or summary last shown: sent back so "show last month instead" means something. A question only; the server re-reads everything. */
  const queryRef = useRef<{ kind: "lookup" | "summary"; descriptor: unknown; companyId: string; messageId: number | null } | null>(null);
  /** The question to send with a follow-up: only the one behind the latest card, and only for the company it was asked for. */
  const lastQueryFor = (company: string) => (queryRef.current && queryRef.current.companyId === company ? { kind: queryRef.current.kind, descriptor: queryRef.current.descriptor } : null);
  const phone = useIsPhone();
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The composer grows with its content (a pasted brief) up to its CSS max height, then scrolls inside itself; it shrinks back when the text is sent or cleared.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px`;
  }, [text, open]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const companyRef = useRef(companyId);
  useEffect(() => { companyRef.current = companyId; }, [companyId]);
  const titleId = useId();
  const chip = routeEnquiry && enquiry?.id === routeEnquiry ? enquiry : null;
  const modes = JARVIS_MODES.filter((m) => enabledActionIds.includes(m.actionId));
  const mode = modeKey ? modes.find((m) => m.key === modeKey) ?? null : null;
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? "that company";

  useFocusTrap(panelRef, open && phone);

  // Opening moves focus into the panel; closing returns it to the launcher. Escape closes.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    if (wasOpen.current) launcherRef.current?.focus();
  }, [open]);
  const openPanel = () => { setOpen(true); setPulse(true); setTimeout(() => setPulse(false), 1000); };
  useEffect(() => { wasOpen.current = open; }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    if (phone) document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, phone]);
  useEffect(() => { scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight }); }, [messages, notice]);

  // The page context chip: derived from the route, re-read through the person's own session, shown (not silently applied) when it changes.
  useEffect(() => {
    let cancelled = false;
    if (!routeEnquiry) return;
    void api.context({ companyId: companyRef.current || null, enquiryId: routeEnquiry }).then((r) => {
      if (cancelled) return;
      if (!r.ok || !r.view.enquiry) { setEnquiry(null); return; }
      const e = r.view.enquiry;
      setEnquiry(e);
      if (companies.some((c) => c.id === e.companyId) && e.companyId !== companyRef.current) {
        const from = companyRef.current;
        setCompanyId(e.companyId);
        setNotice(`You opened ${e.reference}, which belongs to ${nameOf(e.companyId)}, so JARVIS switched to that company. A review made for ${nameOf(from)} can no longer be used.`);
      } else setNotice(`You are looking at ${e.reference}. A review you already have stays for the company it was made for.`);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeEnquiry, api]);

  const onRouteEnquiry = useCallback((id: string | null) => setRouteEnquiry(id), []);
  const screenRef = useRef<string | null>(null);
  const onScreen = useCallback((path: string | null) => { screenRef.current = path; }, []);
  const push = (m: NewMsg) => setMessages((ms) => [...ms, { ...m, id: nextId++ } as Msg]);

  async function send(raw: string, forced?: { intent: string; briefOutbound?: string }) {
    const t = raw.trim();
    if (!t || busy) return;
    if (t.length > maxInputChars) { push({ role: "jarvis", kind: "text", tone: "error", text: `That is too long (${t.length} characters; the limit is ${maxInputChars}).` }); return; }
    setBusy(true);
    if (!forced) push({ role: "user", text: t.length > 160 ? `${t.slice(0, 160)}… (${t.length} characters)` : t });
    setText("");
    try {
      const r = await api.send({ companyId, text: t, intent: forced ? forced.intent : mode?.key ?? null, enquiryId: chip?.id ?? null, context: { turns: turnsRef.current, lastLookup: lookupRef.current, lastQuery: lastQueryFor(companyId) }, briefOutbound: forced?.briefOutbound ?? null, screen: screenRef.current });
      if (!r.ok) push({ role: "jarvis", kind: "text", tone: "error", text: r.message });
      else if (r.kind === "help") push({ role: "jarvis", kind: "help", help: r.help });
      else if (r.kind === "not_available") push({ role: "jarvis", kind: "text", tone: "info", text: `${r.title}: ${r.reason}` });
      else if (r.kind === "info") push({ role: "jarvis", kind: "text", tone: "info", text: r.text });
      else if (r.kind === "reply") push({ role: "jarvis", kind: "reply", text: r.text, links: r.links });
      else if (r.kind === "clarify") push({ role: "jarvis", kind: "clarify", text: r.text, original: t, options: r.options });
      else if (r.kind === "brief_review") push({ role: "jarvis", kind: "brief_review", text: r.text, original: t, outbound: r.outbound, formHref: r.formHref });
      else if (r.kind === "memory") push({ role: "jarvis", kind: "memory", text: r.text, preferences: r.preferences });
      else if (r.kind === "action") {
        if (r.card.kind === "chat.reply") turnsRef.current = [...turnsRef.current, { role: "user" as const, text: t }, { role: "jarvis" as const, text: r.card.text }].slice(-MAX_TURNS);
        lookupRef.current = r.card.kind === "lookup.followups" ? { period: r.card.period } : r.card.kind === "lookup.sales" || r.card.kind === "summary.sales" ? null : lookupRef.current;
        queryRef.current = r.card.kind === "lookup.sales" ? { kind: "lookup", descriptor: r.card.descriptor, companyId, messageId: null } : r.card.kind === "summary.sales" ? { kind: "summary", descriptor: r.card.descriptor, companyId, messageId: null } : r.card.kind === "lookup.followups" || r.card.kind === "chat.reply" ? null : queryRef.current;
        push({ role: "jarvis", kind: "action", actionId: r.actionId, state: { card: r.card, confirmation: r.confirmation }, companyId, rev: 0 });
      }
      else push({ role: "jarvis", kind: "card", state: { card: r.card, confirmation: r.confirmation }, companyId, rev: 0 });
    } catch {
      push({ role: "jarvis", kind: "text", tone: "error", text: "JARVIS could not be reached. Enginious OS itself is not affected." });
    } finally { setBusy(false); }
  }

  async function memory(a: { op: "list" } | { op: "set"; key: string; value: string } | { op: "delete"; key: string }) {
    if (busy || !api.memory) return;
    setBusy(true);
    try {
      const r = await api.memory(a);
      if (!r.ok) push({ role: "jarvis", kind: "text", tone: "error", text: r.message });
      else if (r.kind === "memory") {
        // One memory view at a time: the latest replaces the earlier one, so a deleted preference is not left on screen.
        setMessages((ms) => [...ms.filter((m) => !(m.role === "jarvis" && m.kind === "memory")), { id: nextId++, role: "jarvis", kind: "memory", text: r.text, preferences: r.preferences }]);
      }
    } catch { push({ role: "jarvis", kind: "text", tone: "error", text: "Could not reach your saved preferences just now." }); }
    finally { setBusy(false); }
  }

  /** From a review card whose organisation is not recorded: start the (separate) register flow for that name. It searches first and asks for its own confirmation. */
  async function startRegister(name: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.send({ companyId, text: name, intent: "organisation", enquiryId: null });
      if (!r.ok) push({ role: "jarvis", kind: "text", tone: "error", text: r.message });
      else if (r.kind === "action") push({ role: "jarvis", kind: "action", actionId: r.actionId, state: { card: r.card, confirmation: r.confirmation }, companyId, rev: 0 });
    } catch { push({ role: "jarvis", kind: "text", tone: "error", text: "JARVIS could not be reached. Sales & CRM is not affected." }); }
    finally { setBusy(false); }
  }

  function changeCompany(id: string) {
    if (id === companyId) return;
    const hadCard = messages.some((m) => m.role === "jarvis" && m.kind === "card");
    setCompanyId(id);
    setNotice(`Company changed to ${nameOf(id)}.${hadCard ? ` A review made for ${nameOf(companyId)} can no longer be used: paste the brief again.` : ""}`);
  }

  return (
    <>
      <Suspense fallback={null}><RouteWatcher onEnquiry={onRouteEnquiry} onScreen={onScreen} /></Suspense>
      <button
        ref={launcherRef}
        type="button"
        aria-label="Open JARVIS"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openPanel}
        className={`jarvis-launcher group fixed z-40 flex items-center gap-2 border border-border bg-card px-2.5 py-2.5 text-sm font-medium text-foreground shadow-[var(--shadow-pop)] transition-all hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:bottom-24 max-lg:right-3 max-lg:rounded-full lg:right-0 lg:top-1/2 lg:-translate-y-1/2 lg:rounded-l-xl lg:border-r-0 ${pulse ? "jarvis-pulse" : ""}`}
        data-testid="jarvis-launcher"
      >
        <JarvisMark size={22} />
        <span aria-hidden className="hidden max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[8rem] group-hover:opacity-100 group-focus-visible:max-w-[8rem] group-focus-visible:opacity-100 lg:inline">Open JARVIS</span>
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" aria-hidden onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal={phone ? true : undefined}
            aria-labelledby={titleId}
            data-testid="jarvis-panel"
            className="fixed inset-x-0 bottom-0 z-[60] flex h-[92dvh] flex-col rounded-t-2xl border border-border bg-card text-foreground shadow-[var(--shadow-pop)] lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-0 lg:h-dvh lg:w-[27rem] lg:rounded-none lg:border-y-0 lg:border-r-0"
          >
            <header className="flex items-start gap-3 border-b border-border px-4 py-3">
              <JarvisMark size={26} />
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="font-heading text-base font-semibold leading-tight">JARVIS</h2>
                <p className="text-xs text-muted-foreground">Enginious OS assistant</p>
                <Badge variant="brand" className="mt-1" data-testid="jarvis-capability">Sales &amp; CRM</Badge>
                {api.memory ? <button type="button" className="ml-2 text-xs text-muted-foreground underline underline-offset-2" onClick={() => void memory({ op: "list" })} disabled={busy} data-testid="jarvis-memory-open">What JARVIS remembers</button> : null}
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close JARVIS" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            <div className="space-y-2 border-b border-border px-4 py-2 text-xs" data-testid="jarvis-context">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Company</span>
                {companies.length > 1 ? (
                  <Select aria-label="Company for JARVIS" value={companyId} onChange={(e) => changeCompany(e.target.value)} className="h-8 w-auto max-w-[16rem] py-0 text-xs" disabled={busy}>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                ) : <span className="rounded-md border border-border bg-field px-2 py-1 font-medium" data-testid="jarvis-company">{nameOf(companyId)}</span>}
                {chip ? <span className="rounded-md border border-border bg-field px-2 py-1" data-testid="jarvis-enquiry-chip" title={chip.title}>Enquiry <strong>{chip.reference}</strong></span> : null}
              </div>
              {notice ? (
                <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/50 px-2 py-1.5" role="status" data-testid="jarvis-notice">
                  <span className="flex-1">{notice}</span>
                  <button type="button" onClick={() => setNotice(null)} className="text-muted-foreground underline underline-offset-2">Dismiss</button>
                </div>
              ) : null}
              {!writes ? <p className="text-muted-foreground">JARVIS is read-only right now: it cannot create records.</p> : null}
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite" aria-relevant="additions" data-testid="jarvis-messages">
              <div className="space-y-2">
                <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm" data-testid="jarvis-welcome">{WELCOME}</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Shortcuts (optional)">
                  <Button type="button" size="sm" variant="outline" onClick={() => void send("What can you do?")} disabled={busy}>What can you do?</Button>
                  {modes.length > 1 ? modes.map((m) => (
                    <Button key={m.key} type="button" size="sm" variant={modeKey === m.key ? "secondary" : "outline"} aria-pressed={modeKey === m.key} data-testid={`mode-${m.key}`} disabled={busy}
                      onClick={() => { setModeKey(modeKey === m.key ? null : m.key); inputRef.current?.focus(); }}>{m.label}</Button>
                  )) : null}
                </div>
              </div>
              {messages.map((m) => {
                if (m.role === "user") return <p key={m.id} className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary/15 px-3 py-2 text-sm" data-testid="jarvis-user-msg">{m.text}</p>;
                if (m.kind === "text") return m.tone === "error" ? <Alert key={m.id} variant="destructive" role="alert" data-testid="jarvis-error">{m.text}</Alert> : <p key={m.id} className="rounded-lg bg-secondary/60 px-3 py-2 text-sm" data-testid="jarvis-info">{m.text}</p>;
                if (m.kind === "help") return <HelpList key={m.id} help={m.help} />;
                if (m.kind === "reply") return (
                  <div key={m.id} className="space-y-1 rounded-lg bg-secondary/60 px-3 py-2 text-sm" data-testid="jarvis-reply">
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.links.length > 0 ? <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{m.links.map((l) => <Link key={l.href} href={l.href} className="font-medium underline underline-offset-2">{l.label}</Link>)}</p> : null}
                  </div>
                );
                if (m.kind === "clarify") return (
                  <div key={m.id} className="space-y-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm" data-testid="jarvis-clarify">
                    <p>{m.text}</p>
                    <div className="flex flex-wrap gap-2">{m.options.map((o) => <Button key={o.label} type="button" size="sm" variant="outline" disabled={busy} onClick={() => void send(m.original, { intent: o.intent })}>{o.label}</Button>)}</div>
                  </div>
                );
                if (m.kind === "brief_review") return <BriefReview key={m.id} text={m.text} outbound={m.outbound} formHref={m.formHref} busy={busy} onSend={(edited) => void send(m.original, { intent: "enquiry", briefOutbound: edited })} />;
                if (m.kind === "memory") return <MemoryView key={m.id} text={m.text} preferences={m.preferences} busy={busy} onSet={(key, value) => void memory({ op: "set", key, value })} onDelete={(key) => void memory({ op: "delete", key })} />;
                if (m.kind === "action") {
                  return (
                    <ActionCardView
                      key={`${m.id}-${m.rev}`}
                      actionId={m.actionId}
                      state={m.state}
                      companyId={m.companyId}
                      companyStale={m.companyId !== companyId}
                      api={api}
                      onState={(s) => {
                        // A card that reran itself (a chosen client, "compare", "in words") now shows a DIFFERENT question: when it is the latest answer, a typed
                        // follow-up must refine that question, not the one first asked.
                        if (messages[messages.length - 1]?.id === m.id && (s.card.kind === "lookup.sales" || s.card.kind === "summary.sales")) queryRef.current = { kind: s.card.kind === "lookup.sales" ? "lookup" : "summary", descriptor: s.card.descriptor, companyId: m.companyId, messageId: m.id };
                        setMessages((ms) => ms.map((x) => (x.id === m.id && x.role === "jarvis" && x.kind === "action" ? { ...x, state: s, rev: x.rev + 1 } : x)));
                      }}
                    />
                  );
                }
                return (
                  <ReviewCard
                    key={`${m.id}-${m.rev}`}
                    state={m.state}
                    companyStale={m.companyId !== companyId}
                    api={api}
                    onRegisterOrg={enabledActionIds.includes("jarvis.sales.organisation.register") ? (n) => void startRegister(n) : undefined}
                    onState={(s) => setMessages((ms) => ms.map((x) => (x.id === m.id && x.role === "jarvis" && x.kind === "card" ? { ...x, state: s, rev: x.rev + 1 } : x)))}
                  />
                );
              })}
              {busy ? <p className="text-xs text-muted-foreground" role="status">JARVIS is reading…</p> : null}
            </div>

            <form className="space-y-2 border-t border-border px-4 py-3" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
              {mode ? (
                <p className="flex flex-wrap items-center gap-2 text-xs" data-testid="jarvis-mode-note">
                  <span className="rounded-md border border-border bg-field px-2 py-1 font-medium">{mode.label}</span>
                  {mode.needsEnquiry ? (chip ? <span className="text-muted-foreground">for {chip.reference}</span> : <span className="text-muted-foreground">Open an enquiry first, or include its reference (for example OPP-UAE-2026-0001).</span>) : null}
                  <button type="button" onClick={() => setModeKey(null)} className="text-muted-foreground underline underline-offset-2">Clear mode</button>
                </p>
              ) : null}
              <label htmlFor={`${titleId}-in`} className="sr-only">Paste a brief or ask a question</label>
              <Textarea
                id={`${titleId}-in`}
                ref={inputRef}
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void send(text); } }}
                placeholder={mode?.placeholder ?? "Ask a question, ask for a draft, or paste a brief…"}
                disabled={busy}
                // Two lines to start; it grows with what is typed or pasted up to about six lines, then scrolls inside itself so the conversation keeps its room.
                className="max-h-[9.75rem] min-h-[3.25rem] resize-none overflow-y-auto"
                data-testid="jarvis-composer"
              />
              <div className="flex items-center justify-between gap-2">
                <p className={`text-[11px] ${text.length > maxInputChars ? "text-destructive" : "text-muted-foreground"}`}>{text.length > 0 ? `${text.length} / ${maxInputChars}` : "Ctrl+Enter sends."}</p>
                <div className="flex shrink-0 gap-2">
                  {messages.length > 0 ? <Button type="button" size="sm" variant="ghost" aria-label="Clear conversation" onClick={() => { setMessages([]); setNotice(null); turnsRef.current = []; lookupRef.current = null; queryRef.current = null; }} disabled={busy}>Clear</Button> : null}
                  <Button type="submit" size="sm" disabled={busy || text.trim() === ""}>Send</Button>
                </div>
              </div>
              <details className="text-[11px] text-muted-foreground" data-testid="jarvis-shared">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <span data-testid="jarvis-anthropic-notice">AI drafts and suggestions use Anthropic. Lookups stay in Enginious OS.</span>{" "}
                  <span className="font-medium text-foreground underline underline-offset-2">What gets shared</span>
                </summary>
                <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-border bg-secondary/40 p-2" data-testid="jarvis-shared-detail">
                  <p><span className="font-medium text-foreground">Sent to Anthropic:</span> the text you submit for a task (a brief, a message, a request), including working prices, budgets and costs you type yourself. For suggestions on a summary, a summary of one enquiry, or scope wording, JARVIS also sends counts, names, dates and that enquiry&apos;s brief, scope and notes as written, including figures written in them.</p>
                  <p><span className="font-medium text-foreground">Never sent:</span> an enquiry&apos;s value, budget and payment-terms fields; estimates, proposals, prepared estimate or quotation documents; attachments and files; and anything marked confidential, NDA or internal only.</p>
                  <p><span className="font-medium text-foreground">Stays in Enginious OS:</span> lookups and guidance. Do not paste salaries, personal IDs, bank or medical details or financial statements: JARVIS will not send them.</p>
                  <p>Nothing is saved until you confirm a review card. JARVIS does not send emails, and this conversation is not stored.</p>
                </div>
              </details>
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}

/** A brief that could not be separated safely: nothing was sent. The person edits the text that WOULD be sent (their original stays for the review card), or opens the form. */
function BriefReview({ text, outbound, formHref, busy, onSend }: { text: string; outbound: string; formHref: string; busy: boolean; onSend: (edited: string) => void }) {
  const [draft, setDraft] = useState(outbound);
  return (
    <section aria-label="Review what would be sent" className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-brief-review">
      <p>{text}</p>
      <label htmlFor="jarvis-brief-outbound" className="text-xs font-medium">Text that would be sent to the AI model</label>
      <Textarea id="jarvis-brief-outbound" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={busy || draft.trim() === ""} onClick={() => onSend(draft)} data-testid="brief-review-send">Send this version</Button>
        <Link href={formHref} className="text-xs font-medium underline underline-offset-2">Use the new-enquiry form instead</Link>
      </div>
    </section>
  );
}

/** What JARVIS remembers: the person's own preferences, each with its fixed choices (edit) and a delete button; and the ones not set yet (add). */
function MemoryView({ text, preferences, busy, onSet, onDelete }: { text: string; preferences: PreferenceView[]; busy: boolean; onSet: (key: string, value: string) => void; onDelete: (key: string) => void }) {
  const unset = PREFERENCE_KEYS.filter((k) => !preferences.some((p) => p.key === k));
  return (
    <section aria-label="What JARVIS remembers" className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm" data-testid="jarvis-memory">
      <h3 className="font-heading text-sm font-semibold">What JARVIS remembers</h3>
      <p className="text-xs text-muted-foreground" data-testid="memory-text">{text}</p>
      {preferences.map((p) => (
        <div key={p.key} className="flex flex-wrap items-center gap-2" data-testid={`memory-${p.key}`}>
          <span className="min-w-[9rem] text-xs font-medium">{p.label}</span>
          <Select aria-label={p.label} value={p.value} onChange={(e) => onSet(p.key, e.target.value)} disabled={busy} className="h-8 w-auto py-0 text-xs">
            {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onDelete(p.key)} aria-label={`Delete ${p.label}`}>Delete</Button>
        </div>
      ))}
      {unset.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="memory-add">
          <span className="text-muted-foreground">Add:</span>
          {unset.map((k) => (
            <Select key={k} aria-label={`Add ${PREFERENCES[k].label}`} value="" onChange={(e) => { if (e.target.value) onSet(k, e.target.value); }} disabled={busy} className="h-8 w-auto py-0 text-xs">
              <option value="">{PREFERENCES[k].label}…</option>
              {Object.entries(PREFERENCES[k].options).map(([v, o]) => <option key={v} value={v}>{o.label}</option>)}
            </Select>
          ))}
        </div>
      ) : null}
      <p className="text-[11px] text-muted-foreground">Only these writing preferences are kept. JARVIS does not remember conversations, business records, passwords or personal details.</p>
    </section>
  );
}

function HelpList({ help }: { help: HelpView }) {
  return (
    <section aria-label="What JARVIS can do" className="space-y-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm" data-testid="jarvis-help">
      <p className="font-medium">What I can do</p>
      <ul className="space-y-1">
        {help.enabled.map((a) => <li key={a.id}><strong>{a.title}.</strong> <span className="text-muted-foreground">{a.description}</span></li>)}
      </ul>
      {help.disabled.length > 0 ? (
        <>
          <p className="pt-1 font-medium">Not available yet</p>
          <ul className="space-y-1">
            {help.disabled.map((a) => <li key={a.id} className="text-muted-foreground"><span className="text-foreground">{a.title}</span> <Badge variant="outline" className="ml-1">Not available yet</Badge></li>)}
          </ul>
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">JARVIS never looks up or sends salaries, payroll, reimbursements, medical or insurance details, personal IDs, bank details, private leave details, saved prices, internal costings or company financials, and it never changes settings or permissions.</p>
    </section>
  );
}
