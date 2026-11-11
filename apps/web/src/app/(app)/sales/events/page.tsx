import Link from "next/link";
import { CalendarDays, List as ListIcon, Upload } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { LoadError } from "@/components/workspace/states";
import { withParams } from "@/components/workspace/url-state";
import { todayInDubai } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadEvents } from "@/lib/crm/events/data";
import {
  countEnquiries, dateRangeText, editionLabel, editionPhase, editionsForMonth, enquiriesByEdition, eventFiltersFromParams, filterEditions, hasEventFilters, isMonth, monthLabel, PHASE_LABEL, placeText, EVENT_KIND_LABEL,
  type EditionRow,
} from "@/lib/crm/events/model";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { cn } from "@/lib/utils";
import { AddEventButton, EditionButton } from "./event-forms";
import { EventsCalendar } from "./events-calendar";
import { eventsScope } from "./scope";

export const metadata = { title: "Events & Exhibitions" };
const PAGE_LIMIT = 100;
const COUNTRIES = ["AE", "SA", "PL", "QA", "KW", "BH", "OM", "EG", "GB", "DE", "FR", "US", "SG", "IN"];

/**
 * Events & Exhibitions: the shared list of editions worldwide (every company sees the same events), as a List (the default) or a month Calendar (`?view=calendar`,
 * `&month=YYYY-MM`; the current month in Dubai when none is given). The list defaults to upcoming editions; past ones are one filter away. The
 * enquiry figures on each row are the VIEWER's: counted from the enquiries their own session can read, for their current company or (if they hold several) all of them.
 */
export default async function EventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const heading = (
    <div>
      <h1 className="text-2xl font-semibold">Events &amp; Exhibitions</h1>
      <p className="text-muted-foreground">One shared list of shows, with who exhibited, which agency worked with them and which agencies to contact. Every company sees the same events.</p>
    </div>
  );
  let data: Awaited<ReturnType<typeof loadEvents>>;
  try { data = await loadEvents(); } catch (e) {
    console.error("[events] list failed", e);
    return <div className="space-y-4">{heading}<LoadError what="Events & Exhibitions" retryHref="/sales/events" /></div>;
  }
  const scope = eventsScope(ctx.companies, sp);
  const filters = eventFiltersFromParams(sp);
  const today = todayInDubai();
  const eventBy = new Map(data.events.map((e) => [e.id, e]));
  const all: EditionRow[] = data.editions.flatMap((edition) => { const event = eventBy.get(edition.event_id); return event ? [{ event, edition }] : []; });
  // List (default) or Calendar. The calendar's dates are its month, so When / From / To do not apply to it; the name, country and archive filters do.
  const calendar = sp.view === "calendar";
  const month = typeof sp.month === "string" && isMonth(sp.month) ? sp.month : today.slice(0, 7);
  const rows = calendar ? editionsForMonth(all, filters, month, today) : filterEditions(all, filters, today);
  const page = rows.slice(0, PAGE_LIMIT);
  const byEdition = enquiriesByEdition(data.enquiries, scope.companyId);
  const countries = [...new Set([...COUNTRIES, ...data.editions.map((e) => e.country_code).filter((c): c is string => !!c)])].sort((a, b) => countryLabel(a).localeCompare(countryLabel(b)));
  const liveEvents = data.events.filter((e) => !e.archived_at).sort((a, b) => a.name.localeCompare(b.name));
  const withNoEdition = liveEvents.filter((e) => !data.editions.some((d) => d.event_id === e.id && !d.archived_at));
  const editionCount = new Map<string, number>();
  for (const d of data.editions) editionCount.set(d.event_id, (editionCount.get(d.event_id) ?? 0) + 1);
  const eventChoices = liveEvents.map((e) => ({ id: e.id, name: e.name, editions: editionCount.get(e.id) ?? 0 }));
  // The filters that both views share, kept when switching view or month.
  const shared = { ...(scope.all ? { scope: "all" } : {}), q: filters.q, country: filters.country, ...(filters.archived ? { archived: "1" } : {}) };
  const address = (params: Record<string, string>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) q.set(k, v); const s = q.toString(); return `/sales/events${s ? `?${s}` : ""}`; };
  const listHref = address({ ...shared, ...(filters.when !== "upcoming" ? { when: filters.when } : {}), from: filters.from, to: filters.to });
  const calendarHref = (m?: string) => address({ ...shared, view: "calendar", ...(m ? { month: m } : {}) });
  // The calendar's dates are its month, so When, From date, To date and the enquiry figures do not apply to it and are not offered there.
  const toolbarFilters: ToolbarFilter[] = [
    { name: "country", label: "Country", value: filters.country, options: [{ value: "", label: "Any country" }, ...countries.map((c) => ({ value: c, label: countryLabel(c) }))] },
    ...(calendar ? [] : [
      { name: "when", label: "When", value: filters.when === "upcoming" ? "" : filters.when, options: [{ value: "", label: "Upcoming (default)" }, { value: "past", label: "Past editions" }, { value: "all", label: "All editions" }] },
      { name: "from", label: "From date", secondary: true, kind: "date" as const, value: filters.from },
      { name: "to", label: "To date", secondary: true, kind: "date" as const, value: filters.to },
      ...(scope.canChooseAll ? [{ name: "scope", label: "Enquiry figures for", secondary: true, scopeOnly: true, value: scope.all ? "all" : "", options: [{ value: "", label: ctx.companies.find((c) => c.id === scope.companyId)?.name ?? "Current company" }, { value: "all", label: "All my companies" }] }] : []),
    ]),
    { name: "archived", label: "Include archived", secondary: true, kind: "toggle" as const, value: filters.archived ? "1" : "" },
  ];
  // Clear removes the search and the filters; the view, the month and whose enquiry figures are counted stay.
  const clearHref = withParams("/sales/events", sp, { q: null, country: null, archived: null, ...(calendar ? {} : { when: null, from: null, to: null }) });
  const here = (over: Record<string, string>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ ...(scope.all ? { scope: "all" } : {}), ...over })) if (v) q.set(k, v); const s = q.toString(); return `/sales/events${s ? `?${s}` : ""}`; };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        <div className="flex flex-wrap gap-2">
          <AddEventButton events={eventChoices} />
          <Link href="/sales/events/import" className={buttonVariants({ variant: "outline" })}><Upload className="h-4 w-4" aria-hidden /> Import events</Link>
          <EditionButton events={liveEvents.map((e) => ({ id: e.id, name: e.name }))} label="Add edition" />
        </div>
      </div>

      <nav aria-label="View" className="inline-flex rounded-md border border-border p-0.5">
        <Link href={listHref} aria-current={calendar ? undefined : "page"} className={cn("inline-flex min-h-10 items-center gap-1.5 rounded px-3 text-sm font-medium", calendar ? "text-muted-foreground hover:text-foreground" : "bg-secondary text-foreground")}><ListIcon className="h-4 w-4" aria-hidden /> List</Link>
        <Link href={calendarHref(sp.view === "calendar" && typeof sp.month === "string" && isMonth(sp.month) ? month : undefined)} aria-current={calendar ? "page" : undefined} className={cn("inline-flex min-h-10 items-center gap-1.5 rounded px-3 text-sm font-medium", calendar ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}><CalendarDays className="h-4 w-4" aria-hidden /> Calendar</Link>
      </nav>

      {/* Same toolbar as Sales > Enquiries: each filter applies as it is chosen (no Apply button). The view (List or Calendar) and the calendar's month are in the address, so they stay. */}
      <ListToolbar search={{ value: filters.q, placeholder: "Event name, city or venue", label: "Search events by name, city or venue" }} filters={toolbarFilters} clearHref={clearHref} />

      {calendar ? (
        <p className="text-sm text-muted-foreground" role="status">Editions on the days shown for {monthLabel(month)}: {rows.length}. A show is on every day from its start date to its end date. Choose a name to open that edition.</p>
      ) : (
      <p className="text-sm text-muted-foreground" role="status">
        {filters.from || filters.to ? "Editions overlapping the dates chosen" : filters.when === "upcoming" ? "Upcoming editions, soonest first" : filters.when === "past" ? "Past editions, newest first" : "All editions, newest first"}: {rows.length}.
        {" "}Enquiry figures count the enquiries linked to each edition for <strong>{scope.label}</strong> (open = not won or lost; closed = won or lost). Enquiries of a company you have no Sales access to are never counted.
      </p>
      )}

      {withNoEdition.length > 0 && !hasEventFilters(filters) ? (
        <Alert role="status"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />{withNoEdition.length === 1 ? `${withNoEdition[0]!.name} has` : `${withNoEdition.length} events have`} no edition yet: {withNoEdition.map((e) => <Link key={e.id} href={`/sales/events/${e.id}`} className="underline underline-offset-2">{e.name}</Link>).reduce<React.ReactNode[]>((a, n, i) => (i ? [...a, ", ", n] : [n]), [])}. Open it to add one.</Alert>
      ) : null}

      {data.events.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No events yet" description="Add an event with its first edition. Enquiries and observations can then be linked to it." />
      ) : calendar ? (
        <EventsCalendar month={month} today={today} rows={rows} href={calendarHref} dayHref={(d) => address({ ...shared, from: d, to: d })} />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No editions match" description={filters.when === "upcoming" && !hasEventFilters({ ...filters, when: "upcoming" }) ? "There are no upcoming editions. Past editions are one filter away." : "Clear a filter or change the dates."}
          action={<span className="flex gap-2"><Link href={here({ when: "past" })} className={buttonVariants({ variant: "outline", size: "sm" })}>Show past editions</Link><Link href={here({})} className={buttonVariants({ variant: "ghost", size: "sm" })}>Clear filters</Link></span>} />
      ) : (
        <Table stack aria-label="Editions">
          <TableHeader>
            <TableRow><TableHead>Edition</TableHead><TableHead>Dates</TableHead><TableHead>Where</TableHead><TableHead>Status</TableHead><TableHead>Enquiries</TableHead><TableHead>Open</TableHead><TableHead>Closed</TableHead><TableHead>Won</TableHead><TableHead>Lost</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {page.map(({ event, edition }) => {
              const c = countEnquiries(byEdition.get(edition.id) ?? []);
              const phase = editionPhase(edition, today);
              const archived = !!(event.archived_at || edition.archived_at);
              return (
                <TableRow key={edition.id}>
                  <TableCell>
                    <Link href={`/sales/events/${event.id}?edition=${edition.id}`} className="font-medium underline-offset-2 hover:underline">{editionLabel(event, edition)}</Link>
                    <span className="block text-xs text-muted-foreground">{EVENT_KIND_LABEL[event.kind]}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{dateRangeText(edition.start_date, edition.end_date)}</TableCell>
                  <TableCell>{placeText(edition, countryLabel) || <span className="text-muted-foreground">Not recorded</span>}</TableCell>
                  <TableCell><span className="flex flex-wrap gap-1"><OsBadge tone={phase === "past" ? "quiet" : phase === "ongoing" ? "green" : "blue"}>{PHASE_LABEL[phase]}</OsBadge>{archived ? <OsBadge tone="amber">Archived</OsBadge> : null}</span></TableCell>
                  <TableCell className="tabular-nums">{c.total}</TableCell>
                  <TableCell className="tabular-nums">{c.open}</TableCell>
                  <TableCell className="tabular-nums">{c.closed}</TableCell>
                  <TableCell className="tabular-nums">{c.won}</TableCell>
                  <TableCell className="tabular-nums">{c.lost}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {!calendar && rows.length > page.length ? <Alert>Showing the first {PAGE_LIMIT} of {rows.length} editions. Filter to narrow the list.</Alert> : null}
    </div>
  );
}
