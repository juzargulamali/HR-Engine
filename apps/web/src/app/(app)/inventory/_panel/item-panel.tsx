import Link from "next/link";
import { canOperateAnyStock } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/components/sales/format";
import { ActionMenu, type ActionSpec } from "@/components/inventory/stock/action-menu";
import { AddUnitForm, BinLabelForm, EditItemForm, ReplaceItemForm, type CategoryOption } from "@/components/inventory/stock/item-forms";
import { UnitsTable, type UnitRowView } from "@/components/inventory/stock/units-table";
import { listTable } from "@/components/workspace/list-table";
import { PanelLink } from "@/components/workspace/panel-link";
import { SidePanel } from "@/components/workspace/side-panel";
import { LoadError } from "@/components/workspace/states";
import { parseRecordId } from "@/components/workspace/url-state";
import { getInventoryContext } from "@/lib/inventory/context";
import { loadFormContext, loadItemDetail, type ItemDetail } from "@/lib/inventory/stock";
import { categoryPath, fmt, outText } from "@/lib/inventory/stock-list";
import type { FormContext } from "@/lib/inventory/stock-candidates";
import { CUSTODY_WORDS, TRACKING_WORDS, formatQty } from "@/lib/inventory/words";
import { cn } from "@/lib/utils";
import { HistoryList, makeResolver } from "./history";
import { ConditionBadge, Section, Stat, conditionLabel, lifecycleLabel, trackingLabel } from "./parts";

type Here = (patch?: Record<string, string | null>) => string;
const MAX_LABEL_CODES = 100;

/**
 * One catalogue item beside the list (?open=ITEM_ID). Everyone with Inventory access sees what the item is and how many are usable now;
 * who holds what, where each unit is, the movements and the costs appear only for people the database lets read them (the page asks the
 * database as the signed-in person, so what it does not return is simply not there).
 */
export async function ItemSidePanel({ openId, closeHref, here, binCode }: { openId: string; closeHref: string; here: Here; binCode: string | null }) {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const id = parseRecordId(openId);
  const shell = (title: string, children: React.ReactNode, subtitle?: string) => <SidePanel title={title} subtitle={subtitle} closeHref={closeHref}>{children}</SidePanel>;
  if (!id) return shell("Item not found", <Alert role="status">That link does not point to an item.</Alert>);
  let d: ItemDetail | null;
  try {
    d = await loadItemDetail(ctx, id);
  } catch (e) {
    console.error("[inventory] item panel load failed", e);
    return shell("Item", <LoadError what="this item" retryHref={here({ open: id })} />);
  }
  if (!d) return shell("Item not found", <Alert role="status">This item does not exist, or you do not have access to it.</Alert>);

  let form: FormContext | null = null;
  if (canOperateAnyStock(ctx.grants)) {
    try { form = await loadFormContext(ctx, { projects: true, requests: true }); } catch (e) { console.error("[inventory] item panel form context failed", e); }
  }
  const { item } = d;
  const operableHere = (form?.locations ?? []).filter((l) => l.companyId === item.company_id);
  const canOperate = operableHere.length > 0;
  const individual = item.tracking === "individual" || item.tracking === "kit";
  const counted = !individual;
  const categoryOptions: CategoryOption[] = d.categories.filter((c) => c.is_active).map((c) => ({ id: c.id, label: categoryPath(d.categories, c.id) ?? c.name })).sort((a, b) => a.label.localeCompare(b.label));
  const locationsForUnit = (canOperate && !d.canEdit ? operableHere.map((l) => ({ id: l.id, name: l.name, bins: l.bins })) : d.locations.filter((l) => l.is_active).map((l) => ({ id: l.id, name: l.name, bins: d.bins.filter((b) => b.location_id === l.id).map((b) => ({ id: b.id, code: b.code, label: b.label })) })));
  const subtitle = [d.categoryName, trackingLabel(item.tracking)].filter(Boolean).join(" · ");
  const resolver = makeResolver(d.locations, d.bins, d.names);
  const c = d.counts;
  const unitLink = (unitId: string) => here({ unit: unitId });
  const totalCodes = d.units.map((u) => u.code);

  const specs: ActionSpec[] = [];
  const search = { search: item.name };
  if (item.status !== "retired") {
    if (individual && (d.canEdit || canOperate)) specs.push({ key: "add-unit", label: "Add unit", hint: "Register one more individual unit with its own ID", dialog: { title: `Add a unit of ${item.name}`, description: "It starts as “Not counted yet” until the opening stock is confirmed." } });
    if (counted && (d.canEdit || canOperate)) specs.push({ key: "bin-label", label: "Create a bin label", hint: "A label for this item in one bin", dialog: { title: "Create a bin label" } });
    if (canOperate && d.detail) {
      if (item.tracking === "consumable") {
        specs.push({ key: "consume", label: "Use up", hint: "Record consumables that were used", movement: { kind: "consume", initial: search, title: `Use up ${item.name}` } });
        specs.push({ key: "return-unused", label: "Return unused", hint: "Unused consumables back on the shelf", movement: { kind: "return_unused", initial: search, title: `Return unused ${item.name}` } });
      }
      specs.push({ key: "check", label: "Check condition", hint: "Release held stock or hold it back", separatorBefore: true, movement: { kind: "check", initial: search, title: `Check ${item.name}` } });
      specs.push({ key: "repair-out", label: "Send for repair", movement: { kind: "repair_out", initial: search, title: `Send ${item.name} for repair` } });
      if (individual) specs.push({ key: "repair-in", label: "Back from repair", movement: { kind: "repair_in", initial: search, title: `${item.name} back from repair` } });
      specs.push({ key: "missing", label: "Mark missing", movement: { kind: "adjust", initial: { ...search, adjustAction: "missing" }, title: `Mark ${item.name} as missing` } });
      specs.push({ key: "found", label: "Mark found", movement: { kind: "adjust", initial: { ...search, adjustAction: "found" }, title: `Mark ${item.name} as found` } });
      specs.push({ key: "retire", label: "Retire (write off)", danger: true, movement: { kind: "adjust", initial: { ...search, adjustAction: "retire" }, title: `Retire ${item.name}` } });
    }
    if (d.canEdit) specs.push({ key: "replace", label: "Replace item", hint: "Retire it and make a new item in its place", separatorBefore: true, danger: true, dialog: { title: `Replace ${item.name}`, description: "A reason is needed. Nothing is deleted." } });
  }
  if (totalCodes.length > 0) specs.push({ key: "print-all", label: totalCodes.length > MAX_LABEL_CODES ? `Print labels (first ${MAX_LABEL_CODES} units)` : "Print labels for all units", href: `/inventory/labels?codes=${encodeURIComponent(totalCodes.slice(0, MAX_LABEL_CODES).join(","))}`, separatorBefore: true });

  const dialogs: Record<string, React.ReactNode> = {
    "add-unit": <AddUnitForm item={{ id: item.id, companyId: item.company_id, name: item.name }} locations={locationsForUnit} canSeeCosts={d.canSeeCosts} defaultLocationId={operableHere[0]?.id} />,
    "bin-label": <BinLabelForm item={{ id: item.id, companyId: item.company_id }} locations={locationsForUnit} />,
    replace: <ReplaceItemForm item={{ id: item.id, name: item.name, categoryId: item.category_id, manufacturer: item.manufacturer, model: item.model, specification: item.specification, uom: item.unit_of_measure, counted }} categories={categoryOptions} />,
  };

  const unitRows: UnitRowView[] = d.units.map((u) => ({
    id: u.id, code: u.code, serial: u.serial_number, condition: conditionLabel(u.condition), lifecycle: u.lifecycle === "active" ? null : lifecycleLabel(u.lifecycle),
    where: u.where || null, cost: u.cost ? formatMoney(u.cost.amount, u.cost.currency) : null, href: unitLink(u.id),
  }));
  const inWarehouse = d.balances.filter((b) => b.holder_kind === "warehouse");
  const elsewhere = d.balances.filter((b) => b.holder_kind !== "warehouse");
  const hasStock = item.status !== "draft" || d.units.length > 0 || d.balances.length > 0;

  return shell(
    item.name,
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{trackingLabel(item.tracking)}</Badge>
        {item.status === "draft" ? <Badge variant="warning">Draft: not in use yet</Badge> : null}
        {item.status === "retired" ? <Badge variant="outline">Retired</Badge> : null}
        {ctx.companies.length > 1 || !ctx.companies.some((x) => x.id === item.company_id) ? <span className="text-muted-foreground">{d.companyName}</span> : null}
        {[item.manufacturer, item.model, item.specification].filter(Boolean).length > 0 ? <span className="min-w-0 break-words text-muted-foreground">{[item.manufacturer, item.model, item.specification].filter(Boolean).join(" · ")}</span> : null}
      </div>
      <p className="-mt-3 text-sm text-muted-foreground">{TRACKING_WORDS[item.tracking].help}</p>
      {item.status === "retired" && d.replacedBy ? <Alert role="status">Replaced by <PanelLink href={here({ open: d.replacedBy.id, unit: null })} className="font-medium underline underline-offset-2">{d.replacedBy.name}</PanelLink>.</Alert> : null}
      {item.status === "draft" ? <Alert variant="warning" role="status">This item is a draft, so stock cannot be received for it yet. {d.canEdit ? "Open Edit details below and set its status to In use." : "Ask someone who manages the catalogue to put it in use."}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Item actions">
        {canOperate && item.status === "active" ? <Link href={here({ action: "receive", open: null, unit: null })} scroll={false} className={buttonVariants({ size: "sm" })}>Receive stock</Link> : null}
        {specs.length > 0 && form ? <ActionMenu specs={specs} context={form} dialogs={dialogs} /> : specs.length > 0 ? <ActionMenu specs={specs} context={{ locations: [], destinations: [], projects: [], requests: [], transfers: [], rentals: [], canSeeCostsByCompany: {} }} dialogs={dialogs} /> : null}
      </div>

      <Section title="At a glance">
        {d.detail ? (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Usable now" value={c.usable === null ? "—" : fmt(c.usable)} hint="On the shelf, good or fair, not reserved away" />
            <Stat label="In the warehouse" value={c.warehouse === null ? "—" : fmt(c.warehouse)} />
            <Stat label="With employees" value={c.outEmployees === null ? "—" : fmt(c.outEmployees)} />
            <Stat label="On projects" value={c.outProjects === null ? "—" : fmt(c.outProjects)} />
            <Stat label="In transit" value={c.inTransit === null ? "—" : fmt(c.inTransit)} />
            <Stat label="Reserved (future)" value={c.reserved === null ? "—" : fmt(c.reserved)} hint="Promised to requests, not yet taken" />
            {(c.attention ?? 0) > 0 ? <Stat label="Needs checking, damaged, missing or out for repair" value={fmt(c.attention ?? 0)} /> : null}
            {(c.draftUnits ?? 0) > 0 ? <Stat label="Not counted yet" value={fmt(c.draftUnits ?? 0)} hint="Counted once opening stock is confirmed" /> : null}
          </dl>
        ) : (
          <div className="space-y-2">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {d.summaryAvailability.length === 0 ? <Stat label="Usable now" value="—" /> : d.summaryAvailability.map((a) => <Stat key={a.locationId} label={`Usable now at ${a.name}`} value={fmt(a.usableNow)} />)}
            </dl>
            <p className="text-sm text-muted-foreground">You can see what the item is and how many are usable. Where each one is, who holds it, movements and costs are for the warehouse team.</p>
          </div>
        )}
        {d.detail && (c.outProjects ?? 0) + (c.outEmployees ?? 0) > 0 ? <p className="text-sm text-muted-foreground">Out: {outText(c)}.</p> : null}
      </Section>

      {d.detail && individual ? (
        <Section title="Units">
          {d.units.length === 0 ? <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No units yet. {item.status === "active" ? "Receive stock to create them with their IDs and labels, or add a unit." : "Put the item in use first."}</p> : <UnitsTable units={unitRows} showWhere showCost={d.canSeeCosts} truncated={d.unitsTruncated} />}
          {item.tracking === "kit" && d.units.length > 0 ? (
            <ul className="space-y-1 text-sm" aria-label="Kit checklists">
              {d.units.map((u) => { const k = d.kits.get(u.id); return <li key={u.id} className="text-muted-foreground"><PanelLink href={unitLink(u.id)} className="font-mono font-medium text-foreground underline-offset-2 hover:underline">{u.code}</PanelLink>: {k ? `${k.presentRequired} of ${k.required} required items present (${k.present} of ${k.items} in all)` : "no checklist yet"}</li>; })}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {d.detail && counted ? (
        <Section title="Stock by location and bin">
          {inWarehouse.length === 0 ? <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">Nothing on the shelf. Receive stock to add some.</p> : (
            <Table className={cn("min-w-[28rem]", listTable)}>
              <caption className="sr-only">Stock on the shelves, by location and bin</caption>
              <TableHeader><TableRow><TableHead scope="col">Where</TableHead><TableHead scope="col">Condition</TableHead><TableHead scope="col" className="text-right">Quantity</TableHead><TableHead scope="col">Bin label</TableHead></TableRow></TableHeader>
              <TableBody>
                {inWarehouse.map((b) => (
                  <TableRow key={b.id} className={cn("align-top", binCode && b.label_code === binCode && "bg-secondary/60")} aria-current={binCode && b.label_code === binCode ? "true" : undefined}>
                    <TableCell>{b.locationName ?? "—"}{b.binLabel ? `, bin ${b.binLabel}` : ""}{b.rental_id ? <span className="block text-[13px] text-muted-foreground">Rented, not owned</span> : null}</TableCell>
                    <TableCell data-label="Condition"><ConditionBadge condition={b.condition} /></TableCell>
                    <TableCell data-label="Quantity" className="whitespace-nowrap text-right tabular-nums">{formatQty(b.qty, item.unit_of_measure)}</TableCell>
                    <TableCell data-label="Bin label">{b.label_code ? <span className="inline-flex flex-wrap items-center gap-x-3"><span className="font-mono">{b.label_code}</span><Link href={`/inventory/labels?codes=${encodeURIComponent(b.label_code)}`} className="text-sm font-medium underline-offset-2 hover:underline" aria-label={`Print the label for bin label ${b.label_code}`}>Print label</Link></span> : <span className="text-muted-foreground">No label yet</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {binCode && !inWarehouse.some((b) => b.label_code === binCode) ? <Alert role="status">The bin label {binCode} has no stock of this item on the shelf right now.</Alert> : null}
          {elsewhere.length > 0 ? (
            <Table className={cn("min-w-[28rem]", listTable)}>
              <caption className="sr-only">Stock that is out of the warehouse</caption>
              <TableHeader><TableRow><TableHead scope="col">Out with</TableHead><TableHead scope="col">Condition</TableHead><TableHead scope="col" className="text-right">Quantity</TableHead><TableHead scope="col">Expected back</TableHead></TableRow></TableHeader>
              <TableBody>
                {elsewhere.map((b) => (
                  <TableRow key={b.id} className="align-top">
                    <TableCell>{CUSTODY_WORDS[b.holder_kind]}: {b.holderText}</TableCell>
                    <TableCell data-label="Condition"><ConditionBadge condition={b.condition} /></TableCell>
                    <TableCell data-label="Quantity" className="whitespace-nowrap text-right tabular-nums">{formatQty(b.qty, item.unit_of_measure)}</TableCell>
                    <TableCell data-label="Expected back">{b.expected_return_at ? formatDate(b.expected_return_at) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </Section>
      ) : null}

      {d.detail && hasStock ? (
        <Section title="Recent movements" aside={<Link href={`/inventory/movements?item=${item.id}`} className="text-sm font-medium underline-offset-2 hover:underline">All movements of this item</Link>}>
          <HistoryList rows={d.movements} names={d.names} resolver={resolver} itemName={() => item.name} locations={d.locations} fallbackZone={d.locations[0]?.timezone ?? "Asia/Dubai"} emptyText="Nothing has been recorded for this item yet." linkToLedger />
        </Section>
      ) : null}

      {d.canEdit && item.status !== "retired" ? (
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Edit details</summary>
          <div className="border-t border-border p-3">
            <EditItemForm
              key={item.version}
              categories={categoryOptions}
              canRetire
              item={{ id: item.id, companyId: item.company_id, name: item.name, categoryId: item.category_id, tracking: item.tracking, uom: item.unit_of_measure, scale: item.quantity_scale, manufacturer: item.manufacturer, model: item.model, specification: item.specification, notes: item.notes, status: item.status, version: item.version, locked: d.units.length > 0 || d.balances.length > 0 || !d.detail }}
            />
          </div>
        </details>
      ) : null}
    </div>,
    subtitle,
  );
}
