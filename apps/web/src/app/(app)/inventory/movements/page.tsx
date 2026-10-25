import Link from "next/link";
import { canViewStock } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckTransaction } from "@/components/inventory/stock/check-transaction";
import { DateRangeFilter } from "@/components/inventory/stock/movement-filters";
import { listTable } from "@/components/workspace/list-table";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { ClickableRow } from "@/components/workspace/clickable-row";
import { PanelLink } from "@/components/workspace/panel-link";
import { LoadError } from "@/components/workspace/states";
import { firstParam, parseRecordId, withParams } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { dayStartIso, movementFromTo, movementKindWord, movementQuantity, movementWhat, movementWhen, movementZone, nextDay, type Resolver } from "@/lib/inventory/movement-view";
import { loadMovements, MOVEMENTS_PER_PAGE, type MovementList } from "@/lib/inventory/stock";
import { MOVEMENT_WORDS } from "@/lib/inventory/words";
import { cn } from "@/lib/utils";
import { MovementSidePanel } from "./_panel/movement-panel";

export const metadata = { title: "Movements" };

const BASE = "/inventory/movements";
type Params = Record<string, string | string[] | undefined>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The ledger: every movement of stock, newest first. Only for people who may view stock (the database returns nothing to anyone else).
 * Times are shown in the time zone of the place where the movement happened. A row opens beside the list with its lines and, for people
 * who confirm stock, a way to correct it. "Check a transaction" asks the database whether an entry with a given key was recorded.
 */
export default async function MovementsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const here = (patch: Record<string, string | null> = {}) => withParams(BASE, sp, patch);
  const viewIds = ctx.grants.map((g) => g.companyId).filter((id, i, a) => a.indexOf(id) === i && canViewStock(ctx.grants, id));
  const title = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Movements</h1>
      <Link href="/inventory" className={buttonVariants({ variant: "outline", size: "sm" })}>Back to Inventory</Link>
    </div>
  );
  if (viewIds.length === 0) {
    return (
      <div className="space-y-4">
        {title}
        <Alert role="status">Movements are for people who may see stock: warehouse operators, Inventory founders and people given the right to view stock. Ask an Inventory founder if you need it.</Alert>
      </div>
    );
  }

  const kind = firstParam(sp, "kind") in MOVEMENT_WORDS ? firstParam(sp, "kind") : "";
  const locations = ctx.locations.filter((l) => viewIds.includes(l.company_id));
  const location = locations.some((l) => l.id === firstParam(sp, "location")) ? firstParam(sp, "location") : "";
  const company = viewIds.includes(firstParam(sp, "company")) ? firstParam(sp, "company") : "";
  const from = DAY.test(firstParam(sp, "from")) ? firstParam(sp, "from") : "";
  const to = DAY.test(firstParam(sp, "to")) ? firstParam(sp, "to") : "";
  const item = parseRecordId(firstParam(sp, "item")) ?? "";
  const page = Math.max(1, Math.min(2000, Number.parseInt(firstParam(sp, "page"), 10) || 1));
  const openId = parseRecordId(firstParam(sp, "open"));
  const rangeZone = locations.find((l) => l.id === location)?.timezone ?? locations[0]?.timezone ?? "Asia/Dubai";
  const fromIso = from ? dayStartIso(from, rangeZone) : null;
  const toNext = to ? nextDay(to) : null;
  const toIso = toNext ? dayStartIso(toNext, rangeZone) : null;
  const panel = openId ? <MovementSidePanel openId={openId} closeHref={here({ open: null })} locations={locations} /> : null;
  const companies = viewIds.map((id) => ({ id, name: ctx.companyName(id) }));

  let list: MovementList;
  try {
    list = await loadMovements(ctx, { kind, location, from, to, item, company, page }, viewIds, fromIso, toIso);
  } catch (e) {
    console.error("[inventory] movements load failed", e);
    return (
      <div className="space-y-4">
        {title}
        <LoadError what="the movements" retryHref={here()} />
        {panel}
      </div>
    );
  }

  const active = !!(kind || location || company || from || to || item);
  const clearHref = here({ kind: null, location: null, company: null, from: null, to: null, item: null, page: null });
  const filters: ToolbarFilter[] = [
    { name: "kind", label: "What happened", value: kind, options: [{ value: "", label: "Any" }, ...Object.entries(MOVEMENT_WORDS).map(([value, label]) => ({ value, label }))] },
    ...(locations.length > 0 ? [{ name: "location", label: "Location", value: location, options: [{ value: "", label: "All locations" }, ...locations.map((l) => ({ value: l.id, label: l.name }))] }] : []),
    ...(companies.length > 1 ? [{ name: "company", label: "Company", value: company, options: [{ value: "", label: "All companies" }, ...companies.map((c) => ({ value: c.id, label: c.name }))] }] : []),
  ];
  const zoneOf = new Map(locations.map((l) => [l.id, l.timezone]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const resolver: Resolver = {
    location: (id) => (id ? (locName.get(id) ?? "Another location") : "—"),
    bin: () => null,
    employee: (id) => list.names.employee(id),
    project: (id) => list.names.project(id),
  };
  const itemName = (id: string) => list.items.get(id) ?? "Item";
  const pages = Math.max(1, Math.ceil(list.total / MOVEMENTS_PER_PAGE));

  return (
    <div className="space-y-4">
      {title}
      <ListToolbar filters={filters} clearHref={active ? clearHref : undefined}>
        <DateRangeFilter from={from} to={to} />
      </ListToolbar>
      {item ? <p className="text-sm text-muted-foreground" role="note">Showing movements of one item: <strong>{itemName(item) === "Item" ? "the chosen item" : itemName(item)}</strong>. <Link href={here({ item: null, page: null })} className="underline underline-offset-2">Show all items</Link></p> : null}
      <details className="rounded-md border border-border">
        <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Check a transaction</summary>
        <div className="border-t border-border p-3"><CheckTransaction companies={companies} /></div>
      </details>
      {list.rows.length === 0 ? (
        active ? <EmptyState title="Nothing matches" description="Clear a filter or choose other dates." action={<Link href={clearHref} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
          : <EmptyState title="No movements yet" description="Every receipt, issue, dispatch, return and transfer appears here once it is recorded." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">{list.total} movement{list.total === 1 ? "" : "s"}{active ? " match" : ""}. Page {page} of {pages}. Times are in the time zone of the place where it happened.</p>
          <Table className={cn("min-w-[56rem]", listTable)}>
            <caption className="sr-only">Stock movements, newest first</caption>
            <TableHeader>
              <TableRow>
                {["When", "What", "Quantity", "From → To", "Who", "Project, employee or request", "Note"].map((h) => <TableHead key={h} scope="col" className={h === "Quantity" ? "text-right" : undefined}>{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((m) => {
                const zone = movementZone(m, (id) => zoneOf.get(id) ?? null, rangeZone);
                const { from: f, to: t } = movementFromTo(m, resolver);
                const about = [m.project_id ? `Project ${list.names.project(m.project_id)}` : null, m.employee_id ? list.names.employee(m.employee_id) : null, m.request_id ? `Request ${list.names.request(m.request_id)}` : null].filter(Boolean).join(" · ");
                return (
                  <ClickableRow key={m.id} href={here({ open: m.id })} panel selected={openId === m.id} className="align-top" aria-selected={openId === m.id || undefined}>
                    <TableCell className="min-w-[9rem]">
                      <PanelLink href={here({ open: m.id })} className="font-medium underline-offset-2 hover:underline">{movementWhen(m.occurred_at, zone)}</PanelLink>
                      <div className="mt-0.5 font-mono text-[13px] text-muted-foreground">{m.code}</div>
                    </TableCell>
                    <TableCell data-label="What" className="min-w-[10rem] break-words"><span className="font-medium">{movementKindWord(m.kind)}</span><span className="block text-sm text-muted-foreground">{movementWhat(m, itemName)}</span></TableCell>
                    <TableCell data-label="Quantity" className="text-right tabular-nums">{movementQuantity(m, itemName)}</TableCell>
                    <TableCell data-label="From → To" className="min-w-[10rem] break-words">{f} → {t}</TableCell>
                    <TableCell data-label="Who" className="whitespace-nowrap">{list.names.user(m.performed_by)}</TableCell>
                    <TableCell data-label="Project, employee or request" className="break-words">{about || "—"}</TableCell>
                    <TableCell data-label="Note" className="max-w-[16rem] break-words">{m.note ?? m.reason ?? "—"}</TableCell>
                  </ClickableRow>
                );
              })}
            </TableBody>
          </Table>
          <nav className="flex items-center justify-between gap-3" aria-label="Pages">
            {page > 1 ? <Link href={here({ page: page === 2 ? null : String(page - 1) })} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Newer</Link> : <span />}
            {page < pages ? <Link href={here({ page: String(page + 1) })} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Older</Link> : <span />}
          </nav>
        </>
      )}
      {panel}
    </div>
  );
}
