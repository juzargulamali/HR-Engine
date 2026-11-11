import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { calendarWeeks, dayLabel, monthLabel, shiftMonth, WEEKDAYS, type CalendarShow, type EditionRow } from "@/lib/crm/events/model";
import { cn } from "@/lib/utils";

const MAX_PER_DAY = 3;

/**
 * The month view of Events & Exhibitions: only the show's name, on every day from its start date to its end date. A name opens THAT edition. Plain links, no
 * script: Previous, Next and Today are addresses. On a wide screen it is a month grid (whole weeks, so a show crossing a month boundary is visible on both sides);
 * on a phone it is the days of the month that have a show, as a list, because seven columns leave no room for a name.
 */
export function EventsCalendar({ month, today, rows, href, dayHref }: {
  month: string; today: string; rows: readonly EditionRow[];
  /** The address of this calendar for another month (undefined = the current month). */
  href: (month?: string) => string;
  /** The list of editions on one day (for "+2 more"). */
  dayHref: (date: string) => string;
}) {
  const weeks = calendarWeeks(month, rows);
  const days = weeks.flat();
  const busy = days.filter((d) => d.inMonth && d.shows.length > 0);
  const show = (s: CalendarShow, className: string) => (
    <Link href={`/sales/events/${s.eventId}?edition=${s.editionId}`} title={s.name} className={className}>{s.name}</Link>
  );
  return (
    <section aria-label={`Calendar, ${monthLabel(month)}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{monthLabel(month)}</h2>
        <nav aria-label="Change month" className="flex items-center gap-2">
          <Link href={href(shiftMonth(month, -1))} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-10")}><ChevronLeft className="h-4 w-4" aria-hidden /> Previous</Link>
          <Link href={href()} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-10")}>Today</Link>
          <Link href={href(shiftMonth(month, 1))} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-10")}>Next <ChevronRight className="h-4 w-4" aria-hidden /></Link>
        </nav>
      </div>

      {/* Wide screens: the month grid. */}
      <div className="hidden sm:block">
        <table className="w-full table-fixed border-collapse text-sm" aria-label={`Shows in ${monthLabel(month)}`}>
          <thead>
            <tr>{WEEKDAYS.map((d) => <th key={d} scope="col" className="border border-border bg-secondary/40 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">{d}</th>)}</tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]!.date}>
                {week.map((day) => (
                  <td key={day.date} className={cn("h-24 border border-border p-1 align-top", !day.inMonth && "bg-secondary/20 text-muted-foreground")}>
                    <span className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums", day.date === today && "bg-primary font-semibold text-primary-foreground")} aria-label={dayLabel(day.date) + (day.date === today ? " (today)" : "")}>{Number(day.date.slice(8))}</span>
                    <ul className="mt-0.5 space-y-0.5">
                      {day.shows.slice(0, MAX_PER_DAY).map((s) => <li key={s.editionId}>{show(s, "block truncate rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-foreground underline-offset-2 hover:underline")}</li>)}
                      {day.shows.length > MAX_PER_DAY ? <li><Link href={dayHref(day.date)} className="block px-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline">+{day.shows.length - MAX_PER_DAY} more</Link></li> : null}
                    </ul>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: the days that have a show. */}
      <div className="sm:hidden">
        {busy.length === 0 ? null : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {busy.map((day) => (
              <li key={day.date} className="flex gap-3 px-3 py-2">
                <span className={cn("w-24 shrink-0 pt-2 text-sm tabular-nums", day.date === today ? "font-semibold text-foreground" : "text-muted-foreground")}>{dayLabel(day.date)}{day.date === today ? " (today)" : ""}</span>
                <ul className="min-w-0 flex-1">
                  {day.shows.map((s) => <li key={s.editionId}>{show(s, "flex min-h-10 items-center break-words text-sm font-medium underline-offset-2 hover:underline")}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
      {busy.length === 0 ? <p className="text-sm text-muted-foreground" role="status">No shows in {monthLabel(month)}{days.some((d) => d.shows.length > 0) ? " itself; the grid also shows the days around it" : ""}.</p> : null}
    </section>
  );
}
