import { Badge } from "@/components/ui/badge";
import { CONDITION_WORDS, LIFECYCLE_WORDS, TRACKING_WORDS } from "@/lib/inventory/words";
import type { InvCondition, InvLifecycle, InvTracking } from "@/types/inventory";

/** One number with its name: the "at a glance" strip of an item. */
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint ? <dd className="text-[13px] text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export const trackingLabel = (t: InvTracking) => TRACKING_WORDS[t].label;
export const conditionLabel = (c: string) => CONDITION_WORDS[c as InvCondition] ?? c;
export const lifecycleLabel = (l: string) => LIFECYCLE_WORDS[l as InvLifecycle] ?? l;

export function ConditionBadge({ condition }: { condition: string }) {
  const bad = condition === "damaged" || condition === "unserviceable";
  const hold = condition === "needs_inspection";
  return <Badge variant={bad ? "destructive" : hold ? "warning" : "secondary"}>{conditionLabel(condition)}</Badge>;
}

export function LifecycleBadge({ lifecycle }: { lifecycle: string }) {
  if (lifecycle === "active") return null;
  return <Badge variant={lifecycle === "missing" ? "destructive" : lifecycle === "retired" ? "outline" : "warning"}>{lifecycleLabel(lifecycle)}</Badge>;
}
