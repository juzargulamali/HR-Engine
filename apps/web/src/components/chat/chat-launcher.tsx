"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AtSign, MessageCircle, Users, X } from "lucide-react";
import { chatGroups } from "@/lib/actions/chat";
import { badgeText, launcherLabel, shortAgo, totalUnread, type ChatGroup } from "@/lib/chat/model";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { cn } from "@/lib/utils";
import { ChatThread } from "./chat-thread";

const POLL_MS = 30000;

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const on = () => setPhone(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/**
 * The one floating Chat button, on every page of Enginious OS. It is drawn only while the server lists at least one group for this person (membership is the server's: an active Sales
 * grant for that company), shows the total unread on the button and per group in the panel, and opens a panel over the current page (a bottom sheet on a phone), so nobody leaves what
 * they are doing. When access is removed the next refresh returns no group and the button and panel disappear. The panel is built around a list of groups; only the three Sales groups exist.
 */
export function ChatLauncher({ userId, initialGroups }: { userId: string; initialGroups: ChatGroup[] }) {
  const [groups, setGroups] = useState<ChatGroup[]>(initialGroups);
  const [open, setOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const groupsRef = useRef(initialGroups);
  const phone = useIsPhone();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, open && phone);

  const refresh = useCallback(async () => {
    const r = await chatGroups();
    if (!r.ok) return;
    const lost = groupsRef.current.filter((g) => !r.groups.some((n) => n.id === g.id));
    groupsRef.current = r.groups;
    setGroups(r.groups);
    if (lost.length > 0) setNotice(`You no longer have access to ${lost.map((g) => g.name).join(" and ")}.`);
    // a group that is no longer listed (access removed) closes its thread; no groups at all closes the panel
    setOpenGroup((cur) => (cur && r.groups.some((g) => g.id === cur) ? cur : null));
    if (r.groups.length === 0) setOpen(false);
  }, []);

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (groups.length === 0) return null;
  const total = totalUnread(groups);
  const current = groups.find((g) => g.id === openGroup) ?? null;
  const mentionTotal = groups.reduce((a, g) => a + g.mentions, 0);

  return (
    <>
      <button
        ref={buttonRef} type="button" aria-label={launcherLabel(groups)} aria-haspopup="dialog" aria-expanded={open} data-testid="chat-launcher"
        onClick={() => { setOpen((o) => !o); if (!open) void refresh(); }}
        className="fixed bottom-[9.25rem] right-3 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-pop)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:bottom-5 lg:right-5"
      >
        <MessageCircle className="h-6 w-6" aria-hidden />
        {total > 0 ? (
          <span className={cn("absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white", mentionTotal > 0 ? "bg-destructive" : "bg-accent")} data-testid="chat-total-unread">{badgeText(total)}</span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" aria-hidden onClick={() => setOpen(false)} />
          <div
            ref={panelRef} role="dialog" aria-modal={phone ? true : undefined} aria-labelledby={titleId} data-testid="chat-panel"
            className="fixed inset-x-0 bottom-0 z-[60] flex h-[92dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card text-foreground shadow-[var(--shadow-pop)] lg:inset-x-auto lg:bottom-20 lg:right-5 lg:h-[min(40rem,calc(100dvh-7rem))] lg:w-[26rem] lg:rounded-xl"
          >
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <MessageCircle className="h-5 w-5 text-primary" aria-hidden />
              <h2 id={titleId} className="flex-1 font-heading text-base font-semibold">Chat</h2>
              <button type="button" onClick={() => { setOpen(false); buttonRef.current?.focus(); }} aria-label="Close chat" className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            {current ? (
              <ChatThread key={current.id} group={current} meId={userId} onBack={() => { setOpenGroup(null); void refresh(); }} onChanged={() => void refresh()} />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto" data-testid="chat-group-list">
                {notice ? (
                  <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm" role="status" data-testid="chat-notice">
                    <span className="flex-1">{notice}</span>
                    <button type="button" onClick={() => setNotice(null)} className="text-muted-foreground underline underline-offset-2">Dismiss</button>
                  </div>
                ) : null}
                <p className="px-4 pt-3 text-xs text-muted-foreground">Groups you belong to. Membership follows your Sales access for each company.</p>
                <ul className="divide-y divide-border">
                  {groups.map((g) => (
                    <li key={g.id}>
                      <button type="button" onClick={() => setOpenGroup(g.id)} data-testid={`chat-group-${g.key}`}
                        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none">
                        <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary"><Users className="h-5 w-5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{g.name}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{shortAgo(g.lastAt)}</span></span>
                          <span className="block truncate text-xs text-muted-foreground">{g.lastPreview ? `${g.lastSender ?? ""}: ${g.lastPreview}` : "No messages yet"}</span>
                        </span>
                        {g.mentions > 0 ? <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive text-white" title="You were mentioned" data-testid="chat-group-mention"><AtSign className="h-3 w-3" aria-hidden /></span> : null}
                        {g.unread > 0 ? <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white" data-testid="chat-group-unread" aria-label={`${g.unread} unread`}>{badgeText(g.unread)}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
