"use client";

import Link from "next/link";
import { useState } from "react";
import { History, MessageSquare } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TimelineItem } from "./timeline";

const PAGE = 40;
/** An entry longer than this (or with more than four lines) starts folded, with "Show more". */
const LONG_CHARS = 280;
const LONG_LINES = 4;
export const isLongEntry = (text: string) => text.length > LONG_CHARS || text.split("\n").length > LONG_LINES;

export type TimelineFilter = "all" | "people" | "system";

function Entry({ t }: { t: TimelineItem }) {
  const long = isLongEntry(t.text);
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("flex gap-3 py-3 first:pt-0 last:pb-0", t.type === "staff" && "rounded-md bg-secondary/30 px-2")}>
      {t.type === "staff" ? <MessageSquare className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-info))]" aria-hidden /> : <History className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <OsBadge tone={t.type === "staff" ? "blue" : "quiet"}>{t.label}</OsBadge>
          {t.type === "system" ? <span className="text-xs text-muted-foreground">recorded by the app</span> : null}
          {t.internal ? <OsBadge tone="purple">Internal note</OsBadge> : null}
          {t.firstResponse ? <OsBadge tone="green">First response</OsBadge> : null}
        </div>
        <p className={cn("mt-1 whitespace-pre-wrap break-words text-sm", long && !open && "line-clamp-4")}>{t.text}</p>
        {long ? <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="mt-0.5 rounded text-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{open ? "Show less" : "Show more"}</button> : null}
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t.who} · {t.when}
          {t.link ? <> · <Link href={t.link.href} className="font-medium text-foreground underline-offset-2 hover:underline">{t.link.label}</Link></> : null}
        </p>
      </div>
    </li>
  );
}

/**
 * The enquiry's timeline, filterable: All, People's updates (what people wrote: calls, emails, meetings, notes, client responses and completed follow-ups, so
 * the conversation can be followed without the system lines) and System (what the app recorded: stage and owner changes, follow-ups planned or cancelled,
 * estimates and proposals recorded, files, handover). A person's entry and an app-recorded one look different (icon, label and tint) and say who and when.
 * A long entry starts folded. Only the newest entries are put on the page at first; "Show older" adds the rest.
 */
export function TimelineList({ items, initial = "all" }: { items: TimelineItem[]; initial?: TimelineFilter }) {
  const [view, setView] = useState<TimelineFilter>(initial);
  const [shown, setShown] = useState(PAGE);
  const people = items.filter((i) => i.type === "staff");
  const system = items.filter((i) => i.type === "system");
  const list = view === "people" ? people : view === "system" ? system : items;
  const tab = (id: TimelineFilter, label: string, n: number) => (
    <button type="button" role="tab" aria-selected={view === id} onClick={() => { setView(id); setShown(PAGE); }}
      className={cn("inline-flex min-h-9 items-center gap-1.5 rounded px-3 text-sm font-medium", view === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {label} <span className="tabular-nums">{n}</span>
    </button>
  );
  const empty = view === "people" ? "No call, email, meeting or note has been logged yet." : view === "system" ? "The app has recorded nothing yet." : "Nothing has been recorded yet.";
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Show in the timeline" className="inline-flex max-w-full flex-wrap rounded-md border border-border p-0.5">
        {tab("all", "All", items.length)}
        {tab("people", "People's updates", people.length)}
        {tab("system", "System", system.length)}
      </div>
      {list.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ol className="divide-y divide-border/70">{list.slice(0, shown).map((t) => <Entry key={t.id} t={t} />)}</ol>}
      {list.length > shown ? <Button type="button" variant="outline" size="sm" onClick={() => setShown((n) => n + 200)}>Show older ({list.length - shown} more)</Button> : null}
    </div>
  );
}
