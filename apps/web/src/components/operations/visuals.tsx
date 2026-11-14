import { CalendarClock, CircleAlert, CircleCheck, CircleHelp, Hammer, PackageOpen, Presentation, TriangleAlert } from "lucide-react";
import { HEALTH_WORDS, TIMELINE_WORDS, type Health, type TimelineKind } from "@/lib/operations/model";
import { cn } from "@/lib/utils";

/**
 * The small visual pieces Operations shares with My Day. Colour never carries a meaning alone: every mark has its word next to it and its own icon shape, so the
 * screen reads the same in greyscale and to a screen reader.
 */
const HEALTH_STYLE: Record<Health, { icon: typeof CircleCheck; tone: string }> = {
  on_track: { icon: CircleCheck, tone: "border-[hsl(var(--os-green)/0.45)] text-[hsl(var(--os-green))]" },
  needs_attention: { icon: CircleAlert, tone: "border-[hsl(var(--os-amber)/0.5)] text-[hsl(var(--os-amber))]" },
  at_risk: { icon: TriangleAlert, tone: "border-[hsl(var(--os-red)/0.55)] text-[hsl(var(--os-red))]" },
  not_enough_info: { icon: CircleHelp, tone: "border-border text-muted-foreground" },
};
export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  const { icon: Icon, tone } = HEALTH_STYLE[health];
  return <span data-health={health} className={cn("inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium", tone, className)}><Icon className="h-3.5 w-3.5" aria-hidden />{HEALTH_WORDS[health]}</span>;
}

const KIND_STYLE: Record<TimelineKind, { icon: typeof Hammer; tone: string }> = {
  installation: { icon: Hammer, tone: "bg-accent/15 text-accent" },
  show: { icon: Presentation, tone: "bg-[hsl(var(--os-info)/0.15)] text-[hsl(var(--os-info))]" },
  dismantling: { icon: PackageOpen, tone: "bg-[hsl(var(--os-purple)/0.15)] text-[hsl(var(--os-purple))]" },
  activity: { icon: CalendarClock, tone: "bg-muted text-muted-foreground" },
};
/** Installation, show and dismantling each have their own icon, tint and word. */
export function KindMark({ kind, className }: { kind: TimelineKind; className?: string }) {
  const { icon: Icon, tone } = KIND_STYLE[kind];
  return <span data-kind={kind} className={cn("inline-flex flex-none items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] font-medium", tone, className)}><Icon className="h-3.5 w-3.5" aria-hidden />{TIMELINE_WORDS[kind]}</span>;
}

/** "5 of 6 lines ready" with a small bar. Drawn only with a real denominator; the caller passes null otherwise and nothing is drawn. */
export function ReadinessBar({ value, unit = "equipment lines ready", className }: { value: { ready: number; total: number } | null; unit?: string; className?: string }) {
  if (!value || value.total <= 0) return null;
  const pct = Math.max(0, Math.min(100, Math.round((value.ready / value.total) * 100)));
  const full = value.ready >= value.total;
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-[12.5px]", className)} data-testid="ops-readiness">
      <span className="h-1.5 w-16 flex-none overflow-hidden rounded-full bg-muted" aria-hidden><span className={cn("block h-full rounded-full", full ? "bg-[hsl(var(--os-green))]" : "bg-[hsl(var(--os-amber))]")} style={{ width: `${pct}%` }} /></span>
      <span className="text-muted-foreground"><span className="font-medium text-foreground tabular-nums">{value.ready} of {value.total}</span> {unit}</span>
    </span>
  );
}

/** One horizontal bar of a chart that is also a list: the count is printed, the bar only repeats it. */
export function CountBar({ count, max, className }: { count: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return <span className={cn("block h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted", className)} aria-hidden><span className="block h-full rounded-full bg-accent" style={{ width: count > 0 ? `max(${pct}%, 6px)` : 0 }} /></span>;
}
