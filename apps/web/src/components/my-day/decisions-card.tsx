import Link from "next/link";
import { ArrowRight, CheckCircle2, TriangleAlert } from "lucide-react";
import type { ActionItem } from "@/app/(app)/action-centre";
import { MyDayCard } from "./card-shell";

function Row({ item, strong }: { item: ActionItem; strong?: boolean }) {
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
        <item.icon className={strong ? "h-4 w-4 flex-none text-[hsl(var(--os-amber))]" : "h-4 w-4 flex-none text-muted-foreground"} aria-hidden />
        <span className="min-w-0 flex-1 break-words">
          {item.label}
          {item.detail ? <span className="block text-[13px] text-muted-foreground">{item.detail}</span> : null}
        </span>
        <span className={strong ? "os-badge" : "text-sm font-semibold tabular-nums text-muted-foreground"} data-tone={strong ? "amber" : undefined}>{item.count}</span>
        <ArrowRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

/**
 * "Needs me": the one list of what waits on this person: decisions first (approvals, budget steps, project handovers, scope changes, work to review),
 * then the other open items. Each row is a real count that links to where it is handled, from the one list the greeting is also built from.
 * "Waiting on others" is the second list: what the person submitted themselves, still with someone else. Those are never counted as decisions for them.
 * A source that could not be read is its own error row in the list it belongs to.
 */
export function DecisionsCard({ decisions, other, waiting = [] }: { decisions: readonly ActionItem[]; other: readonly ActionItem[]; waiting?: readonly ActionItem[] }) {
  const empty = decisions.length === 0 && other.length === 0;
  return (
    <MyDayCard id="decisions" title="Needs me" tone={decisions.some((d) => !d.error) ? "warm" : undefined} label="Needs me">
      {empty ? (
        <p className="flex items-start gap-2.5 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-green))]" aria-hidden />Nothing is waiting on you. New approvals, handovers and reviews show up here.</p>
      ) : (
        <div className="space-y-3">
          {decisions.length > 0 ? <ul className="-mx-2 divide-y divide-border/60">{decisions.map((i) => <Row key={i.key} item={i} strong />)}</ul> : null}
          {other.length > 0 ? (
            <div>
              {decisions.length > 0 ? <h3 className="mb-0.5 mt-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Also open</h3> : null}
              <ul className="-mx-2 divide-y divide-border/60">{other.map((i) => <Row key={i.key} item={i} />)}</ul>
            </div>
          ) : null}
        </div>
      )}
      {waiting.length > 0 ? (
        <div className={empty ? "mt-3" : "mt-3 border-t border-border/60 pt-2"}>
          <h3 className="mb-0.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Waiting on others</h3>
          <ul className="-mx-2 divide-y divide-border/60">{waiting.map((i) => <Row key={i.key} item={i} />)}</ul>
        </div>
      ) : null}
    </MyDayCard>
  );
}
