"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/sales/action-form";
import { formatDateTime } from "@/lib/projects/format";
import { deleteProjectMessage, editProjectMessage, fetchProjectMessages, markProjectRead, postProjectMessage } from "@/lib/actions/projectsDiscussion";
import type { ProjMessageFeedRow } from "@/types/projects";
import { DialogForm } from "../changes/dialog-form";
import { connectionState, countNewFromOthers, extractMentionIds, groupThreads, highlightMentions, maxChangedAt, maxSeq, mergeMessages, nextPollDelay, type Mentionable } from "./discussion-helpers";

const MAX_LEN = 4000;

interface Props {
  projectId: string;
  me: string;
  /** PM, temporary leader or founder: may delete anyone's message. */
  canModerate: boolean;
  readOnly: boolean;
  initial: ProjMessageFeedRow[];
  hasEarlier: boolean;
  /** Everyone who can be mentioned: the project's members (founders who are not members are not offered). */
  people: Mentionable[];
}

export function DiscussionClient({ projectId, me, canModerate, readOnly, initial, hasEarlier, people }: Props) {
  const [messages, setMessages] = useState<ProjMessageFeedRow[]>(initial);
  const [failures, setFailures] = useState(0);
  const [newCount, setNewCount] = useState(0);
  const [replyTo, setReplyTo] = useState<ProjMessageFeedRow | null>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const stickNext = useRef(false);
  const messagesRef = useRef(messages);
  const cursor = useRef({ seq: maxSeq(initial), changed: maxChangedAt(initial) });
  const nonce = useRef<string | null>(null);
  const lastMarked = useRef(0);
  const didInitialScroll = useRef(false);
  const polling = useRef(false);
  const mounted = useRef(true);
  const failuresRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const names = useMemo(() => people.map((p) => p.name), [people]);
  const authorName = useCallback((m: ProjMessageFeedRow) => m.author_name ?? "Former colleague", []);

  const markReadIfSeen = useCallback(() => {
    const newest = maxSeq(messagesRef.current);
    if (document.visibilityState !== "visible" || !atBottom.current || newest <= lastMarked.current) return;
    lastMarked.current = newest;
    void markProjectRead(projectId);
  }, [projectId]);

  const schedule = useCallback(() => {
    if (!mounted.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void pollRef.current(), nextPollDelay(document.visibilityState === "visible", failuresRef.current));
  }, []);

  const poll = useCallback(async () => {
    if (!mounted.current || polling.current) return;
    polling.current = true;
    try {
      const res = await fetchProjectMessages(projectId, cursor.current.seq, cursor.current.changed);
      if (!mounted.current) return;
      if (res.error) throw new Error(res.error);
      failuresRef.current = 0;
      setFailures(0);
      if (res.messages.length > 0) {
        const before = messagesRef.current;
        const fresh = countNewFromOthers(before, res.messages, me);
        const merged = mergeMessages(before, res.messages);
        cursor.current = { seq: maxSeq(merged), changed: maxChangedAt(merged) };
        if (atBottom.current) stickNext.current = true;
        else if (fresh > 0) setNewCount((n) => n + fresh);
        messagesRef.current = merged;
        setMessages(merged);
      }
    } catch {
      failuresRef.current += 1;
      setFailures(failuresRef.current);
    } finally {
      polling.current = false;
      schedule();
    }
  }, [projectId, me, schedule]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  // Poll while mounted; when the tab becomes visible again, fetch at once. Nothing runs after unmount.
  useEffect(() => {
    mounted.current = true;
    schedule();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer.current) clearTimeout(timer.current);
        void pollRef.current();
        markReadIfSeen();
      } else {
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [schedule, markReadIfSeen]);

  // Scroll to the newest message on first load and whenever the reader was already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stickNext.current || !didInitialScroll.current) {
      el.scrollTop = el.scrollHeight;
      didInitialScroll.current = true;
      stickNext.current = false;
      atBottom.current = true;
    }
    markReadIfSeen();
  }, [messages, markReadIfSeen]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom.current) {
      setNewCount(0);
      markReadIfSeen();
    }
  };
  const jumpToNew = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setNewCount(0);
    markReadIfSeen();
  };

  const changeText = (v: string) => {
    if (v !== text) nonce.current = null; // an edited message is a different send: a retry of the unchanged text keeps its key
    setText(v);
    setPicked((p) => p.filter((x) => v.includes(`@${x.name}`)));
  };

  const addMention = (id: string) => {
    const person = people.find((p) => p.id === id);
    if (!person) return;
    setPicked((p) => (p.some((x) => x.id === id) ? p : [...p, person]));
    nonce.current = null;
    setText((t) => (t.includes(`@${person.name}`) ? t : `${t}${t && !/\s$/.test(t) ? " " : ""}@${person.name} `));
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    nonce.current ??= crypto.randomUUID();
    try {
      const res = await postProjectMessage({ projectId, body, parentId: replyTo?.id ?? null, nonce: nonce.current, mentions: extractMentionIds(body, picked) });
      if (res.error) {
        setSendError(res.error);
        return;
      }
      nonce.current = null;
      setText("");
      setPicked([]);
      setReplyTo(null);
      stickNext.current = true;
      atBottom.current = true;
      await poll();
    } catch {
      setSendError("The message could not be sent. Check your connection and press Send again: it will not be posted twice.");
    } finally {
      setSending(false);
    }
  };

  const threads = useMemo(() => groupThreads(messages), [messages]);
  const conn = connectionState(failures);
  const remaining = MAX_LEN - text.length;

  const renderMessage = (m: ProjMessageFeedRow, isReply: boolean) => {
    const mine = m.author_id === me;
    const deleted = Boolean(m.deleted_at);
    return (
      <li key={m.id} id={`msg-${m.id}`} className={isReply ? "ml-5 border-l-2 border-border pl-3 sm:ml-8" : ""}>
        <div className="rounded-md bg-secondary/40 px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="font-medium">{authorName(m)}</span>
            <time dateTime={m.created_at} className="text-[13px] text-muted-foreground">{formatDateTime(m.created_at)}</time>
            {m.edited_at && !deleted ? <Badge variant="outline" className="text-[12px] text-muted-foreground">edited</Badge> : null}
          </div>
          {deleted ? (
            <p className="mt-1 text-sm italic text-muted-foreground">Message deleted</p>
          ) : (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {highlightMentions(m.body, names).map((s, i) => (s.mention ? <span key={i} className="rounded bg-accent/20 px-0.5 font-medium">{s.text}</span> : <span key={i}>{s.text}</span>))}
            </p>
          )}
          {!deleted ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {!readOnly ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => setReplyTo(m)}>Reply</Button> : null}
              {mine && !readOnly ? (
                <DialogForm triggerLabel="Edit" triggerVariant="ghost" title="Edit your message" action={editProjectMessage} submitLabel="Save" size="sm">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="messageId" value={m.id} />
                  <Field label="Message" htmlFor={`edit-${m.id}`}><Textarea id={`edit-${m.id}`} name="body" rows={4} maxLength={MAX_LEN} required defaultValue={m.body} /></Field>
                  <p className="text-sm text-muted-foreground">The message will show an “edited” marker. Mentions made in the original stay as they were.</p>
                </DialogForm>
              ) : null}
              {(mine || canModerate) && !readOnly ? (
                <DialogForm triggerLabel="Delete" triggerVariant="ghost" title="Delete this message?" description="It is replaced by “Message deleted”. Founders can still see the original text; the deletion is recorded." action={deleteProjectMessage} submitLabel="Delete message" submitVariant="destructive">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="messageId" value={m.id} />
                  <Field label="Reason (optional)" htmlFor={`del-${m.id}`}><Textarea id={`del-${m.id}`} name="reason" rows={2} /></Field>
                </DialogForm>
              ) : null}
            </div>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      {hasEarlier ? <Alert role="status">Earlier messages are not shown here: this page loads the latest 100.</Alert> : null}
      <div className="relative">
        <div ref={scroller} onScroll={onScroll} tabIndex={0} aria-label="Project discussion messages" className="max-h-[60vh] min-h-48 overflow-y-auto rounded-md border border-border bg-card p-3">
          {threads.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No messages yet. {readOnly ? "This project is completed, so the discussion is read-only." : "Write the first one below: everyone on the project can read it."}</p>
          ) : (
            <ul className="space-y-3">
              {threads.map((t) => (
                <li key={t.root.id} className="space-y-2">
                  <ul>{renderMessage(t.root, false)}</ul>
                  {t.replies.length > 0 ? <ul className="space-y-2">{t.replies.map((r) => renderMessage(r, true))}</ul> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        {newCount > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button type="button" size="sm" className="pointer-events-auto shadow-lg" onClick={jumpToNew}>{newCount} new message{newCount === 1 ? "" : "s"}</Button>
          </div>
        ) : null}
      </div>

      {conn === "reconnecting" ? <p role="status" className="text-sm text-muted-foreground">Reconnecting… new messages will appear when the connection returns.</p> : null}
      {conn === "failed" ? <Alert variant="warning" role="status">New messages cannot be fetched right now (the connection keeps failing). What you see may be out of date. This page keeps retrying about once a minute; reload it if it does not recover.</Alert> : null}

      {readOnly ? (
        <Alert role="status">This project is completed, so its discussion is read-only. It stays readable for the people who worked on it.</Alert>
      ) : (
        <div className="space-y-2 rounded-md border border-border p-3">
          {replyTo ? (
            <div className="flex items-start justify-between gap-2 rounded-md bg-secondary/60 px-3 py-2 text-sm">
              <p className="min-w-0 break-words"><span className="font-medium">Replying to {authorName(replyTo)}:</span> <span className="text-muted-foreground">{replyTo.body.length > 120 ? `${replyTo.body.slice(0, 120)}…` : replyTo.body}</span></p>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setReplyTo(null); nonce.current = null; }}>Cancel reply</Button>
            </div>
          ) : null}
          <Field label="Message" htmlFor="disc-body">
            <Textarea id="disc-body" value={text} onChange={(e) => changeText(e.target.value)} rows={3} maxLength={MAX_LEN} placeholder="Write to the project team…" disabled={sending} />
          </Field>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full sm:w-64">
              <label htmlFor="disc-mention" className="sr-only">Mention someone</label>
              <Select id="disc-mention" value="" onChange={(e) => addMention(e.target.value)} disabled={sending || people.length === 0}>
                <option value="">Mention someone…</option>
                {people.filter((p) => p.id !== me).map((p) => <option key={p.id} value={p.id}>@{p.name}</option>)}
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <span className={remaining < 200 ? "text-sm text-destructive" : "text-sm text-muted-foreground"} aria-live="polite">{remaining} characters left</span>
              <Button type="button" onClick={send} disabled={sending || text.trim().length === 0}>{sending ? "Sending…" : sendError ? "Retry send" : "Send"}</Button>
            </div>
          </div>
          {sendError ? <Alert variant="destructive" role="alert">{sendError}</Alert> : null}
        </div>
      )}
    </div>
  );
}
