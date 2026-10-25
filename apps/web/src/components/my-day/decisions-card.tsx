import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { ActionItem } from "@/app/(app)/action-centre";
import { MyDayCard } from "./card-shell";

function Row({ item, strong }: { item: ActionItem; strong?: boolean }) {
  return (
    <li>
      <Link href={item.href} className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--primary)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <item.icon className={strong ? "h-4 w-4 flex-none text-[hsl(var(--os-amber))]" : "h-4 w-4 flex-none text-muted-foreground"} aria-hidden />
        <span className="min-w-0 flex-1 break-words">{item.label}</span>
        <span className={strong ? "os-badge" : "text-sm font-semibold tabular-nums text-muted-foreground"} data-tone={strong ? "amber" : undefined}>{item.count}</span>
        <ArrowRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

/**
 * What waits on this person: decisions first (approvals, project handovers, work to review), then the other open items of Projects.
 * Each row is a real count that links to where it is handled. The rows come from the one list the page also builds the greeting from.
 */
export function DecisionsCard({ decisions, other }: { decisions: readonly ActionItem[]; other: readonly ActionItem[] }) {
  const empty = decisions.length === 0 && other.length === 0;
  return (
    <MyDayCard id="decisions" title={decisions.length === 0 && other.length > 0 ? "Open for you" : "Needs your decision"} tone={decisions.length > 0 ? "warm" : undefined} label="Needs your decision">
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
    </MyDayCard>
  );
}
