import Link from "next/link";
import { ArrowRight, CheckCircle2, TriangleAlert } from "lucide-react";
import type { ActionItem } from "@/app/(app)/action-centre";
import { ATTENTION_LIST_ID, type Attention, type AttentionError, type AttentionItem } from "@/lib/my-day/attention";
import { MyDayCard } from "./card-shell";

function Row({ item }: { item: ActionItem }) {
  if (item.error) {
    return (
      <li>
        <Link href={item.href} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <TriangleAlert className="h-4 w-4 flex-none" aria-hidden />
          <span className="min-w-0 flex-1 break-words">{item.label}. Open it to try again.</span>
          <span className="text-sm font-semibold tabular-nums" aria-label="Could not be loaded">—</span>
        </Link>
      </li>
    );
  }
  return (
    <li>
      <Link href={item.href} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--primary)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <item.icon className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 break-words">
          {item.label}
          {item.detail ? <span className="block text-[13px] text-muted-foreground">{item.detail}</span> : null}
        </span>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">{item.count}</span>
        <ArrowRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const urgent = item.tier === 0;
  const meta = [item.what, item.context].filter(Boolean).join(" · ");
  return (
    <li data-attention-key={item.key}>
      <Link href={item.href} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--primary)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <item.icon className={urgent ? "h-4 w-4 flex-none text-destructive" : "h-4 w-4 flex-none text-[hsl(var(--os-amber))]"} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block break-words font-medium">{item.title}</span>
          <span className="block break-words text-[13px] text-muted-foreground">{meta}</span>
          {item.when ? <span className={urgent ? "block break-words text-[13px] font-medium text-destructive" : "block break-words text-[13px] text-muted-foreground"}>{item.when}</span> : null}
          {item.also.length > 0 ? <span className="block break-words text-[13px] text-muted-foreground">Also: {item.also.join("; ")}</span> : null}
        </span>
        {item.records !== undefined ? <span className="os-badge" data-tone="amber" aria-label={`${item.records} records`}>{item.records}</span> : null}
        <ArrowRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

/** A part of "Needs me" that could not be read: it is named, so a missing item is never mistaken for "nothing to do". */
function ErrorRow({ error }: { error: AttentionError }) {
  return (
    <li>
      <Link href="/" className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <TriangleAlert className="h-4 w-4 flex-none" aria-hidden />
        <span className="min-w-0 flex-1 break-words">{error.label} could not be loaded. Reload to try again.</span>
        <span className="text-sm font-semibold tabular-nums" aria-label="Could not be loaded">—</span>
      </Link>
    </li>
  );
}

/**
 * "Needs me": THE list of what waits on this person. The headline under the greeting links here and its number is this list's length (both come from the same
 * `Attention`, built once): overdue and due-today first, then the rest by how long they have waited; each row names the record, the project or person, how late
 * or how long, and links to where it is handled. A part that could not be loaded is its own error row. "Also open" is information that is not an action
 * (not counted). "Waiting on others" is what the person submitted themselves, still with someone else: never counted as something for them to do.
 */
export function DecisionsCard({ attention, other = [], waiting = [] }: { attention: Attention; other?: readonly ActionItem[]; waiting?: readonly ActionItem[] }) {
  const { items, errors } = attention;
  const empty = items.length === 0 && errors.length === 0;
  return (
    <MyDayCard id={ATTENTION_LIST_ID} title="Needs me" tone={items.length > 0 ? "warm" : undefined} label="Needs me" actions={items.length > 0 ? <span className="os-badge" data-tone="amber">{items.length}</span> : undefined}>
      <p className="mb-2 text-sm text-muted-foreground" data-attention-headline>{attention.headline.text}</p>
      {empty ? (
        <p className="flex items-start gap-2.5 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-green))]" aria-hidden />Anything that needs you will be listed here.</p>
      ) : (
        <div className="space-y-3">
          {items.length > 0 ? <ol className="-mx-2 divide-y divide-border/60" aria-label="Items that need your attention">{items.map((i) => <AttentionRow key={i.key} item={i} />)}</ol> : null}
          {errors.length > 0 ? <ul className="-mx-2 divide-y divide-border/60" aria-label="Parts that could not be loaded">{errors.map((e) => <ErrorRow key={e.source} error={e} />)}</ul> : null}
        </div>
      )}
      {other.length > 0 ? (
        <div className="mt-3 border-t border-border/60 pt-2">
          <h3 className="mb-0.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Also open</h3>
          <ul className="-mx-2 divide-y divide-border/60">{other.map((i) => <Row key={i.key} item={i} />)}</ul>
        </div>
      ) : null}
      {waiting.length > 0 ? (
        <div className={empty && other.length === 0 ? "mt-3" : "mt-3 border-t border-border/60 pt-2"}>
          <h3 className="mb-0.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Waiting on others</h3>
          <ul className="-mx-2 divide-y divide-border/60">{waiting.map((i) => <Row key={i.key} item={i} />)}</ul>
        </div>
      ) : null}
    </MyDayCard>
  );
}
