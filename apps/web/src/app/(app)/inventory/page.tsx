import Link from "next/link";
import { canManageCatalogue, canOperateAnyStock, canSeeCosts, canViewStock } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/components/sales/format";
import { StockHeaderActions } from "@/components/inventory/stock/header-actions";
import { QuickAddItem } from "@/components/inventory/stock/quick-add-item";
import { ColumnsMenu } from "@/components/workspace/columns-menu";
import { listTable } from "@/components/workspace/list-table";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { PanelLink } from "@/components/workspace/panel-link";
import { SortHead } from "@/components/workspace/sort-head";
import { LoadError } from "@/components/workspace/states";
import { firstParam, nextSort, parseColumns, parseRecordId, parseSort, sortToParam, withParams } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { fillSummaryUsable, loadStockList, type StockList } from "@/lib/inventory/stock";
import {
  STATUS_FILTERS, STATUS_FILTER_LABELS, STOCK_ALL_COLUMNS, STOCK_COLUMNS, STOCK_DEFAULT_COLUMNS, STOCK_DEFAULT_SORT, STOCK_ONLY_COLUMNS, STOCK_SORT_KEYS,
  categoryPath, filterStockRows, fmt, isFilterActive, outText, sortStockRows, type StatusFilter, type StockColumn, type StockFilter, type StockRow,
} from "@/lib/inventory/stock-list";
import { CONDITION_WORDS, TRACKING_WORDS, formatQty } from "@/lib/inventory/words";
import { cn } from "@/lib/utils";
import { ActionSidePanel, parseAction } from "./_panel/action-panel";
import { ItemSidePanel } from "./_panel/item-panel";
import { UnitSidePanel } from "./_panel/unit-panel";

export const metadata = { title: "Inventory" };

const MAX_ROWS = 300;
/** Counts for people who cannot view stock come from the database one item and location at a time, so only this many are asked for. */
const SUMMARY_CAP = 80;
const BASE = "/inventory";

type Params = Record<string, string | string[] | undefined>;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const here = (patch: Record<string, string | null> = {}) => withParams(BASE, sp, patch);
  const hasAccess = ctx.grants.length > 0 || ctx.managesProjects;
  if (!hasAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <Alert role="status">You do not have Inventory access. Ask an Inventory founder to give you access. Equipment that has been issued to you is listed under My equipment.</Alert>
      </div>
    );
  }

  // Anything that is not a known value is ignored rather than trusted from the URL.
  const q = firstParam(sp, "q").slice(0, 100);
  const tracking = firstParam(sp, "tracking") in TRACKING_WORDS ? firstParam(sp, "tracking") : "";
  const condition = firstParam(sp, "condition") in CONDITION_WORDS ? firstParam(sp, "condition") : "";
  const statusRaw = firstParam(sp, "status");
  const status: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(statusRaw) ? (statusRaw as StatusFilter) : "";
  const location = ctx.locations.some((l) => l.is_active && l.id === firstParam(sp, "location")) ? firstParam(sp, "location") : "";
  const sort = parseSort(firstParam(sp, "sort"), STOCK_SORT_KEYS, STOCK_DEFAULT_SORT);
  const openId = parseRecordId(firstParam(sp, "open"));
  const unitRef = firstParam(sp, "unit").trim().slice(0, 60);
  const action = parseAction(firstParam(sp, "action"));
  const binCode = firstParam(sp, "bin").trim().slice(0, 40) || null;

  const anyDetail = ctx.grants.some((g) => canViewStock(ctx.grants, g.companyId));
  const anyCost = ctx.grants.some((g) => canSeeCosts(ctx.grants, g.companyId));
  const multiCompany = ctx.companies.length > 1;
  const offered = STOCK_ALL_COLUMNS.filter((c) => (anyDetail || !STOCK_ONLY_COLUMNS.includes(c)) && (anyCost || c !== "cost") && (multiCompany || c !== "company"));
  const cols = parseColumns(firstParam(sp, "cols"), offered, STOCK_DEFAULT_COLUMNS.filter((c) => offered.includes(c)));
  const canAdd = ctx.grants.some((g) => canManageCatalogue(ctx.grants, g.companyId));
  const canOperate = canOperateAnyStock(ctx.grants);

  const hrefs = {
    scan: here({ action: "scan", open: null, unit: null }),
    receive: here({ action: "receive", open: null, unit: null }),
    issue: here({ action: "issue", open: null, unit: null }),
    dispatch: here({ action: "dispatch", open: null, unit: null }),
    return: here({ action: "return", open: null, unit: null }),
    transfer: here({ action: "transfer", open: null, unit: null }),
  };
  const header = (add: React.ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Inventory</h1>
      <div className="flex flex-wrap items-center gap-2">
        <StockHeaderActions hrefs={hrefs} canOperate={canOperate} />
        {add}
      </div>
    </div>
  );

  // Panels: an action form or the scanner first, then one unit, then one item. The list behind them stays as it was.
  const closeHref = here({ open: null, unit: null, action: null, bin: null, employee: null, project: null, request: null, codes: null, transfer: null, mode: null });
  const params = { employee: firstParam(sp, "employee"), project: firstParam(sp, "project"), request: firstParam(sp, "request"), codes: firstParam(sp, "codes").slice(0, 3000), transfer: firstParam(sp, "transfer"), mode: firstParam(sp, "mode") };
  const panel = action ? <ActionSidePanel action={action} params={params} closeHref={here({ action: null, employee: null, project: null, request: null, codes: null, transfer: null, mode: null })} />
    : unitRef ? <UnitSidePanel unitRef={unitRef} closeHref={here({ unit: null })} here={here} />
    : openId ? <ItemSidePanel openId={openId} closeHref={closeHref} here={here} binCode={binCode} />
    : null;

  let list: StockList;
  try {
    list = await loadStockList(ctx, { locationId: location, withCosts: cols.includes("cost") });
  } catch (e) {
    console.error("[inventory] stock list load failed", e);
    return (
      <div className="space-y-4">
        {header(null)}
        <LoadError what="the inventory" retryHref={here()} />
        {panel}
      </div>
    );
  }

  const addButton = canAdd ? <QuickAddItem companies={list.companies.filter((c) => canManageCatalogue(ctx.grants, c.id)).map((c) => ({ id: c.id, name: c.name, categories: list.categories.filter((k) => k.company_id === c.id && k.is_active).map((k) => ({ id: k.id, label: categoryPath(list.categories, k.id) ?? k.name })).sort((a, b) => a.label.localeCompare(b.label)) }))} /> : null;
  const filter: StockFilter = { q, category: list.categories.some((c) => c.id === firstParam(sp, "category")) ? firstParam(sp, "category") : "", location, tracking, condition, company: list.companies.some((c) => c.id === firstParam(sp, "company")) ? firstParam(sp, "company") : "", status };
  const filterActive = isFilterActive(filter);

  if (list.rows.length === 0) {
    return (
      <div className="space-y-5">
        {header(addButton)}
        <EmptyState title="No items yet" description={canAdd ? "Add the first item to the catalogue, then receive stock for it." : "Nothing has been added to the catalogue yet. Ask someone who manages the catalogue."} />
        {panel}
      </div>
    );
  }

  let rows = filterStockRows(list.rows, filter, list.categories);
  const needSummary = rows.filter((r) => !r.detail && r.status === "active");
  let summaryNote: string | null = null;
  if (needSummary.length > 0) {
    const chosen = new Set(sortStockRows(needSummary, STOCK_DEFAULT_SORT).slice(0, SUMMARY_CAP).map((r) => r.id));
    const filled = await fillSummaryUsable(rows.filter((r) => chosen.has(r.id)), list.locations, location);
    const byId = new Map(filled.map((r) => [r.id, r]));
    rows = rows.map((r) => byId.get(r.id) ?? r);
    if (needSummary.length > SUMMARY_CAP) summaryNote = `Counts are shown for the first ${SUMMARY_CAP} items you can only see in summary. Search or filter to see the rest.`;
  }
  const sorted = sortStockRows(rows, sort);
  const shown = sorted.slice(0, MAX_ROWS);

  const categoryOptions = list.categories.filter((c) => c.is_active || c.id === filter.category).map((c) => ({ value: c.id, label: categoryPath(list.categories, c.id) ?? c.name })).sort((a, b) => a.label.localeCompare(b.label));
  const locationOptions = ctx.locations.filter((l) => l.is_active).map((l) => ({ value: l.id, label: multiCompany ? `${l.name} · ${ctx.companyName(l.company_id)}` : l.name }));
  const filters: ToolbarFilter[] = [
    { name: "category", label: "Category", value: filter.category, options: [{ value: "", label: "Any category" }, ...categoryOptions] },
    ...(locationOptions.length > 0 && anyDetail ? [{ name: "location", label: "Location", value: location, options: [{ value: "", label: "All locations" }, ...locationOptions] }] : []),
    { name: "tracking", label: "How tracked", value: tracking, options: [{ value: "", label: "Any" }, ...Object.entries(TRACKING_WORDS).map(([value, w]) => ({ value, label: w.label }))] },
    ...(anyDetail ? [{ name: "condition", label: "Condition", value: condition, secondary: true, options: [{ value: "", label: "Any condition" }, ...Object.entries(CONDITION_WORDS).map(([value, label]) => ({ value, label }))] }] : []),
    ...(multiCompany ? [{ name: "company", label: "Company", value: filter.company, secondary: true, options: [{ value: "", label: "All companies" }, ...list.companies.map((c) => ({ value: c.id, label: c.name }))] }] : []),
    { name: "status", label: "Status", value: status, secondary: true, options: STATUS_FILTERS.map((s) => ({ value: s, label: STATUS_FILTER_LABELS[s] })) },
  ];
  const clearHref = here({ q: null, category: null, location: null, tracking: null, condition: null, company: null, status: null });
  const toolbar = (
    <ListToolbar search={{ value: q, placeholder: anyDetail ? "Search name, model, serial, equipment ID or bin label" : "Search name, model or category" }} filters={filters} clearHref={clearHref}>
      <ColumnsMenu columns={STOCK_COLUMNS.filter((c) => offered.includes(c.id))} selected={cols} defaults={STOCK_DEFAULT_COLUMNS.filter((c) => offered.includes(c))} />
    </ListToolbar>
  );

  return (
    <div className="space-y-4">
      {header(addButton)}
      {toolbar}
      {!anyDetail ? <Alert role="status">You can see the catalogue and how many of each item are usable now. Where equipment is, who holds it, projects, movements and costs are for the warehouse team.</Alert> : null}
      {list.truncated ? <Alert variant="warning" role="status">The inventory is very large, so the counts below are based on the first part of it. Narrow the list with a filter or the search.</Alert> : null}
      {location && anyDetail ? <p className="text-sm text-muted-foreground" role="note">Showing counts for one location. Counted stock that is out with employees or on projects is not split by location, so it is left out here; clear the location to see it.</p> : null}
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="Clear a filter or search for something else." action={<Link href={clearHref} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {rows.length} of {list.rows.length} items{filterActive ? " match" : ""}{rows.length > MAX_ROWS ? `, showing the first ${MAX_ROWS}. Narrow the filters to see the rest` : ""}
          </p>
          {summaryNote ? <p className="text-sm text-muted-foreground">{summaryNote}</p> : null}
          <Table className={cn("min-w-[44rem]", listTable)}>
            <caption className="sr-only">Inventory items, sorted by {sort.key} {sort.dir === "asc" ? "ascending" : "descending"}</caption>
            <TableHeader>
              <TableRow>
                {cols.map((c) => <SortHead key={c} label={STOCK_COLUMNS.find((x) => x.id === c)?.label ?? c} active={sort.key === c} dir={sort.dir} href={here({ sort: sortToParam(nextSort(sort, c)) })} className={isNumeric(c) ? "text-right" : undefined} />)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id} className={cn("align-top", openId === r.id && "bg-secondary/50")} aria-selected={openId === r.id || undefined}>
                  {cols.map((c) => (
                    <TableCell key={c} data-label={c === cols[0] ? undefined : STOCK_COLUMNS.find((x) => x.id === c)?.label} className={cellClass(c)}>
                      <Cell column={c} row={r} href={here({ open: r.id, unit: null, action: null, bin: null })} companyName={ctx.companyName(r.companyId)} />
                    </TableCell>
                  ))}
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

const isNumeric = (c: StockColumn) => c === "usable" || c === "warehouse" || c === "reserved" || c === "draft" || c === "cost";

function cellClass(c: StockColumn): string {
  switch (c) {
    case "item": return "min-w-[12rem] max-w-[22rem]";
    case "usable": case "warehouse": case "reserved": case "draft": case "cost": return "whitespace-nowrap text-right tabular-nums";
    case "out": return "min-w-[8rem]";
    case "tracking": case "company": return "whitespace-nowrap";
    default: return "";
  }
}

const count = (r: StockRow, n: number | null) => (n === null ? <span className="text-muted-foreground" title="Not shown to you">—</span> : <>{formatQty(n, r.tracking === "quantity" || r.tracking === "consumable" ? r.uom : null)}</>);

function Cell({ column, row: r, href, companyName }: { column: StockColumn; row: StockRow; href: string; companyName: string }) {
  switch (column) {
    case "item": {
      const sub = [r.model, r.specification].filter(Boolean).join(" · ");
      return (
        <>
          <PanelLink href={href} className="break-words font-medium underline-offset-2 hover:underline">{r.name}</PanelLink>
          {sub ? <div className="mt-0.5 break-words text-sm text-muted-foreground">{sub}</div> : null}
          {r.status === "draft" || r.status === "retired" || (r.draftUnits ?? 0) > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {r.status === "draft" ? <Badge variant="warning">Draft</Badge> : null}
              {r.status === "retired" ? <Badge variant="outline">Retired</Badge> : null}
              {(r.draftUnits ?? 0) > 0 ? <Badge variant="warning">{fmt(r.draftUnits ?? 0)} not counted yet</Badge> : null}
            </div>
          ) : null}
        </>
      );
    }
    case "category": return r.categoryName ? <span className="break-words">{r.categoryName}</span> : <span className="text-muted-foreground">None</span>;
    case "tracking": return <>{TRACKING_WORDS[r.tracking].label}</>;
    case "usable": return count(r, r.usable);
    case "warehouse": return count(r, r.warehouse);
    case "out": return <span className="break-words">{outText(r)}</span>;
    case "reserved": return count(r, r.reserved);
    case "draft": return count(r, r.draftUnits);
    case "company": return <>{companyName}</>;
    case "cost": return r.cost ? <>{formatMoney(r.cost.amount, r.cost.currency)}</> : <span className="text-muted-foreground">—</span>;
  }
}
