import Link from "next/link";
import { AlertTriangle, CalendarDays, List as ListIcon, Upload } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RememberList } from "@/components/workspace/list-memory";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { LoadError } from "@/components/workspace/states";
import { withParams } from "@/components/workspace/url-state";
import { ChooseCompanyNotice, CompanySwitch } from "@/components/sales/company-switch";
import { todayInDubai } from "@/components/sales/format";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext } from "@/lib/crm/context";
import { loadEvents } from "@/lib/crm/events/data";
import {
  countEnquiries, dateRangeText, editionLabel, editionPhase, editionsForMonth, enquiriesByEdition, eventFiltersFromParams, filterEditions, hasEventFilters, isMonth, monthLabel, PHASE_LABEL, placeText, EVENT_KIND_LABEL,
  type EditionRow, type LinkedEnquiry,
} from "@/lib/crm/events/model";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { cn } from "@/lib/utils";
import { AddEventButton, EditionButton } from "./event-forms";
import { EventsCalendar } from "./events-calendar";
import { address, eventsScope, scopeParams } from "./scope";

export const metadata = { title: "Events & Exhibitions" };
const PAGE_SIZE = 100;
const COUNTRIES = ["AE", "SA", "PL", "QA", "KW", "BH", "OM", "EG", "GB", "DE", "FR", "US", "SG", "IN"];
const BASE = "/sales/events";

/**
 * Events & Exhibitions: the shared list of editions worldwide (every company sees the same events), as a List (the default) or a month Calendar (`?view=calendar`,
 * `&month=YYYY-MM`; the current month in Dubai when none is given). The list defaults to upcoming editions; past ones are one filter away. The
 * enquiry figures on each row are the VIEWER's: counted from the enquiries their own session can read, for the active Sales company (shown, with a chooser, above
 * the list) or, if they hold several, all of them. When they hold several and none can be assumed, the events are still listed (they are shared) and the figures
 * are left out until a company is chosen. Every link from here carries the company, so the event's page counts for the same company.
 */
export default async function EventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const heading = (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold">Events &amp; Exhibitions
        <InfoHint label="Events and Exhibitions" className="ml-1.5">One shared list of shows, with who exhibited, which agency worked with them and which agencies to contact. Every company sees the same events; only the enquiry figures are counted per company.</InfoHint>
      </h1>
      <p className="text-sm text-muted-foreground">One shared list of shows. Every company sees the same events.</p>
    </div>
  );
  let data: Awaited<ReturnType<typeof loadEvents>>;
  try { data = await loadEvents(); } catch (e) {
    console.error("[events] list failed", e);
    return <div className="space-y-4">{heading}<LoadError what="Events & Exhibitions" retryHref={withParams(BASE, sp)} /></div>;
  }
  const active = await pickSalesCompany(ctx, sp.company);
  const scope = eventsScope(ctx.companies, sp, active);
  const keep = scopeParams(scope);
  const keepQuery = new URLSearchParams(keep).toString();
  const filters = eventFiltersFromParams(sp);
  const today = todayInDubai();
  const eventBy = new Map(data.events.map((e) => [e.id, e]));
  const all: EditionRow[] = data.editions.flatMap((edition) => { const event = eventBy.get(edition.event_id); return event ? [{ event, edition }] : []; });
  // List (default) or Calendar. The calendar's dates are its month, so When / From / To do not apply to it; the name, country and archive filters do.
  const calendar = sp.view === "calendar";
  const month = typeof sp.month === "string" && isMonth(sp.month) ? sp.month : today.slice(0, 7);
  const rows = calendar ? editionsForMonth(all, filters, month, today) : filterEditions(all, filters, today);
  // Everything is read; the list shows one page of it at a time and says which, with a way to the rest.
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageNo = Math.min(pages, Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "", 10) || 1));
  const page = rows.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
  // No company chosen yet: nothing is counted (null here would mean "every company", which nobody asked for).
  const byEdition = scope.choose ? new Map<string, LinkedEnquiry[]>() : enquiriesByEdition(data.enquiries, scope.companyId);
  const countries = [...new Set([...COUNTRIES, ...data.editions.map((e) => e.country_code).filter((c): c is string => !!c)])].sort((a, b) => countryLabel(a).localeCompare(countryLabel(b)));
  const liveEvents = data.events.filter((e) => !e.archived_at).sort((a, b) => a.name.localeCompare(b.name));
  const withNoEdition = liveEvents.filter((e) => !data.editions.some((d) => d.event_id === e.id && !d.archived_at));
  const editionCount = new Map<string, number>();
  for (const d of data.editions) editionCount.set(d.event_id, (editionCount.get(d.event_id) ?? 0) + 1);
  const eventChoices = liveEvents.map((e) => ({ id: e.id, name: e.name, editions: editionCount.get(e.id) ?? 0 }));
  // The filters that both views share, kept when switching view or month, with the company.
  const shared = { ...keep, q: filters.q, country: filters.country, ...(filters.archived ? { archived: "1" } : {}) };
  const listHref = address(BASE, { ...shared, ...(filters.when !== "upcoming" ? { when: filters.when } : {}), from: filters.from, to: filters.to });
  const calendarHref = (m?: string) => address(BASE, { ...shared, view: "calendar", ...(m ? { month: m } : {}) });
  const eventHref = (eventId: string, editionId?: string) => address(`${BASE}/${eventId}`, { ...(editionId ? { edition: editionId } : {}), ...keep });
  // The calendar's dates are its month, so When, From date, To date and the enquiry figures do not apply to it and are not offered there.
  const toolbarFilters: ToolbarFilter[] = [
    { name: "country", label: "Country", value: filters.country, options: [{ value: "", label: "Any country" }, ...countries.map((c) => ({ value: c, label: countryLabel(c) }))] },
    ...(calendar ? [] : [
      { name: "when", label: "When", value: filters.when === "upcoming" ? "" : filters.when, options: [{ value: "", label: "Upcoming (default)" }, { value: "past", label: "Past editions" }, { value: "all", label: "All editions" }] },
      { name: "from", label: "From date", secondary: true, kind: "date" as const, value: filters.from },
      { name: "to", label: "To date", secondary: true, kind: "date" as const, value: filters.to },
    ]),
    { name: "archived", label: "Include archived", secondary: true, kind: "toggle" as const, value: filters.archived ? "1" : "" },
  ];
  // Clear removes the search and the filters; the view, the month and whose enquiry figures are counted stay.
  const clearHref = withParams(BASE, sp, { q: null, country: null, archived: null, page: null, ...(calendar ? {} : { when: null, from: null, to: null }) });
  const figures = !calendar && !scope.choose;

  return (
    <div className="space-y-5">
      <RememberList section="events" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        <div className="flex flex-wrap items-center gap-2">
          <AddEventButton events={eventChoices} keep={keepQuery} />
          <EditionButton events={liveEvents.map((e) => ({ id: e.id, name: e.name }))} label="Add edition" keep={keepQuery} />
          <Link href={address(`${BASE}/import`, keep)} className={buttonVariants({ variant: "outline" })}><Upload className="h-4 w-4" aria-hidden /> Import events</Link>
          <InfoHint label="Add event or add edition" testId="info-hint-event-words">
            <p><strong>Add event</strong>: a new recurring show (for example GITEX Global), added once together with its first edition.</p>
            <p className="mt-2"><strong>Add edition</strong>: one dated occurrence of an event that is already in the list, with its own dates and place. Enquiries and observations are linked to an edition.</p>
            <p className="mt-2"><strong>Add next edition</strong> (on an event&apos;s page): the following occurrence of that event, starting with the place of its latest edition.</p>
            <p className="mt-2"><strong>Import events</strong>: many editions at once from an Excel or CSV file, with a preview before anything is saved.</p>
          </InfoHint>
        </div>
      </div>
      <p className="-mt-2 text-sm text-muted-foreground" data-testid="event-add-consequences">Add event creates a new show with its first edition. Add edition adds a dated occurrence to a show already listed. Both are shared with every company.</p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CompanySwitch companies={ctx.companies} current={scope.all ? null : scope.companyId} from={active.from}
          hrefFor={(id) => withParams(BASE, sp, { company: id, scope: null })}
          all={scope.canChooseAll ? { href: withParams(BASE, sp, { scope: "all", company: null }), active: scope.all } : undefined} />
        <nav aria-label="View" className="inline-flex rounded-md border border-border p-0.5">
          <Link href={listHref} aria-current={calendar ? undefined : "page"} className={cn("inline-flex min-h-10 items-center gap-1.5 rounded px-3 text-sm font-medium", calendar ? "text-muted-foreground hover:text-foreground" : "bg-secondary text-foreground")}><ListIcon className="h-4 w-4" aria-hidden /> List</Link>
          <Link href={calendarHref(sp.view === "calendar" && typeof sp.month === "string" && isMonth(sp.month) ? month : undefined)} aria-current={calendar ? "page" : undefined} className={cn("inline-flex min-h-10 items-center gap-1.5 rounded px-3 text-sm font-medium", calendar ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}><CalendarDays className="h-4 w-4" aria-hidden /> Calendar</Link>
        </nav>
      </div>

      {/* Same toolbar as Sales > Enquiries: each filter applies as it is chosen (no Apply button). The view (List or Calendar), the calendar's month and the company are in the address, so they stay. */}
      <ListToolbar search={{ value: filters.q, placeholder: "Event name, city or venue", label: "Search events by name, city or venue" }} filters={toolbarFilters} clearHref={clearHref} resetKeys={["page"]} />

      {calendar ? (
        <p className="text-sm text-muted-foreground" role="status">Editions on the days shown for {monthLabel(month)}: {rows.length}. A show is on every day from its start date to its end date. Choose a name to open that edition.</p>
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          {filters.from || filters.to ? "Editions overlapping the dates chosen" : filters.when === "upcoming" ? "Upcoming editions, soonest first" : filters.when === "past" ? "Past editions, newest first" : "All editions, newest first"}: {rows.length}.
          {scope.choose ? null : (
            <> Enquiry figures are for <strong data-testid="events-scope">{scope.label}</strong>
              <InfoHint label="Enquiry figures" className="ml-0.5">The figures count the enquiries linked to each edition for {scope.label}: open = not won or lost (On hold counts as open); closed = won or lost. They are counted from the enquiries, never typed in. Enquiries of a company you have no Sales access to are never counted.</InfoHint>
            </>
          )}
        </p>
      )}
      {scope.choose && !calendar ? <ChooseCompanyNotice what="the enquiry figures of each edition" /> : null}

      {withNoEdition.length > 0 && !hasEventFilters(filters) ? (
        <Alert role="status"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />{withNoEdition.length === 1 ? `${withNoEdition[0]!.name} has` : `${withNoEdition.length} events have`} no edition yet: {withNoEdition.map((e) => <Link key={e.id} href={eventHref(e.id)} className="underline underline-offset-2">{e.name}</Link>).reduce<React.ReactNode[]>((a, n, i) => (i ? [...a, ", ", n] : [n]), [])}. Open it and use “Add first edition”.</Alert>
      ) : null}

      {data.events.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No events yet" description="Add an event with its first edition. Enquiries and observations can then be linked to it." />
      ) : calendar ? (
        <EventsCalendar month={month} today={today} rows={rows} href={calendarHref} dayHref={(d) => address(BASE, { ...shared, from: d, to: d })} showHref={(s) => eventHref(s.eventId, s.editionId)} />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No editions match" description={filters.when === "upcoming" && !hasEventFilters({ ...filters, when: "upcoming" }) ? "There are no upcoming editions. Past editions are one filter away." : "Clear a filter or change the dates."}
          action={<span className="flex gap-2"><Link href={address(BASE, { ...keep, when: "past" })} className={buttonVariants({ variant: "outline", size: "sm" })}>Show past editions</Link><Link href={address(BASE, keep)} className={buttonVariants({ variant: "ghost", size: "sm" })}>Clear filters</Link></span>} />
      ) : (
        <Table stack aria-label="Editions">
          <TableHeader>
            <TableRow>
              <TableHead>Edition</TableHead><TableHead>Dates</TableHead><TableHead>Where</TableHead><TableHead>Status</TableHead>
              {figures ? <><TableHead>Enquiries</TableHead><TableHead>Open</TableHead><TableHead>Closed</TableHead><TableHead>Won</TableHead><TableHead>Lost</TableHead></> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.map(({ event, edition }) => {
              const c = countEnquiries(byEdition.get(edition.id) ?? []);
              const phase = editionPhase(edition, today);
              const archived = !!(event.archived_at || edition.archived_at);
              return (
                <TableRow key={edition.id}>
                  <TableCell>
                    <Link href={eventHref(event.id, edition.id)} className="font-medium underline-offset-2 hover:underline">{editionLabel(event, edition)}</Link>
                    <span className="block text-xs text-muted-foreground">{EVENT_KIND_LABEL[event.kind]}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{dateRangeText(edition.start_date, edition.end_date)}</TableCell>
                  <TableCell>{placeText(edition, countryLabel) || <span className="text-muted-foreground">Not recorded</span>}</TableCell>
                  <TableCell><span className="flex flex-wrap gap-1 max-md:justify-end"><OsBadge tone={phase === "past" ? "quiet" : phase === "ongoing" ? "green" : "blue"}>{PHASE_LABEL[phase]}</OsBadge>{archived ? <OsBadge tone="amber">Archived</OsBadge> : null}</span></TableCell>
                  {figures ? (
                    <>
                      <TableCell className="tabular-nums">{c.total}</TableCell>
                      <TableCell className="tabular-nums">{c.open}</TableCell>
                      <TableCell className="tabular-nums">{c.closed}</TableCell>
                      <TableCell className="tabular-nums">{c.won}</TableCell>
                      <TableCell className="tabular-nums">{c.lost}</TableCell>
                    </>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {!calendar && rows.length > PAGE_SIZE ? (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="events-pager">
          <p role="status">Showing {(pageNo - 1) * PAGE_SIZE + 1}-{(pageNo - 1) * PAGE_SIZE + page.length} of {rows.length} editions.</p>
          <span className="flex gap-2">
            {pageNo > 1 ? <Link href={withParams(BASE, sp, { page: pageNo === 2 ? null : String(pageNo - 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>Previous {PAGE_SIZE}</Link> : null}
            {pageNo < pages ? <Link href={withParams(BASE, sp, { page: String(pageNo + 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>Next {Math.min(PAGE_SIZE, rows.length - pageNo * PAGE_SIZE)}</Link> : null}
          </span>
        </nav>
      ) : null}
    </div>
  );
}
