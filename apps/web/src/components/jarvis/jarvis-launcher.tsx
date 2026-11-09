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
import { jarvisAct, jarvisConfirm, jarvisConfirmAction, jarvisContext, jarvisReview, jarvisSend, jarvisStatus } from "@/lib/actions/jarvis";
import { JARVIS_MODES, type JarvisModeKey } from "@/lib/jarvis/modes";
import type { ContextView, HelpView, JarvisRefusal, SendResult } from "@/lib/jarvis/protocol";
import { ActionCardView, type ActionApi, type ActionCardState } from "./action-cards";
import { JarvisMark } from "./jarvis-mark";
import { ReviewCard, type CardApi, type CardState } from "./review-card";

export interface JarvisClientApi extends CardApi, ActionApi {
  send: (a: { companyId: string; text: string; intent?: string | null; enquiryId?: string | null }) => Promise<SendResult>;
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
};

type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "jarvis"; kind: "text"; text: string; tone?: "error" | "info" }
  | { id: number; role: "jarvis"; kind: "help"; help: HelpView }
  | { id: number; role: "jarvis"; kind: "card"; state: CardState; companyId: string; rev: number }
  | { id: number; role: "jarvis"; kind: "action"; actionId: string; state: ActionCardState; companyId: string; rev: number };
type NewMsg = Msg extends infer M ? (M extends { id: number } ? Omit<M, "id"> : never) : never;

const ENQUIRY_PATH = /^\/sales\/opportunities\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WELCOME = "Paste a brief and I'll turn it into an enquiry for you to review.";
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
function RouteWatcher({ onEnquiry }: { onEnquiry: (id: string | null) => void }) {
  const path = usePathname();
  const search = useSearchParams();
  const open = search?.get("open") ?? null;
  useEffect(() => {
    const fromPath = ENQUIRY_PATH.exec(path ?? "")?.[1] ?? null;
    const fromPanel = path?.startsWith("/sales/opportunities") && open && UUID.test(open) ? open : null;
    onEnquiry(fromPath ?? fromPanel);
  }, [path, open, onEnquiry]);
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
  const phone = useIsPhone();
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  const push = (m: NewMsg) => setMessages((ms) => [...ms, { ...m, id: nextId++ } as Msg]);

  async function send(raw: string) {
    const t = raw.trim();
    if (!t || busy) return;
    if (t.length > maxInputChars) { push({ role: "jarvis", kind: "text", tone: "error", text: `That is too long (${t.length} characters; the limit is ${maxInputChars}). Paste only the part that describes the job.` }); return; }
    setBusy(true);
    push({ role: "user", text: t.length > 160 ? `${t.slice(0, 160)}… (${t.length} characters)` : t });
    setText("");
    try {
      const r = await api.send({ companyId, text: t, intent: mode?.key ?? null, enquiryId: chip?.id ?? null });
      if (!r.ok) push({ role: "jarvis", kind: "text", tone: "error", text: r.message });
      else if (r.kind === "help") push({ role: "jarvis", kind: "help", help: r.help });
      else if (r.kind === "not_available") push({ role: "jarvis", kind: "text", tone: "info", text: `${r.title}: ${r.reason}` });
      else if (r.kind === "info") push({ role: "jarvis", kind: "text", tone: "info", text: r.text });
      else if (r.kind === "action") push({ role: "jarvis", kind: "action", actionId: r.actionId, state: { card: r.card, confirmation: r.confirmation }, companyId, rev: 0 });
      else push({ role: "jarvis", kind: "card", state: { card: r.card, confirmation: r.confirmation }, companyId, rev: 0 });
    } catch {
      push({ role: "jarvis", kind: "text", tone: "error", text: "JARVIS could not be reached. Sales & CRM is not affected: you can add the enquiry yourself." });
    } finally { setBusy(false); }
  }

  function changeCompany(id: string) {
    if (id === companyId) return;
    const hadCard = messages.some((m) => m.role === "jarvis" && m.kind === "card");
    setCompanyId(id);
    setNotice(`Company changed to ${nameOf(id)}.${hadCard ? ` A review made for ${nameOf(companyId)} can no longer be used: paste the brief again.` : ""}`);
  }

  return (
    <>
      <Suspense fallback={null}><RouteWatcher onEnquiry={onRouteEnquiry} /></Suspense>
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
                <div className="flex flex-wrap gap-2" role="group" aria-label="What to do">
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
                if (m.kind === "action") {
                  return (
                    <ActionCardView
                      key={`${m.id}-${m.rev}`}
                      actionId={m.actionId}
                      state={m.state}
                      companyId={m.companyId}
                      companyStale={m.companyId !== companyId}
                      api={api}
                      onState={(s) => setMessages((ms) => ms.map((x) => (x.id === m.id && x.role === "jarvis" && x.kind === "action" ? { ...x, state: s, rev: x.rev + 1 } : x)))}
                    />
                  );
                }
                return (
                  <ReviewCard
                    key={`${m.id}-${m.rev}`}
                    state={m.state}
                    companyStale={m.companyId !== companyId}
                    api={api}
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
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void send(text); } }}
                placeholder={mode?.placeholder ?? "Paste a WhatsApp message, an email or a rough brief…"}
                disabled={busy}
                className="max-h-40 resize-y"
              />
              <div className="flex items-center justify-between gap-2">
                <p className={`text-[11px] ${text.length > maxInputChars ? "text-destructive" : "text-muted-foreground"}`}>{text.length > 0 ? `${text.length} / ${maxInputChars}` : "Ctrl+Enter sends."}</p>
                <div className="flex gap-2">
                  {messages.length > 0 ? <Button type="button" size="sm" variant="ghost" aria-label="Clear conversation" onClick={() => { setMessages([]); setNotice(null); }} disabled={busy}>Clear</Button> : null}
                  <Button type="submit" size="sm" disabled={busy || text.trim() === ""}>Send</Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">JARVIS sends only what you paste (and, for an enquiry you chose, the facts needed for that task) to its AI provider. Nothing is saved until you press the confirm button on a review card. This conversation is not stored.</p>
            </form>
          </div>
        </>
      ) : null}
    </>
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
      <p className="text-xs text-muted-foreground">JARVIS never reads or changes salaries, leave, payroll, other modules, settings or permissions.</p>
    </section>
  );
}
