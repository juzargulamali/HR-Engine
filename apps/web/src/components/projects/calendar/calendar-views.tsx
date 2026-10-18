import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, groupByDay, monthGrid, startOfWeek, type CalendarEntry } from "@enginious-hr/domain";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/projects/format";
import {
  CALENDAR_VIEWS, COMMON_TIME_ZONES, calendarHref, entryDateText, entryWhen, neighbourDates, rangeTitle, visibleRange,
  type CalendarParams, type CalendarView, type DisplayEntry,
} from "./helpers";

const VIEW_LABELS: Record<CalendarView, string> = { month: "Month", week: "Week", agenda: "Agenda" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface CalendarProps {
  basePath: string;
  params: CalendarParams;
  /** Other query parameters to keep on every link (scope, company…). */
  keep?: Record<string, string>;
  today: string;
  entries: DisplayEntry[];
  /** Kinds offered as filters (omit for none). */
  kindOptions?: { id: string; label: string }[];
  /** Show the project reference beside each entry (company and my calendars span projects). */
  showProject?: boolean;
  /** Whether to offer the viewing-zone selector (date-only calendars do not need one). */
  timeZoneSelect?: boolean;
}

function hrefFor(p: CalendarProps, over: Partial<{ view: CalendarView; date: string }>): string {
  return calendarHref(p.basePath, { ...p.keep, view: over.view ?? p.params.view, date: over.date ?? p.params.date, tz: p.params.tz === "Asia/Dubai" ? null : p.params.tz, kind: p.params.kinds });
}

/** View switcher, previous / next / today as plain links, a viewing-zone selector and kind filters as plain GET forms (no JavaScript needed). */
export function CalendarToolbar(p: CalendarProps) {
  const { prev, next } = neighbourDates(p.params.view, p.params.date);
  const link = "inline-flex h-8 items-center justify-center rounded-md border border-input px-3 text-sm font-medium hover:bg-secondary/70";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Calendar view" className="inline-flex overflow-hidden rounded-md border border-input">
          {CALENDAR_VIEWS.map((v) => (
            <Link key={v} href={hrefFor(p, { view: v })} aria-current={p.params.view === v ? "true" : undefined}
              className={cn("px-3 py-1.5 text-sm font-medium", p.params.view === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60")}>
              {VIEW_LABELS[v]}
            </Link>
          ))}
        </div>
        <Link href={hrefFor(p, { date: prev })} aria-label="Previous period" className={link}><ChevronLeft className="h-4 w-4" aria-hidden /></Link>
        <Link href={hrefFor(p, { date: p.today })} className={link}>Today</Link>
        <Link href={hrefFor(p, { date: next })} aria-label="Next period" className={link}><ChevronRight className="h-4 w-4" aria-hidden /></Link>
        <h2 className="ml-1 text-base font-semibold" aria-live="polite">{rangeTitle(p.params.view, p.params.date)}</h2>
      </div>
      {p.timeZoneSelect || (p.kindOptions && p.kindOptions.length > 0) ? (
        <form method="get" action={p.basePath} className="flex flex-wrap items-end gap-3">
          {Object.entries(p.keep ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="view" value={p.params.view} />
          <input type="hidden" name="date" value={p.params.date} />
          {p.timeZoneSelect ? (
            <label className="space-y-1 text-sm">
              <span className="block font-medium">Show times in</span>
              <Select name="tz" defaultValue={p.params.tz} className="w-56">
                {[...new Set([p.params.tz, ...COMMON_TIME_ZONES])].map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              </Select>
            </label>
          ) : null}
          {p.kindOptions && p.kindOptions.length > 0 ? (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <legend className="mb-1 text-sm font-medium">Show only (none ticked shows everything)</legend>
              {p.kindOptions.map((k) => (
                <label key={k.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="kind" value={k.id} defaultChecked={p.params.kinds.includes(k.id)} /> {k.label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <Button type="submit" variant="outline" size="sm">Apply</Button>
        </form>
      ) : null}
    </div>
  );
}

/** One entry as text: kind, title, project, status in words, and the time (site time first) or the plain date. */
export function EntryLine({ e, viewTz, showProject, compact = false }: { e: DisplayEntry; viewTz: string; showProject?: boolean; compact?: boolean }) {
  const when = entryWhen(e, viewTz);
  const dateText = entryDateText(e);
  return (
    <div className={cn("min-w-0 text-sm", compact ? "leading-snug" : "")}>
      <p className="break-words">
        <span className="text-muted-foreground">{e.kindLabel}: </span>
        <Link href={e.href} className="font-medium underline-offset-2 hover:underline">{e.title}</Link>
      </p>
      <p className="break-words text-muted-foreground">
        {[showProject && e.projectRef ? `${e.projectRef}${e.projectName ? ` ${e.projectName}` : ""}` : null, e.statusLabel, e.detail].filter(Boolean).join(" · ")}
      </p>
      {when ? (
        <p className="break-words text-muted-foreground">
          {when.source}
          {when.viewer ? <><br />{when.viewer}</> : null}
        </p>
      ) : !compact && dateText && e.endDate && e.endDate !== e.onDate ? (
        <p className="text-muted-foreground">{formatDate(e.onDate)} to {formatDate(e.endDate)}</p>
      ) : null}
    </div>
  );
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** A plain list grouped by day. Also the screen-reader and phone form of every other view. */
export function AgendaView({ entries, from, to, viewTz, showProject, today, emptyText }: { entries: CalendarEntry[]; from: string; to: string; viewTz: string; showProject?: boolean; today: string; emptyText: string }) {
  const byDay = groupByDay(entries as DisplayEntry[], viewTz);
  const days = [...byDay.keys()].filter((d) => d >= from && d <= to).sort();
  if (days.length === 0) return <EmptyState title="Nothing in this period" description={emptyText} dense />;
  return (
    <ol className="divide-y divide-border rounded-lg border border-border bg-card">
      {days.map((day) => (
        <li key={day} className="grid gap-2 p-3 sm:grid-cols-[11rem_1fr]">
          <h3 className="text-sm font-semibold">{dayLabel(day)}{day === today ? <span className="ml-2 rounded-full bg-accent px-2 text-[13px] text-accent-foreground">Today</span> : null}</h3>
          <ul className="space-y-2">
            {(byDay.get(day) as DisplayEntry[]).map((e) => <li key={`${e.id}-${day}`}><EntryLine e={e} viewTz={viewTz} showProject={showProject} /></li>)}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function MonthGrid(p: CalendarProps) {
  const byDay = groupByDay(p.entries, p.params.tz) as Map<string, DisplayEntry[]>;
  const weeks = monthGrid(p.params.date);
  return (
    <div className="hidden overflow-hidden rounded-lg border border-border md:block" role="table" aria-label={`Calendar for ${rangeTitle("month", p.params.date)}`}>
      <div role="row" className="grid grid-cols-7 border-b border-border bg-secondary/60">
        {WEEKDAYS.map((w) => <div key={w} role="columnheader" className="px-2 py-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{w}</div>)}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} role="row" className="grid grid-cols-7 border-b border-border last:border-0">
          {week.map((cell) => {
            const items = byDay.get(cell.day) ?? [];
            const shown = items.slice(0, 3);
            return (
              <div key={cell.day} role="cell" className={cn("min-h-28 min-w-0 border-r border-border p-1.5 last:border-0", !cell.inMonth && "bg-secondary/30 text-muted-foreground")}>
                <p className={cn("mb-1 text-sm", cell.day === p.today ? "inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1 font-semibold text-accent-foreground" : "font-medium")}>{Number(cell.day.slice(8))}</p>
                <ul className="space-y-1.5">
                  {shown.map((e) => <li key={`${e.id}-${cell.day}`}><EntryLine e={e} viewTz={p.params.tz} showProject={p.showProject} compact /></li>)}
                </ul>
                {items.length > 3 ? (
                  <Link href={hrefFor(p, { view: "agenda", date: cell.day })} className="mt-1 inline-block text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">+{items.length - 3} more</Link>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function WeekGrid(p: CalendarProps) {
  const start = startOfWeek(p.params.date);
  const byDay = groupByDay(p.entries, p.params.tz) as Map<string, DisplayEntry[]>;
  return (
    <ol className="grid gap-2 md:grid-cols-7">
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => {
        const items = byDay.get(day) ?? [];
        return (
          <li key={day} className="min-w-0 rounded-lg border border-border bg-card p-2">
            <h3 className="mb-1.5 text-sm font-semibold">{WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]} {Number(day.slice(8))}{day === p.today ? <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">(today)</span> : null}</h3>
            {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing</p> : (
              <ul className="space-y-2">{items.map((e) => <li key={`${e.id}-${day}`}><EntryLine e={e} viewTz={p.params.tz} showProject={p.showProject} /></li>)}</ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Toolbar plus the chosen view. On a phone the Month view is its agenda list (a seven-column grid does not fit), with the grid from tablet width up. */
export function CalendarShell(p: CalendarProps & { emptyText: string }) {
  const { from, to } = visibleRange(p.params.view, p.params.date);
  return (
    <div className="space-y-4">
      <CalendarToolbar {...p} />
      {p.params.view === "month" ? (
        <>
          <MonthGrid {...p} />
          <div className="md:hidden"><AgendaView entries={p.entries} from={from} to={to} viewTz={p.params.tz} showProject={p.showProject} today={p.today} emptyText={p.emptyText} /></div>
        </>
      ) : p.params.view === "week" ? (
        <WeekGrid {...p} />
      ) : (
        <AgendaView entries={p.entries} from={from} to={to} viewTz={p.params.tz} showProject={p.showProject} today={p.today} emptyText={p.emptyText} />
      )}
      <p className="text-sm text-muted-foreground">
        Deadlines are plain dates and never move with a time zone. Timed events show the site&apos;s own time first{p.timeZoneSelect ? `, and your chosen zone (${p.params.tz.replace(/_/g, " ")}) when it differs` : ""}.
      </p>
    </div>
  );
}

export { buttonVariants };
