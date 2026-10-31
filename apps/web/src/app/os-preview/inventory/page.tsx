"use client";

import { useState } from "react";
import { ArrowLeftRight, ClipboardList, PackageCheck, PackageOpen, Send, TriangleAlert, Undo2 } from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BUCKET_LABEL, BUCKET_ORDER, KIND_LABEL, bucketOf, locName, queueFor, type QueueItem, type QueueKind,
} from "../_lib/inventory-concept";
import { InventoryFrame, useLoc } from "../_components/inventory-bits";
import { TodaySheets } from "../_components/inventory-sheets";
import { PLink, usePreview } from "../_components/context";
import { Chip, StateGate } from "../_components/ui";

const ICON: Record<QueueKind, React.ComponentType<{ className?: string }>> = { prepare: ClipboardList, send: Send, returns: Undo2, transfer: ArrowLeftRight, sales: PackageCheck };
const FILTERS: (QueueKind | "all")[] = ["all", "prepare", "send", "returns", "transfer", "sales"];

function Row({ q, onSheet }: { q: QueueItem; onSheet: (q: QueueItem) => void }) {
  const Icon = ICON[q.kind];
  const late = bucketOf(q.when) === "late";
  const titleCls = "font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:underline";
  return (
    <li className="group relative grid gap-3 px-4 py-3.5 transition-colors focus-within:bg-secondary/40 hover:bg-secondary/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md", late ? "bg-destructive/10 text-[hsl(var(--os-bad))]" : "bg-secondary text-muted-foreground")}><Icon className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0">
          {q.action.href ? <PLink href={q.action.href} className={titleCls}>{q.title}</PLink> : <button type="button" onClick={() => onSheet(q)} className={cn(titleCls, "text-left")}>{q.title}</button>}
          <p className="text-sm text-muted-foreground">{q.forWhom}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className={cn(late && "font-medium text-[hsl(var(--os-bad))]")}>{q.whenLabel}</span>
            {q.facts.map((f) => <span key={f.text} className={cn("text-muted-foreground", f.tone === "warn" && "font-medium text-warning", f.tone === "bad" && "font-medium text-[hsl(var(--os-bad))]")}>{f.text}</span>)}
          </p>
        </div>
      </div>
      <div className="relative z-10 sm:justify-self-end">
        {q.action.href ? (
          <PLink href={q.action.href} className={cn(buttonVariants({ size: "sm" }), "h-11 w-full sm:h-9 sm:w-auto")}>{q.action.label}</PLink>
        ) : (
          <Button type="button" size="sm" onClick={() => onSheet(q)} className="h-11 w-full sm:h-9 sm:w-auto">{q.action.label}</Button>
        )}
      </div>
    </li>
  );
}

export default function Today() {
  const { loc } = useLoc();
  const { param } = usePreview();
  const [filter, setFilter] = useState<QueueKind | "all">("all");
  const [done, setDone] = useState<string[]>([]);
  const [sheet, setSheet] = useState<QueueItem | null>(null);
  const failed = param("fail") === "transfers";
  const all = queueFor(loc).filter((q) => !done.includes(q.id) && !(failed && q.kind === "transfer"));
  const rows = filter === "all" ? all : all.filter((q) => q.kind === filter);
  const count = (k: QueueKind | "all") => (k === "all" ? all.length : all.filter((q) => q.kind === k).length);
  const groups = BUCKET_ORDER.map((b) => ({ b, rows: rows.filter((q) => bucketOf(q.when) === b).sort((x, y) => (x.when ?? "").localeCompare(y.when ?? "")) })).filter((g) => g.rows.length);

  return (
    <InventoryFrame section="today" title="Today" description={`Work waiting at ${locName(loc)}. Each row is one job: open it, or press its button.`}>
      <StateGate what="today's warehouse work" emptyTitle="Nothing waiting" emptyText="No requests, returns, transfers or Sales checks are waiting for this warehouse." deniedWho="Your account has no warehouse access at this location.">
        {failed ? (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-[hsl(var(--os-bad))]">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
            <p><strong>Incoming transfers could not be loaded.</strong> The list below may be missing them; it is not an empty queue. <PLink href="/os-preview/inventory" className="underline">Try again</PLink></p>
          </div>
        ) : null}
        <div role="group" aria-label="Show" className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((k) => (
            <button
              key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", filter === k ? "border-accent bg-accent/15 font-semibold" : "border-border text-muted-foreground hover:bg-secondary/60 hover:text-foreground")}
            >{k === "all" ? "Everything" : KIND_LABEL[k]}<span className="rounded-full bg-secondary px-1.5 text-xs tabular-nums" title={failed && k === "transfer" ? "Could not be loaded" : undefined}>{failed && k === "transfer" ? "?" : count(k)}</span></button>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-12 text-center">
            <PackageOpen className="h-8 w-8 text-muted-foreground" aria-hidden />
            <h2 className="font-heading text-lg font-semibold">Nothing waiting at {locName(loc)}</h2>
            <p className="max-w-md text-sm text-muted-foreground">No requests to prepare, dispatches due, returns, incoming transfers or Sales checks. Open Stock to receive new stock or look something up.</p>
            <PLink href="/os-preview/inventory/stock" className={cn(buttonVariants({ size: "sm" }), "mt-2")}>Go to Stock</PLink>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.b} aria-labelledby={`g-${g.b}`} className="overflow-hidden rounded-lg border border-border bg-card">
                <h2 id={`g-${g.b}`} className={cn("flex items-center gap-2 border-b border-border/70 px-4 py-2 font-heading text-sm font-semibold", g.b === "late" && "text-[hsl(var(--os-bad))]")}>
                  {BUCKET_LABEL[g.b]}<Chip tone={g.b === "late" ? "bad" : "neutral"}>{g.rows.length}</Chip>
                </h2>
                <ul className="divide-y divide-border/70">{g.rows.map((q) => <Row key={q.id} q={q} onSheet={setSheet} />)}</ul>
              </section>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">Dates come from each record. A Sales check has no deadline, so it sits under “Waiting”. A check is not a reservation.</p>
      </StateGate>
      <TodaySheets item={sheet} onClose={() => setSheet(null)} onResolved={(id) => setDone((d) => [...d, id])} />
    </InventoryFrame>
  );
}
