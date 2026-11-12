import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { HealthBadge, KindMark } from "@/components/operations/visuals";
import type { OpsDaySummary } from "@/lib/my-day/operations";
import { dateText } from "@/lib/projects/format";
import { cardLink, MyDayCard } from "./card-shell";

const inDays = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);

/**
 * Operations on My Day, for people with Operations access only: how many recorded situations wait for a decision, the next few installations and the most
 * urgent recorded issue with its owner named. Each part opens the record or the matching part of Operations. Oversight, not a to-do list: what the person can
 * act on themselves is in "What needs my attention". A company whose read failed is named; its figures are never shown as zero.
 */
export function OperationsSummary({ summary }: { summary: OpsDaySummary | "error" }) {
  const actions = <Link href="/operations" className={cardLink}>Open Operations</Link>;
  if (summary === "error") {
    return <MyDayCard title="Operations" actions={actions}><p role="status" className="flex items-start gap-2 text-sm text-destructive"><TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />Operations could not be loaded right now. Reload in a moment.</p></MyDayCard>;
  }
  const s = summary;
  return (
    <MyDayCard title="Operations" actions={actions} tone="cool" label="Operations summary">
      {s.failed.length > 0 ? <p role="status" className="mb-3 flex items-start gap-2 text-[13px] text-destructive"><TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />Operations for {s.failed.join(", ")} could not be loaded, so {s.decisions === null ? "nothing is counted" : "it is not counted below"}. Reload in a moment.</p> : null}
      <div className="grid gap-x-6 gap-y-4 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,1.3fr)]" data-testid="my-day-operations">
        <div className="min-w-0">
          <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Waiting for a decision</h3>
          <Link href={s.decisionsHref} className="group mt-1 flex items-baseline gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="my-day-ops-decisions">
            <span className="font-heading text-3xl font-semibold leading-none tabular-nums">{s.decisions ?? "—"}</span>
            <span className="text-sm text-muted-foreground group-hover:text-foreground">{s.decisions === null ? "could not be loaded" : s.decisions === 1 ? "recorded situation" : "recorded situations"}</span>
            <ArrowRight className="h-4 w-4 flex-none self-center text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Across Operations, each with its owner. Yours are in the list below.</p>
        </div>
        <div className="min-w-0">
          <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Next installations</h3>
          {s.decisions === null ? <p className="mt-1 text-sm text-muted-foreground">Could not be loaded.</p> : s.installations.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">None recorded in the next 14 days.</p> : (
            <ul className="mt-1 space-y-1.5">
              {s.installations.map((i) => (
                <li key={i.key} className="text-sm">
                  <Link href={i.href} className="break-words font-medium underline-offset-4 hover:underline">{i.title}</Link>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground"><KindMark kind={i.by} />{dateText(i.date)} ({inDays(i.inDays)}) · {i.pm}<HealthBadge health={i.health} /></span>
                </li>
              ))}
              {s.installationsTotal > s.installations.length ? <li className="text-[13px] text-muted-foreground">and {s.installationsTotal - s.installations.length} more in Operations</li> : null}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Most urgent issue</h3>
          {s.decisions === null ? <p className="mt-1 text-sm text-muted-foreground">Could not be loaded.</p> : !s.urgent ? <p className="mt-1 text-sm text-muted-foreground">Nothing recorded needs a decision.</p> : (
            <Link href={s.urgent.href} className="group mt-1 block rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="my-day-ops-urgent">
              <span className="os-badge" data-tone="amber">{s.urgent.label}</span>
              <span className="mt-1 block break-words font-medium group-hover:underline">{s.urgent.title}</span>
              <span className="block break-words text-[13px] text-muted-foreground">{s.urgent.detail}</span>
              <span className="block text-[13px]">With <span className="font-medium">{s.urgent.owner}</span></span>
            </Link>
          )}
        </div>
      </div>
    </MyDayCard>
  );
}
