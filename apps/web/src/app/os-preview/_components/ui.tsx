"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, CircleDashed, Clock, Hourglass, Info, Lock, MoreHorizontal, RefreshCw, RotateCcw, ShieldQuestion, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  type Opportunity, dueLabel, dueState, fmtDateTime, fmtDue, personName, stageLabel, type StageId, equipmentOk, coverageText, snapshot,
} from "../_lib/data";
import { usePreview, PLink } from "./context";

export type Tone = "neutral" | "info" | "good" | "warn" | "bad" | "brand";
const TONES: Record<Tone, string> = {
  neutral: "border-border bg-secondary/60 text-secondary-foreground",
  info: "border-accent/40 bg-accent/10 text-foreground",
  good: "border-success/40 bg-success/10 text-[hsl(var(--os-good))]",
  warn: "border-warning/60 bg-warning/10 text-foreground",
  bad: "border-destructive/40 bg-destructive/10 text-[hsl(var(--os-bad))]",
  brand: "border-transparent brand-gradient text-primary-foreground",
};

export function Chip({ tone = "neutral", icon: Icon, children, className }: { tone?: Tone; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {Icon ? <Icon className="h-3 w-3 flex-none" aria-hidden /> : null}
      {children}
    </span>
  );
}

const STAGE_TONE: Record<StageId, Tone> = { new: "neutral", qualified: "info", proposal_prep: "info", proposal_sent: "info", quote_sent: "info", negotiation: "brand", won: "good", lost: "bad", on_hold: "warn" };
export function StageChip({ stage }: { stage: StageId }) {
  return <Chip tone={STAGE_TONE[stage]}>{stageLabel(stage)}</Chip>;
}

export function DueChip({ dueAt, done }: { dueAt: string; done?: string }) {
  const s = dueState(dueAt, done);
  const label = dueLabel(dueAt, done);
  if (s === "done") return <Chip tone="good" icon={CheckCircle2}>{label}</Chip>;
  if (s === "overdue") return <Chip tone="bad" icon={TriangleAlert}>{label}</Chip>;
  if (s === "today") return <Chip tone="warn" icon={Clock}>{label}</Chip>;
  return <Chip tone="neutral" icon={Clock}>{label}</Chip>;
}

/** The single primary deadline: the full date and time on one line, with the overdue / due-today state beside it. */
export function Deadline({ dueAt, done, className }: { dueAt: string; done?: string; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className="text-sm font-medium">{done ? `Completed ${fmtDateTime(done)}` : fmtDue(dueAt)}</span>
      {done ? null : <DueChip dueAt={dueAt} />}
    </div>
  );
}

/** Equipment availability is a technology check, not commercial confirmation and not a stock reservation. */
export function AvailabilityChip({ o }: { o: Pick<Opportunity, "availability" | "installStart" | "eventStart" | "eventEnd" | "technologies"> }) {
  const a = o.availability;
  switch (a.state) {
    case "unverified": return <Chip tone="neutral" icon={CircleDashed}>Equipment availability not checked</Chip>;
    case "awaiting": return <Chip tone="warn" icon={Hourglass}>Equipment check requested</Chip>;
    case "unavailable": return <Chip tone="bad" icon={CircleAlert}>Equipment unavailable · alternative proposed</Chip>;
    case "confirmed":
      return a.covers && !equipmentOk(o as Opportunity)
        ? <Chip tone="warn" icon={RotateCcw}>Equipment check needs repeating</Chip>
        : <Chip tone="good" icon={CheckCircle2}>Equipment availability confirmed</Chip>;
  }
}
export function availabilityDetail(o: Pick<Opportunity, "availability" | "installStart" | "eventStart" | "eventEnd" | "technologies">): string {
  const a = o.availability;
  switch (a.state) {
    case "unverified": return "Nobody has checked whether the equipment is free for these dates.";
    case "awaiting": return `Requested by ${personName(a.requestedBy)} on ${fmtDateTime(a.requestedAt)}. Waiting for a reply.`;
    case "confirmed": return `Checked by ${personName(a.by)} on ${fmtDateTime(a.at)}. ${a.notes}`;
    case "unavailable": return `Checked by ${personName(a.by)} on ${fmtDateTime(a.at)}. Alternative: ${a.alternative}.`;
  }
}
export { coverageText, snapshot };

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span aria-hidden style={{ width: size, height: size }} className="inline-flex flex-none items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground">
      {initials}
    </span>
  );
}

export function PageHeader({ title, description, actions, eyebrow, actionsBelow, help }: { title: string; description?: string; actions?: React.ReactNode; eyebrow?: string; actionsBelow?: boolean; help?: string }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3", !actionsBelow && "sm:flex-row sm:items-end sm:justify-between")}>
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="flex items-center gap-2 break-words font-heading text-2xl font-semibold tracking-tight md:text-[1.7rem]">{title}{help ? <Hint text={help} label={`About ${title}`} /> : null}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, description, actions, children, className, flush, help }: { title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean; help?: string }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-card", className)}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/70 px-4 py-3">
          <div>
            <h2 className="flex items-center gap-1.5 font-heading text-sm font-semibold">{title}{help ? <Hint text={help} /> : null}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "neutral", href }: { label: string; value: React.ReactNode; hint?: string; tone?: "neutral" | "bad" | "warn" | "good"; href?: string }) {
  const color = { neutral: "text-foreground", bad: "text-[hsl(var(--os-bad))]", warn: "text-warning", good: "text-[hsl(var(--os-good))]" }[tone];
  const body = (
    <>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-heading text-2xl font-semibold", color)}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </>
  );
  const cls = "block rounded-lg border border-border bg-card p-3.5";
  return href ? (
    <PLink href={href} className={cn(cls, "transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{body}</PLink>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Horizontal scroller with visible previous/next buttons, so off-screen items are never only reachable by guessing. */
export function ScrollRow({ children, label, className }: { children: React.ReactNode; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);
  const by = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * Math.max(120, (ref.current?.clientWidth ?? 300) * 0.6), behavior: "smooth" });
  const btn = "absolute top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className={cn("relative", className)}>
      <div ref={ref} className="relative flex gap-1 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
      {edge.left ? <button type="button" aria-label={`Scroll ${label} left`} onClick={() => by(-1)} className={cn(btn, "left-0")}><ChevronLeft className="h-4 w-4" aria-hidden /></button> : null}
      {edge.right ? <button type="button" aria-label={`Scroll ${label} right`} onClick={() => by(1)} className={cn(btn, "right-0")}><ChevronRight className="h-4 w-4" aria-hidden /></button> : null}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: readonly { id: T; label: string }[]; value: T; onChange: (t: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => { refs.current[value]?.scrollIntoView?.({ block: "nearest", inline: "center" }); }, [value]);
  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    const target = tabs[next]!.id;
    onChange(target);
    refs.current[target]?.focus();
  }
  return (
    <div className="border-b border-border">
      <ScrollRow label="sections">
        <div role="tablist" aria-label={label} className="flex gap-1 px-1">
          {tabs.map((t, i) => (
            <button
              key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={value === t.id} aria-controls={`panel-${t.id}`}
              tabIndex={value === t.id ? 0 : -1} type="button" onClick={() => onChange(t.id)} onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                value === t.id ? "border-accent font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </ScrollRow>
    </div>
  );
}

/** Tells touch users that a table scrolls sideways. Hidden where the whole table fits. */
export function ScrollHint() {
  return <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground md:hidden"><ChevronRight className="h-3 w-3" aria-hidden />Scroll sideways to see more</p>;
}

/** A short explanation tucked behind an info button, so ordinary screens stay free of commentary. */
export function Hint({ text, label = "More information", align = "left" }: { text: string; label?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open ? (
        <span role="tooltip" id={id} className={cn("absolute top-full z-30 mt-1 w-64 max-w-[75vw] rounded-md border border-border bg-card px-3 py-2 text-xs font-normal leading-relaxed text-foreground shadow-lg", align === "right" ? "right-0" : "left-0")}>
          {text}
        </span>
      ) : null}
    </span>
  );
}

/** A small menu for the actions that are available but should not dominate daily work. */
export function ActionMenu({ label, items }: { label: string; items: { label: string; onSelect: () => void; href?: string }[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div ref={wrap} className="relative">
      <Button type="button" variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal className="h-4 w-4" aria-hidden />{label}
      </Button>
      {open ? (
        <div role="menu" aria-label={label} className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-border bg-card p-1 shadow-xl">
          {items.map((i) => i.href ? (
            <PLink key={i.label} href={i.href} role="menuitem" onClick={() => setOpen(false)} className="block rounded px-3 py-2 text-sm hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{i.label}</PLink>
          ) : (
            <button key={i.label} type="button" role="menuitem" onClick={() => { setOpen(false); i.onSelect(); }} className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{i.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Field({ label, hint, error, required, children, htmlFor, tag }: { label: string; hint?: string; error?: string | null; required?: boolean; children: React.ReactNode; htmlFor: string; tag?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm font-medium">
        {label}
        <span className="text-xs font-normal text-muted-foreground">{tag ?? (required ? "(required)" : "(optional)")}</span>
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p role="alert" className="flex items-center gap-1 text-xs text-[hsl(var(--os-bad))]"><CircleAlert className="h-3.5 w-3.5" aria-hidden />{error}</p> : null}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-border bg-card p-5 shadow-2xl sm:max-w-lg sm:rounded-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" aria-hidden /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Transient confirmation. Always says nothing was saved: this is a preview. */
export function useNotice() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div role="status" className="fixed bottom-20 left-1/2 z-[60] w-[min(92vw,28rem)] -translate-x-1/2 rounded-lg border border-accent/50 bg-card px-4 py-3 text-sm shadow-lg lg:bottom-6">
      <p className="font-medium">{msg}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Preview only: nothing was saved or sent.</p>
    </div>
  ) : null;
  return { notify: setMsg, node };
}

export function PermissionDenied({ what, who, className }: { what: string; who: string; className?: string }) {
  return (
    <div role="region" aria-label="Permission denied" className={cn("flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-12 text-center", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-muted-foreground"><Lock className="h-5 w-5" aria-hidden /></div>
      <h1 className="font-heading text-lg font-semibold">You don&apos;t have access to {what}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{who}</p>
      <p className="max-w-md text-xs text-muted-foreground">A founder can grant access.</p>
      <PLink href="/os-preview/my-day" className="mt-2 text-sm font-medium text-[hsl(var(--os-link))] underline-offset-4 hover:underline">Back to My Day</PLink>
    </div>
  );
}

export function LoadingPanel({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-5 w-48" />
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

export function ErrorPanel({ what, onRetry }: { what: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="h-6 w-6 text-[hsl(var(--os-bad))]" aria-hidden />
      <h2 className="font-heading text-base font-semibold">We couldn&apos;t load {what}</h2>
      <p className="max-w-md text-sm text-muted-foreground">Nothing you entered is lost. Try again, and if it keeps happening tell an administrator, giving them the time below.</p>
      <p className="text-xs text-muted-foreground">Sample time: 19 Oct 2026, 09:30 GST</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-1"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Try again</Button>
    </div>
  );
}

/**
 * Renders the forced `?state=` for a page: loading / empty / error / denied replace the content;
 * `overdue` and `default` pass through (pages read `state` themselves for the overdue focus).
 */
export function StateGate({ what, emptyTitle, emptyText, emptyAction, deniedWho, children }: {
  what: string; emptyTitle: string; emptyText: string; emptyAction?: React.ReactNode; deniedWho?: string; children: React.ReactNode;
}) {
  const { state } = usePreview();
  if (state === "loading") return <LoadingPanel />;
  if (state === "error") return <ErrorPanel what={what} />;
  if (state === "denied") return <PermissionDenied what={what} who={deniedWho ?? "Your account has no Sales access in this scope."} />;
  if (state === "empty") return <EmptyState icon={ShieldQuestion} title={emptyTitle} description={emptyText} action={emptyAction} />;
  return <>{children}</>;
}

/** Banner for a read-only restriction, always with the reason in words. */
export function Restriction({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
      <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden /><div>{children}</div>
    </div>
  );
}

export function OverdueBanner({ count }: { count: number }) {
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-[hsl(var(--os-bad))]">
      <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <p><strong>{count} overdue.</strong> These items passed their agreed date. Update the next action or record what happened.</p>
    </div>
  );
}
