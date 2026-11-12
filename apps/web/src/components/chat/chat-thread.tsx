"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, AtSign, Lock, Paperclip, Send, Smile, X, FileText, Building2, CalendarDays, ClipboardList } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SearchCombobox, type ComboOption } from "@/components/sales/combobox";
import { chatMarkRead, chatMembers, chatMessages, chatPost, chatSearchItems } from "@/lib/actions/chat";
import {
  membershipLine,
  OPERATIONS_READER_NOTE,
  clockTime, dayHeading, filterMembers, initials, MAX_BODY, mentionQuery, mentionsStillInText, mergeMessages, SHARE_TYPES, splitMentions,
  type ChatGroup, type ChatMention, type ChatMessage, type ShareType, type SharedItem,
} from "@/lib/chat/model";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;
const EMOJI = ["👍", "🎉", "✅", "🙏", "👀", "🔥"];
const ICON: Record<ShareType, typeof FileText> = { enquiry: ClipboardList, estimate: FileText, account: Building2, event: CalendarDays, edition: CalendarDays };

interface Pending { key: string; body: string; mentions: ChatMention[]; share: { type: ShareType; id: string; label: string } | null; status: "sending" | "failed"; error?: string }
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k${Date.now()}${Math.random().toString(16).slice(2)}`).replace(/-/g, "").slice(0, 32).padEnd(8, "0");

/** One shared item inside a message: a link when the reader may open it, otherwise only a generic placeholder (the server decides; nothing else is known here). */
function SharedCard({ item }: { item: SharedItem }) {
  if (item.restricted) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground" data-testid="chat-restricted">
        <Lock className="h-4 w-4 shrink-0" aria-hidden /> Restricted item
      </div>
    );
  }
  const Icon = ICON[item.type] ?? FileText;
  return (
    <Link href={item.href} className="mt-1 flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="chat-shared-item">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0"><span className="block break-words font-medium">{item.title}</span><span className="block break-words text-xs text-muted-foreground">{item.subtitle}</span></span>
    </Link>
  );
}

function Body({ m, meId }: { m: Pick<ChatMessage, "body" | "mentions">; meId: string }) {
  if (!m.body) return null;
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {splitMentions(m.body, m.mentions).map((part, i) => part.mention
        ? <strong key={i} className={cn("rounded px-0.5", part.mention.userId === meId ? "bg-primary/25 text-foreground" : "bg-secondary text-foreground")} data-testid={part.mention.userId === meId ? "chat-mention-me" : "chat-mention"}>{part.text}</strong>
        : <span key={i}>{part.text}</span>)}
    </p>
  );
}

export function ChatThread({ group, meId, onBack, onChanged }: { group: ChatGroup; meId: string; onBack: () => void; onChanged: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastRead, setLastRead] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [newBelow, setNewBelow] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastSeq = useRef(0);
  const markedSeq = useRef(0);
  const dividerRef = useRef<HTMLDivElement>(null);

  // composer
  const [body, setBody] = useState("");
  const [picked, setPicked] = useState<ChatMention[]>([]);
  const [members, setMembers] = useState<ChatMention[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [share, setShare] = useState<Pending["share"]>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const lost = useCallback((msg: string) => { if (/not a member/i.test(msg)) { setGone(true); onChanged(); return true; } return false; }, [onChanged]);

  const markRead = useCallback(async (seq: number) => {
    if (seq <= markedSeq.current) return;
    markedSeq.current = seq;
    const r = await chatMarkRead(group.id, seq);
    if (r.ok) onChanged();
  }, [group.id, onChanged]);

  const fetchNew = useCallback(async () => {
    const r = await chatMessages(group.id, { after: lastSeq.current });
    if (!r.ok) { lost(r.error); return; }
    if (r.messages.length === 0) return;
    lastSeq.current = Math.max(lastSeq.current, ...r.messages.map((m) => m.seq));
    setMessages((cur) => mergeMessages(cur, r.messages));
    const fromOthers = r.messages.filter((m) => m.senderId !== meId).length;
    if (atBottom.current) void markRead(lastSeq.current);
    else if (fromOthers > 0) setNewBelow((n) => n + fromOthers);
  }, [group.id, lost, markRead, meId]);

  // first page
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await chatMessages(group.id);
      if (!live) return;
      if (!r.ok) { if (!lost(r.error)) setError(r.error); setLoaded(true); return; }
      lastSeq.current = r.messages.reduce((a, m) => Math.max(a, m.seq), 0);
      setMessages(r.messages); setHasMore(r.hasMore); setLastRead(r.lastRead); setLoaded(true);
      void markRead(lastSeq.current);
    })();
    return () => { live = false; };
  }, [group.id, lost, markRead]);

  // the first time messages show: go to the "New messages" line, or the bottom
  const firstScroll = useRef(true);
  useEffect(() => {
    if (!loaded || !firstScroll.current) return;
    firstScroll.current = false;
    const el = scroller.current; if (!el) return;
    if (dividerRef.current) dividerRef.current.scrollIntoView({ block: "start" }); else el.scrollTop = el.scrollHeight;
    atBottom.current = !dividerRef.current;
  }, [loaded, messages.length]);

  // poll while the tab is visible
  useEffect(() => {
    if (!loaded || gone) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void fetchNew(); }, POLL_MS);
    return () => clearInterval(t);
  }, [loaded, gone, fetchNew]);

  // stay at the bottom when a message of mine or a new one arrives while there
  useEffect(() => { const el = scroller.current; if (el && atBottom.current && !firstScroll.current) el.scrollTop = el.scrollHeight; }, [messages.length, pending.length]);

  function onScroll() {
    const el = scroller.current; if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom.current && newBelow > 0) { setNewBelow(0); void markRead(lastSeq.current); }
  }
  const jump = () => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; atBottom.current = true; setNewBelow(0); void markRead(lastSeq.current); };

  async function loadEarlier() {
    const first = messages[0]?.seq; if (!first) return;
    const el = scroller.current; const before = el?.scrollHeight ?? 0;
    const r = await chatMessages(group.id, { before: first });
    if (!r.ok) { setError(r.error); return; }
    setMessages((cur) => mergeMessages(cur, r.messages)); setHasMore(r.hasMore);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
  }

  // members, for @mentions (only current members of this group, from the server)
  const loadMembers = useCallback(async () => {
    if (members) return members;
    const r = await chatMembers(group.id);
    const list = r.ok ? r.members.filter((m) => m.userId !== meId) : [];
    setMembers(list);
    return list;
  }, [group.id, meId, members]);
  const q = mentionQuery(body, cursor);
  const suggestions = useMemo(() => (q && members ? filterMembers(members, q.query) : []), [q, members]);
  function pickMention(m: ChatMention) {
    if (!q) return;
    const insert = `@${m.name} `;
    const next = body.slice(0, q.start) + insert + body.slice(cursor);
    setBody(next); setPicked((p) => [...p.filter((x) => x.userId !== m.userId), m]); setMentionIdx(0);
    const pos = q.start + insert.length;
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(pos, pos); setCursor(pos); });
  }
  function startMention() {
    const el = input.current; const pos = el?.selectionStart ?? body.length;
    const needsSpace = pos > 0 && !/\s/.test(body[pos - 1]!);
    const ins = `${needsSpace ? " " : ""}@`;
    void loadMembers();
    setBody(body.slice(0, pos) + ins + body.slice(pos)); const np = pos + ins.length;
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(np, np); setCursor(np); });
  }
  function addEmoji(e: string) {
    const el = input.current; const pos = el?.selectionStart ?? body.length;
    setBody(body.slice(0, pos) + e + body.slice(pos)); setEmojiOpen(false);
    requestAnimationFrame(() => { input.current?.focus(); const np = pos + e.length; input.current?.setSelectionRange(np, np); setCursor(np); });
  }

  async function submit(p: Pending) {
    const res = await chatPost({ groupId: group.id, body: p.body, mentions: p.mentions.map((m) => m.userId), share: p.share ? { type: p.share.type, id: p.share.id } : null, clientKey: p.key });
    if (res.ok) { setPending((cur) => cur.filter((x) => x.key !== p.key)); atBottom.current = true; await fetchNew(); onChanged(); return; }
    if (lost(res.error)) return;
    setPending((cur) => cur.map((x) => (x.key === p.key ? { ...x, status: "failed", error: res.error } : x)));
  }
  function send() {
    const text = body.trim();
    if ((!text && !share) || body.length > MAX_BODY) return;
    const p: Pending = { key: newKey(), body: text, mentions: mentionsStillInText(text, picked), share, status: "sending" };
    setPending((cur) => [...cur, p]); setBody(""); setPicked([]); setShare(null); setShareOpen(false); setEmojiOpen(false); setCursor(0);
    void submit(p);
  }
  const retry = (p: Pending) => { setPending((cur) => cur.map((x) => (x.key === p.key ? { ...x, status: "sending", error: undefined } : x))); void submit(p); };

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0 && q) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIdx((i) => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(suggestions[mentionIdx] ?? suggestions[0]!); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCursor(0); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  }

  // "New messages" line: before the first message from someone else after what this person had read
  const dividerSeq = useMemo(() => messages.find((m) => m.seq > lastRead && m.senderId !== meId)?.seq ?? null, [messages, lastRead, meId]);
  const headings = useMemo(() => messages.map((m, i) => { const d = dayHeading(m.createdAt); return i === 0 || d !== dayHeading(messages[i - 1]!.createdAt) ? d : null; }), [messages]);

  if (gone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-testid="chat-gone">
        <Lock className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">You no longer have access to this group.</p>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>Back to groups</Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-2 py-2">
        <button type="button" onClick={onBack} aria-label="Back to groups" className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-5 w-5" aria-hidden /></button>
        <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold" data-testid="chat-thread-title">{group.name}</h3><p className="text-xs text-muted-foreground">{membershipLine(group)}</p></div>
        {group.kind === "project" && group.projectId ? <Link href={`/projects/${group.projectId}/work`} className="mr-2 shrink-0 text-xs font-medium underline underline-offset-2" data-testid="chat-open-project">Open project</Link> : null}
      </div>
      {group.viaOperations ? <p className="border-b border-border bg-secondary/40 px-4 py-2 text-xs text-muted-foreground" role="note" data-testid="chat-operations-note">{OPERATIONS_READER_NOTE}</p> : null}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full space-y-1 overflow-y-auto px-3 py-3" aria-live="polite" aria-relevant="additions" data-testid="chat-messages">
          {!loaded ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p> : null}
          {error ? <Alert variant="destructive" role="alert">{error}</Alert> : null}
          {hasMore ? <div className="text-center"><Button type="button" size="sm" variant="ghost" onClick={() => void loadEarlier()}>Load earlier messages</Button></div> : null}
          {loaded && messages.length === 0 && pending.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground" data-testid="chat-empty">No messages yet. Say hello to the team 👋</p> : null}
          {messages.map((m, idx) => {
            const mine = m.senderId === meId;
            const heading = headings[idx] ?? null;
            return (
              <div key={m.id}>
                {heading ? <p className="my-2 text-center text-xs font-medium text-muted-foreground">{heading}</p> : null}
                {m.seq === dividerSeq ? <div ref={dividerRef} className="my-2 flex items-center gap-2 text-xs font-medium text-primary" data-testid="chat-new-divider"><span className="h-px flex-1 bg-primary/40" />New messages<span className="h-px flex-1 bg-primary/40" /></div> : null}
                <div className={cn("flex gap-2", mine && "flex-row-reverse")} data-testid="chat-message">
                  <span aria-hidden className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold">{initials(m.senderName)}</span>
                  <div className={cn("max-w-[82%] rounded-2xl px-3 py-2", mine ? "bg-primary/15" : "bg-secondary/60")}>
                    <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{mine ? "You" : m.senderName}</span> · {clockTime(m.createdAt)}</p>
                    <Body m={m} meId={meId} />
                    {m.shared ? <SharedCard item={m.shared} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
          {pending.map((p) => (
            <div key={p.key} className="flex flex-row-reverse gap-2" data-testid="chat-pending">
              <div className="max-w-[82%] rounded-2xl bg-primary/10 px-3 py-2 opacity-80">
                <Body m={{ body: p.body, mentions: p.mentions }} meId={meId} />
                {p.share ? <p className="mt-1 text-xs text-muted-foreground">Sharing: {p.share.label}</p> : null}
                {p.status === "sending" ? <p className="text-xs text-muted-foreground">Sending…</p> : (
                  <p className="text-xs text-destructive" role="alert">Not sent: {p.error} <button type="button" className="underline" onClick={() => retry(p)}>Retry</button> · <button type="button" className="underline" onClick={() => setPending((c) => c.filter((x) => x.key !== p.key))}>Discard</button></p>
                )}
              </div>
            </div>
          ))}
        </div>
        {newBelow > 0 ? (
          <button type="button" onClick={jump} className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-[var(--shadow-pop)]" data-testid="chat-jump">
            <ArrowDown className="h-3.5 w-3.5" aria-hidden /> {newBelow} new
          </button>
        ) : null}
      </div>

      {group.readOnly ? (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground" role="note" data-testid="chat-read-only">This project is finished, so its conversation is read-only.</p>
      ) : (
      <div className="border-t border-border p-2">
        {shareOpen ? <SharePicker onPick={(s) => { setShare(s); setShareOpen(false); input.current?.focus(); }} onClose={() => setShareOpen(false)} /> : null}
        {emojiOpen ? <div className="mb-2 flex gap-1" role="group" aria-label="Emoji">{EMOJI.map((e) => <button key={e} type="button" onClick={() => addEmoji(e)} className="h-10 w-10 rounded-md text-lg hover:bg-secondary/70" aria-label={`Insert ${e}`}>{e}</button>)}</div> : null}
        {share ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-secondary/40 px-2 py-1 text-sm" data-testid="chat-share-chip">
            <Paperclip className="h-4 w-4 shrink-0" aria-hidden /><span className="min-w-0 flex-1 truncate">Sharing: {share.label}</span>
            <button type="button" onClick={() => setShare(null)} aria-label="Remove shared item" className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-secondary"><X className="h-4 w-4" aria-hidden /></button>
          </div>
        ) : null}
        <div className="relative">
          {suggestions.length > 0 && q ? (
            <ul role="listbox" aria-label="Mention a member" className="absolute bottom-full left-0 z-10 mb-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-raised p-1 shadow-[var(--shadow-pop)]" data-testid="chat-mention-list">
              {suggestions.map((m, i) => (
                <li key={m.userId} role="option" aria-selected={i === mentionIdx} onMouseDown={(e) => e.preventDefault()} onClick={() => pickMention(m)}
                  className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm", i === mentionIdx && "bg-secondary")}>
                  <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold">{initials(m.name)}</span>{m.name}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-end gap-1">
            <textarea
              ref={input} value={body} rows={1} maxLength={MAX_BODY + 200} aria-label={`Message ${group.name}`} placeholder="Write a message — @ to mention"
              enterKeyHint="send"
              onChange={(e) => { setBody(e.target.value); const c = e.target.selectionStart ?? e.target.value.length; setCursor(c); setMentionIdx(0); if (mentionQuery(e.target.value, c)) void loadMembers(); }}
              onSelect={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onKeyDown={onKey}
              className="max-h-32 min-h-11 flex-1 resize-none rounded-md border border-input bg-field px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="button" onClick={send} disabled={(!body.trim() && !share) || body.length > MAX_BODY} aria-label="Send message" className="h-11 w-11 shrink-0 p-0"><Send className="h-4 w-4" aria-hidden /></Button>
          </div>
        </div>
        <div className="mt-1 flex items-center gap-1">
          <button type="button" onClick={startMention} aria-label="Mention a member" className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground"><AtSign className="h-4 w-4" aria-hidden /></button>
          <button type="button" onClick={() => { setShareOpen((o) => !o); setEmojiOpen(false); }} aria-expanded={shareOpen} className="flex h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground hover:bg-secondary/70 hover:text-foreground" data-testid="chat-share-button"><Paperclip className="h-4 w-4" aria-hidden /> Share item</button>
          <button type="button" onClick={() => { setEmojiOpen((o) => !o); setShareOpen(false); }} aria-label="Emoji" aria-expanded={emojiOpen} className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground"><Smile className="h-4 w-4" aria-hidden /></button>
          {body.length > MAX_BODY - 300 ? <span className={cn("ml-auto text-xs", body.length > MAX_BODY ? "text-destructive" : "text-muted-foreground")}>{body.length}/{MAX_BODY}</span> : null}
        </div>
      </div>
      )}
    </>
  );
}

/** The searchable Share item control: choose what kind of item, then search by name or reference. Results are the sender's own (their access); sharing and reading re-check on the server. */
function SharePicker({ onPick, onClose }: { onPick: (s: NonNullable<Pending["share"]>) => void; onClose: () => void }) {
  const [type, setType] = useState<ShareType>("enquiry");
  const [options, setOptions] = useState<ComboOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const run = useCallback((t: ShareType, text: string) => {
    const mine = ++seq.current; setBusy(true); setErr(null);
    void chatSearchItems(t, text).then((r) => {
      if (mine !== seq.current) return;
      setBusy(false);
      if (!r.ok) { setErr(r.error); setOptions([]); return; }
      setOptions(r.hits.map((h) => ({ id: h.id, label: h.label, ...(h.detail ? { detail: h.detail } : {}) })));
    });
  }, []);
  useEffect(() => {
    let live = true;
    void chatSearchItems(type, "").then((r) => {
      if (!live) return;
      if (!r.ok) { setErr(r.error); setOptions([]); return; }
      setOptions(r.hits.map((h) => ({ id: h.id, label: h.label, ...(h.detail ? { detail: h.detail } : {}) })));
    });
    return () => { live = false; };
  }, [type]);
  const hint = SHARE_TYPES.find((s) => s.type === type)?.hint ?? "";
  return (
    <div className="mb-2 space-y-2 rounded-lg border border-border bg-card p-2" data-testid="chat-share-picker">
      <div className="flex items-center gap-2">
        <label htmlFor="chat-share-type" className="text-xs font-medium">Share a</label>
        <Select id="chat-share-type" value={type} onChange={(e) => { setType(e.target.value as ShareType); setValue(""); }} className="h-9 flex-1 py-0 text-sm">
          {SHARE_TYPES.map((s) => <option key={s.type} value={s.type}>{s.label}</option>)}
        </Select>
        <button type="button" onClick={onClose} aria-label="Close share" className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary"><X className="h-4 w-4" aria-hidden /></button>
      </div>
      <SearchCombobox
        key={type} id="chat-share-search" label="Search" hint={busy ? "Searching…" : hint} options={options} value={value} placeholder={hint}
        onQueryChange={(text) => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => run(type, text), 250); }}
        onChange={(id) => { setValue(id); const o = options.find((x) => x.id === id); if (o) onPick({ type, id, label: o.label }); }}
        emptyText={() => (busy ? "Searching…" : "Nothing found you can share.")}
      />
      {err ? <Alert variant="destructive" role="alert">{err}</Alert> : null}
    </div>
  );
}
