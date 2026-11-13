import Link from "next/link";
import { OsBadge } from "@/components/os/pills";
import { Muted } from "@/components/projects/parts";
import { barPosition, dayIndex, formatSpan, type TimelineModel, type TimelineRow, type TimelineScale, type Tone } from "@/lib/projects/delivery-plan/insights";
import { cn } from "@/lib/utils";

const BAR: Record<Tone, string> = {
  quiet: "bg-muted-foreground/55", blue: "bg-[hsl(var(--os-info))]", amber: "bg-[hsl(var(--os-amber))]", green: "bg-[hsl(var(--os-green))]", red: "bg-[hsl(var(--os-red))]",
};
const OUTLINE: Record<Tone, string> = {
  quiet: "border-muted-foreground", blue: "border-[hsl(var(--os-info))]", amber: "border-[hsl(var(--os-amber))]", green: "border-[hsl(var(--os-green))]", red: "border-[hsl(var(--os-red))]",
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
const dayNum = (iso: string) => Number(iso.slice(8, 10));
const monthOf = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]!;
const full = (iso: string) => `${dayNum(iso)} ${monthOf(iso)} ${iso.slice(0, 4)}`;

/** A subtle gridline for each day (short schedules) or each week (long ones), drawn as one background so every row lines up with the header. */
const gridStyle = (scale: TimelineScale): React.CSSProperties => {
  const n = scale.days.length, step = scale.mode === "day" ? 1 : 7;
  return { backgroundImage: "linear-gradient(to right, hsl(var(--border) / 0.8) 1px, transparent 1px)", backgroundSize: `${(step / n) * 100}% 100%` };
};

function Bar({ row, scale }: { row: TimelineRow; scale: TimelineScale }) {
  const pos = barPosition(scale, row.start, row.due);
  if (!pos) return <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground" data-testid={`tl-nodates-${row.key}`}>No dates</span>;
  const marker = row.shape === "due" || row.shape === "start";                    // only one date recorded: an outlined one-day marker, not a range
  return (
    <span
      data-testid={`tl-bar-${row.key}`} data-shape={row.shape} data-start={row.start ?? ""} data-due={row.due ?? ""}
      className={cn("absolute top-1/2 -translate-y-1/2 rounded-sm", row.kind === "activation" ? "h-2.5 opacity-70" : "h-4", marker ? cn("border-2 bg-transparent", OUTLINE[row.tone]) : BAR[row.tone], row.blocked && "ring-2 ring-[hsl(var(--os-red))]")}
      style={{ left: `calc(${pos.left}% + 1px)`, width: `calc(${pos.width}% - 2px)` }}
    />
  );
}

/**
 * The Timeline: technologies / activations and their requirements on the left, dates across, drawn from the SAME plan records as the Breakdown (a released line takes its
 * dates and status from its task; a draft takes the plan's effective dates). A short schedule gets a labelled column and gridline for every day with bars aligned to those columns;
 * a long one gets weekly labels. Either way each row says its exact dates in words ("14–16 Nov", "Due 16 Nov", "No dates") in the left column, which stays in view while the chart
 * scrolls sideways, so nothing has to be read off a bar or hovered. Work with no dates is also listed under the chart. Read-only: dates change in the Breakdown or on the task.
 */
export function PlanTimeline({ projectId, model, today }: { projectId: string; model: TimelineModel; today: string }) {
  if (model.rows.length === 0) return <Muted>Nothing to draw yet: add a technology or activation first.</Muted>;
  const scale = model.scale;
  const todayIdx = scale ? dayIndex(scale, today) : -1;
  const n = scale?.days.length ?? 1;
  const cols = "grid-cols-[10rem_minmax(0,1fr)] sm:grid-cols-[16rem_minmax(0,1fr)]";
  return (
    <div className="space-y-3" data-testid="plan-timeline" data-mode={scale?.mode ?? "none"}>
      {!scale ? <Muted>None of this work has a start or due date yet, so there is nothing to draw across. It is listed below.</Muted> : null}
      <div className="overflow-x-auto rounded-md border border-border" data-testid="tl-scroll">
        <div className="min-w-[calc(10rem+var(--tl-chart))] sm:min-w-[calc(16rem+var(--tl-chart))]" style={{ "--tl-chart": `${scale?.widthPx ?? 560}px` } as React.CSSProperties}>
          <div className={cn("grid border-b border-border bg-muted text-[12px] font-semibold text-muted-foreground", cols)}>
            <div className="sticky left-0 z-20 border-r border-border bg-muted px-3 py-2">Activation / requirement, with its dates</div>
            <div className="relative h-14" data-testid="tl-header">
              {scale?.labels.map((l) => {
                const dayMode = scale.mode === "day";
                const first = l.index === 0 || dayNum(l.date) === 1;
                return (
                  <span key={l.date} data-testid={`tl-col-${l.date}`} title={full(l.date)}
                    className="absolute inset-y-0 flex flex-col items-center justify-center border-l border-border/80 text-center leading-tight"
                    style={{ left: `${(l.index / n) * 100}%`, width: dayMode ? `${100 / n}%` : "auto", minWidth: dayMode ? undefined : "4.5rem", paddingLeft: dayMode ? 0 : "0.25rem", alignItems: dayMode ? "center" : "flex-start" }}>
                    {dayMode ? (
                      <>
                        <span className="text-[11px] font-normal">{weekday(l.date)}</span>
                        <span className="text-[13px] text-foreground">{dayNum(l.date)}</span>
                        <span className="text-[11px] font-normal">{first ? monthOf(l.date) : " "}</span>
                      </>
                    ) : (
                      <span className="text-[12px] text-foreground">{dayNum(l.date)} {monthOf(l.date)}{l.index === 0 || (l.date.slice(5, 7) === "01" && dayNum(l.date) <= 7) ? ` ${l.date.slice(0, 4)}` : ""}</span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
          <ul>
            {model.rows.map((r) => (
              <li key={r.key} className={cn("grid border-b border-border/70 last:border-b-0", cols, r.kind === "activation" && "bg-muted/40")} data-testid={`tl-row-${r.kind}`}>
                <div className={cn("sticky left-0 z-10 min-w-0 border-r border-border px-3 py-2", r.kind === "activation" ? "bg-muted" : "bg-card", r.kind === "line" && "pl-5 sm:pl-7")}>
                  <Link href={`/projects/${projectId}/delivery?open=${r.itemKey}#${r.anchor}`} className={cn("block break-words text-sm underline-offset-2 hover:underline", r.kind === "activation" ? "font-semibold" : "")}>{r.label}</Link>
                  <p className="break-words text-[12px] text-muted-foreground">{r.sub}</p>
                  <p className="mt-0.5 break-words text-[13px] font-medium" data-testid={`tl-dates-${r.key}`}>
                    {formatSpan(r.start, r.due, today)}
                    {r.inherited ? <span className="font-normal text-muted-foreground"> (the activation&apos;s date)</span> : null}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <OsBadge tone={r.tone === "quiet" ? "quiet" : r.tone} className="whitespace-normal! text-left">{r.status}</OsBadge>
                    {r.late ? <OsBadge tone="red" className="whitespace-normal! text-left">Late: {r.late}</OsBadge> : null}
                  </div>
                </div>
                <div className="relative min-h-[3.5rem]" style={scale ? gridStyle(scale) : undefined} role="img"
                  aria-label={`${r.label}: ${formatSpan(r.start, r.due, today)}`}>
                  {scale && todayIdx >= 0 ? <span className="absolute inset-y-0 bg-[hsl(var(--os-red)/0.10)]" style={{ left: `${(todayIdx / n) * 100}%`, width: `${100 / n}%` }} aria-hidden title="Today" /> : null}
                  {scale ? <Bar row={r} scale={scale} /> : <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">No dates</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {model.unscheduled.length > 0 ? (
        <section aria-label="Unscheduled work" data-testid="tl-unscheduled" className="rounded-md border border-dashed border-border p-3">
          <h3 className="text-sm font-semibold">Unscheduled ({model.unscheduled.length})</h3>
          <p className="text-[13px] text-muted-foreground">No start or due date, on the requirement or its activation. Give each a date in the Breakdown.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {model.unscheduled.map((r) => <li key={r.key}><Link href={`/projects/${projectId}/delivery?open=${r.itemKey}#${r.anchor}`} className="underline-offset-2 hover:underline">{r.label}</Link> <span className="text-muted-foreground">· {r.sub}</span></li>)}
          </ul>
        </section>
      ) : null}
      <p className="text-[13px] text-muted-foreground">
        {scale?.mode === "day" ? "Every day is a column; the shaded column is today. " : scale ? "Labels are weekly; each row states its exact dates. The shaded column is today. " : ""}
        A bar is a range, an outlined marker is a single recorded date (a due date or a start date). Dates come from the task once a requirement is released, and from the plan before; a requirement without a due date of its own shows its activation&apos;s. Calendar days, as everywhere in Projects.
      </p>
    </div>
  );
}
