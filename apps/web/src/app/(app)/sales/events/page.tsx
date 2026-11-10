import Link from "next/link";
import { CalendarDays, Upload } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/workspace/states";
import { todayInDubai } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadEvents } from "@/lib/crm/events/data";
import {
  countEnquiries, dateRangeText, editionLabel, editionPhase, enquiriesByEdition, eventFiltersFromParams, filterEditions, hasEventFilters, PHASE_LABEL, placeText, EVENT_KIND_LABEL,
  type EditionRow,
} from "@/lib/crm/events/model";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { cn } from "@/lib/utils";
import { AddEventButton, EditionButton } from "./event-forms";
import { eventsScope } from "./scope";

export const metadata = { title: "Events & Exhibitions" };
const PAGE_LIMIT = 100;
const COUNTRIES = ["AE", "SA", "PL", "QA", "KW", "BH", "OM", "EG", "GB", "DE", "FR", "US", "SG", "IN"];

/**
 * Events & Exhibitions: the shared list of editions worldwide (every company sees the same events). Defaults to upcoming editions; past ones are one filter away. The
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
  const rows = filterEditions(all, filters, today);
  const page = rows.slice(0, PAGE_LIMIT);
  const byEdition = enquiriesByEdition(data.enquiries, scope.companyId);
  const countries = [...new Set([...COUNTRIES, ...data.editions.map((e) => e.country_code).filter((c): c is string => !!c)])].sort((a, b) => countryLabel(a).localeCompare(countryLabel(b)));
  const liveEvents = data.events.filter((e) => !e.archived_at).sort((a, b) => a.name.localeCompare(b.name));
  const withNoEdition = liveEvents.filter((e) => !data.editions.some((d) => d.event_id === e.id && !d.archived_at));
  const here = (over: Record<string, string>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ ...(scope.all ? { scope: "all" } : {}), ...over })) if (v) q.set(k, v); const s = q.toString(); return `/sales/events${s ? `?${s}` : ""}`; };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        <div className="flex flex-wrap gap-2">
          <AddEventButton />
          <Link href="/sales/events/import" className={buttonVariants({ variant: "outline" })}><Upload className="h-4 w-4" aria-hidden /> Import events</Link>
          <EditionButton events={liveEvents.map((e) => ({ id: e.id, name: e.name }))} label="Add edition" />
        </div>
      </div>

      <form method="get" role="search" aria-label="Filter events" className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="ev-q" className="text-sm font-medium leading-none">Event name</label>
            <Input id="ev-q" name="q" type="search" defaultValue={filters.q} placeholder="e.g. GITEX, a city or a venue" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ev-country" className="text-sm font-medium leading-none">Country</label>
            <Select id="ev-country" name="country" defaultValue={filters.country}>
              <option value="">Any country</option>
              {countries.map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ev-when" className="text-sm font-medium leading-none">When</label>
            <Select id="ev-when" name="when" defaultValue={filters.when}>
              <option value="upcoming">Upcoming (default)</option>
              <option value="past">Past editions</option>
              <option value="all">All editions</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ev-from" className="text-sm font-medium leading-none">From date</label>
            <Input id="ev-from" name="from" type="date" defaultValue={filters.from} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ev-to" className="text-sm font-medium leading-none">To date</label>
            <Input id="ev-to" name="to" type="date" defaultValue={filters.to} />
          </div>
          {scope.canChooseAll ? (
            <div className="space-y-1.5">
              <label htmlFor="ev-scope" className="text-sm font-medium leading-none">Enquiry figures for</label>
              <Select id="ev-scope" name="scope" defaultValue={scope.all ? "all" : ""}>
                <option value="">{ctx.companies.find((c) => c.id === scope.companyId)?.name ?? "Current company"}</option>
                <option value="all">All my companies</option>
              </Select>
            </div>
          ) : null}
          <label className="flex min-h-10 items-end gap-2 pb-2 text-sm font-medium"><input type="checkbox" name="archived" value="1" defaultChecked={filters.archived} className="h-4 w-4" /> Include archived</label>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="secondary" className="min-h-10">Apply</Button>
            {hasEventFilters(filters) ? <Link href={here({})} className={cn(buttonVariants({ variant: "ghost" }), "min-h-10")}>Clear</Link> : null}
          </div>
        </div>
      </form>

      <p className="text-sm text-muted-foreground" role="status">
        {filters.from || filters.to ? "Editions overlapping the dates chosen" : filters.when === "upcoming" ? "Upcoming editions, soonest first" : filters.when === "past" ? "Past editions, newest first" : "All editions, newest first"}: {rows.length}.
        {" "}Enquiry figures count the enquiries linked to each edition for <strong>{scope.label}</strong> (open = not won or lost; closed = won or lost). Enquiries of a company you have no Sales access to are never counted.
      </p>

      {withNoEdition.length > 0 && !hasEventFilters(filters) ? (
        <Alert role="status"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />{withNoEdition.length === 1 ? `${withNoEdition[0]!.name} has` : `${withNoEdition.length} events have`} no edition yet: {withNoEdition.map((e) => <Link key={e.id} href={`/sales/events/${e.id}`} className="underline underline-offset-2">{e.name}</Link>).reduce<React.ReactNode[]>((a, n, i) => (i ? [...a, ", ", n] : [n]), [])}. Open it to add one.</Alert>
      ) : null}

      {data.events.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No events yet" description="Add an event, then its first edition. Enquiries and observations can then be linked to it." />
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
      {rows.length > page.length ? <Alert>Showing the first {PAGE_LIMIT} of {rows.length} editions. Filter to narrow the list.</Alert> : null}
    </div>
  );
}
