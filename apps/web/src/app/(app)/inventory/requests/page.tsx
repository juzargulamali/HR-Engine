import Link from "next/link";
import { cn } from "@/lib/utils";
import { listTable } from "@/components/workspace/list-table";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AvailabilityButton } from "@/components/inventory/planning/availability-dialog";
import { RequestsQuickAdd } from "@/components/inventory/planning/requests-quick-add";
import { RequestSidePanel } from "@/components/inventory/planning/request-panel";
import { SalesChecksWaiting } from "@/components/inventory/planning/sales-checks-waiting";
import { RequestStatusBadge } from "@/components/inventory/planning/status";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { PanelLink } from "@/components/workspace/panel-link";
import { SortHead } from "@/components/workspace/sort-head";
import { LoadError } from "@/components/workspace/states";
import { firstParam, nextSort, parseRecordId, parseSort, sortToParam, withParams } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { REQUEST_SORT_KEYS, filterRequests, sortRequests, windowLabel, type RequestSortKey } from "@/lib/inventory/planning";
import { loadRequestList, loadVisibleLocations, MAX_REQUESTS } from "@/lib/inventory/planning-data";
import { buildAvailabilityScope, buildQuickAddScope } from "@/lib/inventory/planning-scope";
import { REQUEST_STATUS_WORDS } from "@/lib/inventory/words";
import { todayIso } from "@/lib/projects/format";

export const metadata = { title: "Equipment requests" };

const BASE = "/inventory/requests";
type Params = Record<string, string | string[] | undefined>;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const WHEN: { value: string; label: string }[] = [
  { value: "", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "week", label: "Next 7 days" },
  { value: "month", label: "Next 30 days" },
  { value: "started", label: "Started already" },
];

function whenRange(when: string, today: string): { from: string; until: string } {
  switch (when) {
    case "today": return { from: today, until: today };
    case "week": return { from: today, until: addDays(today, 7) };
    case "month": return { from: today, until: addDays(today, 30) };
    case "started": return { from: "", until: today };
    default: return { from: "", until: "" };
  }
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getInventoryContext();
  if (!ctx) return null;

  const q = firstParam(sp, "q").slice(0, 100);
  const statusRaw = firstParam(sp, "status");
  const status = statusRaw === "all" || Object.hasOwn(REQUEST_STATUS_WORDS, statusRaw) ? statusRaw : "";
  const kind = firstParam(sp, "kind") === "project" || firstParam(sp, "kind") === "employee" ? firstParam(sp, "kind") : "";
  const when = WHEN.some((w) => w.value === firstParam(sp, "when")) ? firstParam(sp, "when") : "";
  const sort = parseSort<RequestSortKey>(firstParam(sp, "sort"), REQUEST_SORT_KEYS, { key: "needed", dir: "asc" });
  const openId = parseRecordId(firstParam(sp, "open"));
  const here = (patch: Record<string, string | null> = {}) => withParams(BASE, sp, patch);

  let locations: Awaited<ReturnType<typeof loadVisibleLocations>> = [];
  let locationsFailed = false;
  try {
    locations = await loadVisibleLocations();
  } catch (e) {
    console.error("[inventory] locations load failed", e);
    locationsFailed = true;
  }
  const location = locations.some((l) => l.id === firstParam(sp, "location")) ? firstParam(sp, "location") : "";

  const [quickScope, availabilityScope] = await Promise.all([
    buildQuickAddScope(ctx, locations).catch(() => null),
    buildAvailabilityScope(ctx, locations).catch(() => null),
  ]);
  const canAdd = !!quickScope && (quickScope.projects.length > 0 || quickScope.companies.some((c) => c.canEmployee));
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Equipment requests</h1>
      <div className="flex flex-wrap items-center gap-2">
        {availabilityScope && availabilityScope.locations.length > 0 ? <AvailabilityButton scope={availabilityScope} /> : null}
        {canAdd && quickScope ? <RequestsQuickAdd scope={quickScope} /> : null}
      </div>
    </div>
  );
  const switchedOff = ctx.companies.filter((c) => !c.isEnabled);
  const offNote = switchedOff.length > 0 ? (
    <Alert variant="warning" role="status">Inventory is switched off for {switchedOff.map((c) => c.name).join(", ")}. You can read its requests, but nothing can be created or changed until a founder switches it on.</Alert>
  ) : null;
  const waiting = <SalesChecksWaiting locations={locations} />;
  const panel = openId ? <RequestSidePanel openId={openId} closeHref={here({ open: null })} retryHref={here()} /> : null;

  let list: Awaited<ReturnType<typeof loadRequestList>>;
  try {
    list = await loadRequestList(ctx.userId);
  } catch (e) {
    console.error("[inventory] request list load failed", e);
    return (
      <div className="space-y-4">
        {header}
        {offNote}
        {waiting}
        <LoadError what="the equipment requests" retryHref={here()} />
        {panel}
      </div>
    );
  }

  if (list.total === 0) {
    return (
      <div className="space-y-5">
        {header}
        {offNote}
        {waiting}
        <EmptyState
          title="No equipment requests yet"
          description={canAdd ? "Start a request for a project or an employee. It stays a draft until you submit it to the warehouse." : "Requests you are part of will appear here. Project managers ask for equipment from their project's Equipment page."}
        />
        {locationsFailed ? <LoadError what="the locations" retryHref={here()} /> : null}
        {panel}
      </div>
    );
  }

  const today = todayIso();
  const range = whenRange(when, today);
  const rows = sortRequests(filterRequests(list.rows, { q, status, kind, location, from: range.from, until: range.until }), sort);
  const filterActive = !!(q || status || kind || location || when);
  const filters: ToolbarFilter[] = [
    { name: "status", label: "Status", value: status, options: [{ value: "", label: "Active (not closed or cancelled)" }, ...Object.entries(REQUEST_STATUS_WORDS).map(([value, label]) => ({ value, label })), { value: "all", label: "Everything" }] },
    { name: "kind", label: "For", value: kind, options: [{ value: "", label: "Projects and employees" }, { value: "project", label: "Projects" }, { value: "employee", label: "Employees" }] },
    ...(locations.length > 1 ? [{ name: "location", secondary: true, label: "Pickup location", value: location, options: [{ value: "", label: "Any location" }, ...locations.map((l) => ({ value: l.id, label: l.name }))] }] : []),
    { name: "when", secondary: true, label: "Needed", value: when, options: WHEN },
  ];
  const clearHref = here({ q: null, status: null, kind: null, location: null, when: null });
  const sortHref = (key: RequestSortKey) => here({ sort: sortToParam(nextSort(sort, key)) });

  return (
    <div className="space-y-4">
      {header}
      {offNote}
      {waiting}
      <ListToolbar search={{ value: q, placeholder: "Search request, project, employee or destination" }} filters={filters} clearHref={clearHref} />
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="Clear a filter or search for something else." action={<Link href={clearHref} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {rows.length} of {list.total} requests{filterActive ? " match" : ""}{list.limited ? `. Only the newest ${MAX_REQUESTS} requests are loaded; narrow the filters or ask for an older one by its code` : ""}
          </p>
          <Table className={cn("min-w-[52rem]", listTable)}>
            <caption className="sr-only">Equipment requests, sorted by {sort.key} {sort.dir === "asc" ? "ascending" : "descending"}</caption>
            <TableHeader>
              <TableRow>
                <SortHead label="Request" active={sort.key === "code"} dir={sort.dir} href={sortHref("code")} />
                <SortHead label="For" active={sort.key === "for"} dir={sort.dir} href={sortHref("for")} />
                <SortHead label="Needed" active={sort.key === "needed"} dir={sort.dir} href={sortHref("needed")} />
                <SortHead label="Status" active={sort.key === "status"} dir={sort.dir} href={sortHref("status")} />
                <TableHead scope="col">Lines done</TableHead>
                <TableHead scope="col">Shortages</TableHead>
                <TableHead scope="col">Requested by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className={`align-top ${openId === r.id ? "bg-secondary/50" : ""}`} aria-selected={openId === r.id || undefined}>
                  <TableCell className="min-w-[9rem]">
                    <PanelLink href={here({ open: r.id })} className="break-words font-mono font-medium underline-offset-2 hover:underline">{r.code}</PanelLink>
                    {r.title ? <div className="break-words text-sm text-muted-foreground">{r.title}</div> : null}
                  </TableCell>
                  <TableCell data-label="For" className="min-w-[8rem] break-words">{r.forLabel}<span className="block text-sm text-muted-foreground">{r.kind === "project" ? "Project" : "Employee"}</span></TableCell>
                  <TableCell data-label="Needed" className="min-w-[12rem] text-sm">{windowLabel(r)}</TableCell>
                  <TableCell data-label="Status"><RequestStatusBadge status={r.status} /></TableCell>
                  <TableCell data-label="Lines done" className="whitespace-nowrap tabular-nums">{r.total === 0 ? <span className="text-muted-foreground">No lines</span> : `${r.done} of ${r.total}`}</TableCell>
                  <TableCell data-label="Shortages">
                    {r.shortageLines > 0 ? <Badge variant="outline" className="whitespace-nowrap border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">Short on {r.shortageLines} {r.shortageLines === 1 ? "line" : "lines"}</Badge> : <span className="text-muted-foreground">None</span>}
                  </TableCell>
                  <TableCell data-label="Requested by" className="whitespace-nowrap">{r.requestedByName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {panel}
    </div>
  );
}
