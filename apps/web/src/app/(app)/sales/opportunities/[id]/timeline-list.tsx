"use client";

import Link from "next/link";
import { useState } from "react";
import { History, MessageSquare } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TimelineItem } from "./timeline";

const PAGE = 40;

/**
 * The enquiry's timeline with two views: All activity, and Comments and notes (only what people wrote, so the conversation can be followed without the
 * system lines). A staff entry and an app-recorded entry look different (icon, label and tint), and say who and when. Only the newest entries are put on the
 * page at first; "Show older" adds the rest.
 */
export function TimelineList({ items, initial = "all" }: { items: TimelineItem[]; initial?: "all" | "notes" }) {
  const [view, setView] = useState<"all" | "notes">(initial);
  const [shown, setShown] = useState(PAGE);
  const notes = items.filter((i) => i.type === "staff");
  const list = view === "notes" ? notes : items;
  const tab = (id: "all" | "notes", label: string, n: number) => (
    <button type="button" role="tab" aria-selected={view === id} onClick={() => { setView(id); setShown(PAGE); }}
      className={cn("inline-flex min-h-9 items-center gap-1.5 rounded px-3 text-sm font-medium", view === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {label} <span className="tabular-nums">{n}</span>
    </button>
  );
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Timeline view" className="inline-flex rounded-md border border-border p-0.5">
        {tab("all", "All activity", items.length)}
        {tab("notes", "Comments and notes", notes.length)}
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{view === "notes" ? "No call, email, meeting or note has been logged yet." : "Nothing has been recorded yet."}</p>
      ) : (
        <ol className="divide-y divide-border/70">
          {list.slice(0, shown).map((t) => (
            <li key={t.id} className={cn("flex gap-3 py-3 first:pt-0 last:pb-0", t.type === "staff" && "rounded-md bg-secondary/30 px-2")}>
              {t.type === "staff" ? <MessageSquare className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-info))]" aria-hidden /> : <History className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <OsBadge tone={t.type === "staff" ? "blue" : "quiet"}>{t.label}</OsBadge>
                  {t.type === "system" ? <span className="text-xs text-muted-foreground">recorded by the app</span> : null}
                  {t.internal ? <OsBadge tone="purple">Internal note</OsBadge> : null}
                  {t.firstResponse ? <OsBadge tone="green">First response</OsBadge> : null}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{t.text}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t.who} · {t.when}
                  {t.link ? <> · <Link href={t.link.href} className="font-medium text-foreground underline-offset-2 hover:underline">{t.link.label}</Link></> : null}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {list.length > shown ? <Button type="button" variant="outline" size="sm" onClick={() => setShown((n) => n + 200)}>Show older ({list.length - shown} more)</Button> : null}
    </div>
  );
}
