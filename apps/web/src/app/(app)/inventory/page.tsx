import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PackageOpen, TriangleAlert } from "lucide-react";
import { canOperateAnyStock } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { TodayRow } from "@/components/inventory/today/today-row";
import { WarehouseBar } from "@/components/inventory/warehouse-bar";
import { RememberList } from "@/components/workspace/list-memory";
import { firstParam, withParams } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { legacyStockTarget } from "@/lib/inventory/legacy-redirect";
import {
  FAILURE_TAIL, FILTER_LABEL, GROUP_LABEL, SHOW_FILTERS, SOURCE_NOUN, filterCounts, filterRows, groupRows, isQueueEmpty, parseShow,
} from "@/lib/inventory/today";
import { loadToday } from "@/lib/inventory/today-data";
import { WAREHOUSE_COOKIE, pickWorkingLocation, warehouseOptions } from "@/lib/inventory/working-location";
import { cn } from "@/lib/utils";

export const metadata = { title: "Today" };

const BASE = "/inventory";
type Params = Record<string, string | string[] | undefined>;

/**
 * Today: the work waiting for the warehouse the person is working in, one row per job. Each row says what needs doing, for whom, when
 * (the record's own date) and has one button. The sources are read separately: one that cannot be loaded is named in a red banner and its
 * filter shows "?", so a failure is never mistaken for an empty queue.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  // `/inventory?action=…` and the like were the stock list's own links: they keep working, on the stock list.
  const legacy = legacyStockTarget(sp);
  if (legacy) redirect(legacy);

  const ctx = await getInventoryContext();
  // Signed out, not installed, or the access lookup failed: the Inventory layout says so.
  if (!ctx || !ctx.installed || ctx.loadFailed) return null;
  // Without an Inventory grant there is no warehouse work to show: a Project Manager goes to their requests, everyone else to their own equipment.
  if (ctx.grants.length === 0) redirect(ctx.managesProjects ? "/inventory/requests" : "/inventory/mine");

  const { options: warehouses, operable } = warehouseOptions(ctx);
  const cookieStore = await cookies();
  const active = ctx.locations.filter((l) => l.is_active);
  const working = pickWorkingLocation({
    options: warehouses, everyLocationId: active.map((l) => l.id), fromUrl: firstParam(sp, "location"),
    remembered: cookieStore.get(WAREHOUSE_COOKIE)?.value ?? "", assigned: ctx.assignedLocationIds, allowAll: true, defaultAll: operable.size === 0,
  });
  const multiCompany = ctx.companies.length > 1;
  const scanHref = "/inventory/stock?action=scan";
  const bar = <WarehouseBar options={warehouses} currentId={working.id} all={working.all} allowAll scanHref={scanHref} multiCompany={multiCompany} />;

  if (active.length === 0) {
    return (
      <div className="space-y-4">
        {bar}
        <h1 className="text-2xl font-semibold">Today</h1>
        <Alert role="status">No warehouse or location has been set up for your companies yet, so there is no warehouse work to show. Ask an Inventory founder to add one under Manage.</Alert>
      </div>
    );
  }

  const where = working.id ? ctx.locationName(working.id) : "all warehouses";
  const show = parseShow(firstParam(sp, "show"));
  const canOperate = canOperateAnyStock(ctx.grants);
  const data = await loadToday(ctx, { locationId: working.id });
  const now = new Date(data.nowIso);
  const counts = filterCounts(data.rows, data.failed);
  const shown = filterRows(data.rows, show);
  const groups = groupRows(shown, now);
  const retryHref = withParams(BASE, sp);
  const checkLocations = active.map((l) => ({ id: l.id, name: l.name, companyId: l.company_id }));

  return (
    <div className="space-y-4">
      <RememberList section="today" />
      {bar}
      <div>
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="text-sm text-muted-foreground">{working.id ? `Work waiting at ${where}.` : "Work waiting across all warehouses."} Each row is one job: open it, or press its button.</p>
      </div>

      {data.failed.map((s) => (
        <Alert key={s} variant="destructive" className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
          <p><strong>{SOURCE_NOUN[s]} could not be loaded.</strong> {FAILURE_TAIL} <Link href={retryHref} className="font-medium underline underline-offset-2">Try again</Link></p>
        </Alert>
      ))}
      {data.notes.map((t) => <Alert key={t} variant="warning" role="status">{t}</Alert>)}

      <nav aria-label="Show" className="flex flex-wrap gap-2">
        {SHOW_FILTERS.map((k) => {
          const c = counts[k];
          const on = show === k;
          return (
            <Link
              key={k} href={withParams(BASE, sp, { show: k === "all" ? null : k })} scroll={false} aria-current={on ? "true" : undefined}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-accent bg-accent/15 font-semibold" : "border-border text-muted-foreground hover:bg-secondary/60")}
            >
              {FILTER_LABEL[k]}
              <span className="rounded-full bg-secondary px-1.5 text-xs tabular-nums" title={c === null ? "Could not be loaded" : undefined}>{c === null ? "?" : c}<span className="sr-only">{c === null ? " (could not be loaded)" : ""}</span></span>
            </Link>
          );
        })}
      </nav>

      {isQueueEmpty(data.rows, data.failed) ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-12 text-center">
          <PackageOpen className="h-8 w-8 text-muted-foreground" aria-hidden />
          <h2 className="font-heading text-lg font-semibold">Nothing waiting{working.id ? ` at ${where}` : ""}</h2>
          <p className="max-w-md text-sm text-muted-foreground">No requests to prepare, dispatches due, returns, incoming transfers, shortages, held equipment or Sales checks. Open Stock to receive new stock or look something up.</p>
          <Link href="/inventory/stock" className={cn(buttonVariants({ size: "sm" }), "mt-2 h-11 w-full sm:h-9 sm:w-auto")}>Go to Stock</Link>
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground" role="status">
          {data.failed.length > 0 ? "Nothing to show from the sources that did load." : `Nothing waiting under ${FILTER_LABEL[show]}.`}
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.bucket} aria-labelledby={`today-${g.bucket}`} className="overflow-hidden rounded-lg border border-border bg-card">
              <h2 id={`today-${g.bucket}`} className={cn("flex items-center gap-2 border-b border-border/70 px-4 py-2 text-sm font-semibold", g.bucket === "late" && "text-destructive")}>
                {GROUP_LABEL[g.bucket]}<span className="rounded-full bg-secondary px-1.5 text-xs font-normal tabular-nums text-foreground">{g.rows.length}</span>
              </h2>
              <ul className="divide-y divide-border/70">{g.rows.map((r) => <TodayRow key={r.id} row={r} canOperate={canOperate} checkLocations={checkLocations} />)}</ul>
            </section>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Dates come from each record. A Sales check has no deadline, so it sits under “Waiting, no date set”. Lines waiting to be bought or rented stay under “Waiting / Shortages” until the stock is received and reserved. A check is not a reservation.
        {working.id ? " Counted items (cables, consumables) that are out with people or on projects are not split by warehouse, so they are listed only when you choose All warehouses." : ""}
      </p>
    </div>
  );
}
