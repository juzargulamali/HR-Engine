import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliveryBar, DeliveryMark, DeliveryRow, DeliveryWeek } from "@/lib/my-day/portfolio";
import { cardLink, MyDayCard } from "./card-shell";

const dayName = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(new Date(`${iso}T00:00:00Z`));
const dayDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00Z`));

const BAR_STYLE: Record<DeliveryBar["status"], string> = {
  in_progress: "bg-[hsl(var(--fill-teal))] text-[hsl(var(--primary-foreground))] border-transparent",
  planned: "bg-[hsl(var(--fill-blue)/0.22)] text-foreground border-[hsl(var(--fill-blue)/0.6)]",
  done: "bg-[hsl(var(--foreground)/0.08)] text-muted-foreground border-border line-through decoration-[hsl(var(--muted-foreground)/0.5)]",
};
const BAR_WORDS: Record<DeliveryBar["status"], string> = { in_progress: "in progress", planned: "planned", done: "done" };
const MARK_STYLE: Record<DeliveryMark["state"], string> = { open: "bg-[hsl(var(--fill-amber))]", late: "bg-[hsl(var(--fill-red))]", done: "bg-[hsl(var(--fill-green))]" };
const MARK_WORDS: Record<DeliveryMark["state"], string> = { open: "due", late: "overdue", done: "accepted" };

/**
 * The week's delivery for the live projects the viewer may see in detail: each project's delivery-plan items as bars over Monday to Sunday and
 * its milestones due this week as diamonds, with a line for today. Only what is actually scheduled in the plan is drawn; a project with
 * nothing scheduled this week is not listed. A phone gets the same facts as a list, since seven day columns do not fit.
 */
export function DeliveryWeekCard({ week }: { week: DeliveryWeek | "error" }) {
  const actions = <Link href="/projects" className={cardLink}>View projects</Link>;
  if (week === "error") return <MyDayCard title="Delivery this week" actions={actions}><p className="text-sm text-muted-foreground">The delivery plan could not be loaded right now. Reload in a moment.</p></MyDayCard>;
  if (week.rows.length === 0) {
    return (
      <MyDayCard title="Delivery this week" actions={actions}>
        <p className="flex items-start gap-2.5 text-sm text-muted-foreground"><CalendarDays className="mt-0.5 h-4 w-4 flex-none" aria-hidden />Nothing is scheduled this week in the delivery plans or milestones of your projects.</p>
      </MyDayCard>
    );
  }
  return (
    <MyDayCard title="Delivery this week" actions={actions}>
      {/* Wide screens: the week grid. */}
      <div className="hidden md:block" aria-hidden>
        <div className="overflow-hidden rounded-xl border border-border bg-[hsl(var(--field))]">
          <div className="grid grid-cols-[minmax(9rem,12rem)_1fr] border-b border-border bg-[hsl(var(--secondary)/0.55)] text-[13px] font-semibold text-muted-foreground">
            <div className="px-3 py-2">Project</div>
            <div className="grid grid-cols-7">
              {week.days.map((d) => (
                <div key={d.iso} className={cn("px-1 py-1.5 text-center leading-tight", d.col === week.todayCol && "bg-[hsl(var(--fill-teal)/0.16)] text-foreground")}>
                  <div>{dayName(d.iso)}</div><div className="font-normal">{dayDate(d.iso)}</div>
                </div>
              ))}
            </div>
          </div>
          {week.rows.map((row) => <GridRow key={row.project.id} row={row} todayCol={week.todayCol} />)}
        </div>
      </div>
      {/* Phones and the screen-reader reading: the same facts as a list. */}
      <ul className="space-y-3 md:sr-only">
        {week.rows.map((row) => (
          <li key={row.project.id} className="rounded-xl border border-border bg-[hsl(var(--field))] p-3">
            <p className="font-medium">{row.project.name} <span className="font-normal text-muted-foreground">· {row.project.reference}</span></p>
            <ul className="mt-1.5 space-y-1 text-sm">
              {row.bars.map((b) => <li key={b.id}><span className="font-medium">{b.title}</span> <span className="text-muted-foreground">({BAR_WORDS[b.status]}) {b.cutStart || b.cutEnd ? "this week" : ""}</span></li>)}
              {row.marks.map((m) => <li key={m.id}><span aria-hidden>◆ </span><span className="font-medium">{m.title}</span> <span className="text-muted-foreground">milestone {MARK_WORDS[m.state]} {dayName(week.days[m.col]!.iso)} {dayDate(week.days[m.col]!.iso)}</span></li>)}
            </ul>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground" aria-label="Key">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full bg-[hsl(var(--fill-teal))]" aria-hidden />In progress</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full border border-[hsl(var(--fill-blue)/0.6)] bg-[hsl(var(--fill-blue)/0.22)]" aria-hidden />Planned</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-full border border-border bg-[hsl(var(--foreground)/0.08)]" aria-hidden />Done</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 bg-[hsl(var(--fill-amber))]" aria-hidden />Milestone due</span>
        {week.moreProjects > 0 ? <span>{week.moreProjects} more project{week.moreProjects === 1 ? "" : "s"} with something this week: <Link href="/projects" className={cardLink}>view projects</Link></span> : null}
      </div>
    </MyDayCard>
  );
}

function GridRow({ row, todayCol }: { row: DeliveryRow; todayCol: number | null }) {
  const markLane = row.lanes; // milestones sit on the line below the bars
  return (
    <div className="grid grid-cols-[minmax(9rem,12rem)_1fr] border-b border-border/70 last:border-b-0">
      <div className="min-w-0 px-3 py-2.5">
        <p className="truncate text-sm font-semibold" title={row.project.name}>{row.project.name}</p>
        <p className="truncate text-[12.5px] text-muted-foreground">{row.project.reference}{row.project.pmName ? ` · ${row.project.pmName}` : ""}</p>
      </div>
      <div className="relative grid grid-cols-7 content-center gap-y-1 py-2" style={{ gridTemplateRows: `repeat(${row.lanes + (row.marks.length > 0 ? 1 : 0)}, 1.5rem)` }}>
        {Array.from({ length: 7 }, (_, c) => <div key={c} className={cn("pointer-events-none border-l border-border/50 first:border-l-0", c === todayCol && "bg-[hsl(var(--fill-teal)/0.10)]")} style={{ gridColumn: c + 1, gridRow: `1 / span ${row.lanes + (row.marks.length > 0 ? 1 : 0)}` }} />)}
        {row.bars.map((b) => (
          <div key={b.id} title={`${b.title} (${BAR_WORDS[b.status]})`} className={cn("z-[5] mx-0.5 flex min-w-0 items-center border px-2 text-[12.5px] font-medium", BAR_STYLE[b.status], b.cutStart ? "rounded-l-none" : "rounded-l-full", b.cutEnd ? "rounded-r-none" : "rounded-r-full")} style={{ gridColumn: `${b.col + 1} / span ${b.span}`, gridRow: b.lane + 1 }}>
            <span className="truncate">{b.title}</span>
          </div>
        ))}
        {row.marks.map((m, i) => {
          const next = row.marks[i + 1];
          const span = next && next.col <= m.col + 1 ? 1 : Math.min(2, 7 - m.col);
          return (
            <div key={m.id} title={`${m.title}: milestone ${MARK_WORDS[m.state]}`} className="z-[5] flex min-w-0 items-center gap-1.5 pl-1 text-[12.5px]" style={{ gridColumn: `${m.col + 1} / span ${span}`, gridRow: markLane + 1 }}>
              <span className={cn("h-2.5 w-2.5 flex-none rotate-45", MARK_STYLE[m.state])} />
              <span className="truncate">{m.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
