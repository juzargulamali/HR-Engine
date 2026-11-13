import Link from "next/link";
import { OsBadge } from "@/components/os/pills";
import { Muted } from "@/components/projects/parts";
import { barPosition, type TimelineModel, type Tone } from "@/lib/projects/delivery-plan/insights";
import { dateText } from "@/lib/projects/format";
import { cn } from "@/lib/utils";

const BAR: Record<Tone, string> = {
  quiet: "bg-muted-foreground/45", blue: "bg-[hsl(var(--os-info))]", amber: "bg-[hsl(var(--os-amber))]", green: "bg-[hsl(var(--os-green))]", red: "bg-[hsl(var(--os-red))]",
};

/**
 * The Timeline: technologies / activations and their requirements on the left, dates across, drawn from the SAME plan records as the Breakdown (a released line takes its dates
 * and status from its task). Work with no dates is listed under the chart, never left out. Read-only: dates are changed in the Breakdown or on the task.
 */
export function PlanTimeline({ projectId, model, today }: { projectId: string; model: TimelineModel; today: string }) {
  if (model.rows.length === 0) return <Muted>Nothing to draw yet: add a technology or activation first.</Muted>;
  const range = model.range;
  const todayPos = range ? barPosition(range, today, today) : null;
  const inRange = range && today >= range.start && today <= range.end;
  return (
    <div className="space-y-3" data-testid="plan-timeline">
      {!range ? <Muted>None of this work has a start or due date yet, so there is nothing to draw across. It is listed below.</Muted> : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)] border-b border-border bg-muted/40 text-[12px] font-semibold text-muted-foreground">
            <div className="px-3 py-1.5">Activation / requirement</div>
            <div className="relative h-8" aria-hidden>
              {model.ticks.map((t) => <span key={t.date} className="absolute top-1.5 -translate-x-0 whitespace-nowrap pl-1" style={{ left: `${t.pct}%` }}>{dateText(t.date)}</span>)}
            </div>
          </div>
          <ul>
            {model.rows.map((r) => {
              const pos = range ? barPosition(range, r.start, r.due) : null;
              return (
                <li key={r.key} className={cn("grid grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)] border-b border-border/70 last:border-b-0", r.kind === "activation" && "bg-muted/30")} data-testid={`tl-row-${r.kind}`}>
                  <div className={cn("min-w-0 px-3 py-2", r.kind === "line" && "pl-7")}>
                    <Link href={`/projects/${projectId}/delivery?open=${r.itemKey}#${r.anchor}`} className={cn("block break-words text-sm underline-offset-2 hover:underline", r.kind === "activation" ? "font-semibold" : "")}>{r.label}</Link>
                    <p className="break-words text-[12px] text-muted-foreground">{r.sub}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <OsBadge tone={r.tone === "quiet" ? "quiet" : r.tone} className="whitespace-normal! text-left">{r.status}</OsBadge>
                      {r.late ? <OsBadge tone="red" className="whitespace-normal! text-left">Late: {r.late}</OsBadge> : null}
                    </div>
                  </div>
                  <div className="relative min-h-[3.25rem] py-2" role="img" aria-label={`${r.label}: ${r.start ? dateText(r.start) : "no start"} to ${r.due ? dateText(r.due) : "no due date"}`}>
                    {model.ticks.map((t) => <span key={t.date} className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${t.pct}%` }} aria-hidden />)}
                    {inRange && todayPos ? <span className="absolute inset-y-0 w-0.5 bg-[hsl(var(--os-red))]/60" style={{ left: `${todayPos.left}%` }} aria-hidden title="Today" /> : null}
                    {pos ? (
                      <span className={cn("absolute top-1/2 h-3 -translate-y-1/2 rounded-sm", BAR[r.tone], r.kind === "activation" && "h-2 opacity-70", r.blocked && "ring-2 ring-[hsl(var(--os-red))]")} style={{ left: `${pos.left}%`, width: `${pos.width}%` }} />
                    ) : <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">No dates</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {model.unscheduled.length > 0 ? (
        <section aria-label="Unscheduled work" data-testid="tl-unscheduled" className="rounded-md border border-dashed border-border p-3">
          <h3 className="text-sm font-semibold">Unscheduled ({model.unscheduled.length})</h3>
          <p className="text-[13px] text-muted-foreground">No planned start or due date yet. Give each a date in the Breakdown.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {model.unscheduled.map((r) => <li key={r.key}><Link href={`/projects/${projectId}/delivery?open=${r.itemKey}#${r.anchor}`} className="underline-offset-2 hover:underline">{r.label}</Link> <span className="text-muted-foreground">· {r.sub}</span></li>)}
          </ul>
        </section>
      ) : null}
      <p className="text-[13px] text-muted-foreground">{inRange ? "The red line is today. " : ""}Bars take their dates from the task once a requirement is released, and from the plan before. Dates are calendar days, as everywhere in Projects.</p>
    </div>
  );
}
