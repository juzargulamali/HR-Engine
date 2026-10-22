import Link from "next/link";
import { canOperateAnyStock } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatMoney } from "@/components/sales/format";
import { ActionMenu, type ActionSpec } from "@/components/inventory/stock/action-menu";
import { KitLineForm } from "@/components/inventory/stock/item-forms";
import { LiveKitPackForm } from "@/components/inventory/stock/live-forms";
import type { KitRow } from "@/components/inventory/stock/kit-forms";
import { listTable } from "@/components/workspace/list-table";
import { PanelLink } from "@/components/workspace/panel-link";
import { SidePanel } from "@/components/workspace/side-panel";
import { LoadError } from "@/components/workspace/states";
import { createClient } from "@/lib/supabase/server";
import { getInventoryContext } from "@/lib/inventory/context";
import { loadFormContext, loadUnitDetail, type UnitDetail } from "@/lib/inventory/stock";
import { candidateBase, type FormContext } from "@/lib/inventory/stock-candidates";
import { CUSTODY_WORDS, formatQty } from "@/lib/inventory/words";
import { cn } from "@/lib/utils";
import { HistoryList, makeResolver } from "./history";
import { ConditionBadge, LifecycleBadge, Section } from "./parts";

type Here = (patch?: Record<string, string | null>) => string;
const EMPTY_FORM: FormContext = { locations: [], destinations: [], projects: [], requests: [], transfers: [], rentals: [], canSeeCostsByCompany: {} };

/**
 * One physical unit (?unit=ID or ?unit=UAE-E-00042): everything about it, its checklist if it is a kit, its whole movement history, and the
 * actions that apply to it right now. Only people who may view stock can read a unit at all; to everyone else it is simply "not found".
 */
export async function UnitSidePanel({ unitRef, closeHref, here }: { unitRef: string; closeHref: string; here: Here }) {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const shell = (title: string, children: React.ReactNode, subtitle?: string) => <SidePanel title={title} subtitle={subtitle} closeHref={closeHref}>{children}</SidePanel>;
  let d: UnitDetail | null;
  try {
    d = await loadUnitDetail(ctx, unitRef);
  } catch (e) {
    console.error("[inventory] unit panel load failed", e);
    return shell("Unit", <LoadError what="this unit" retryHref={here({ unit: unitRef })} />);
  }
  if (!d) return shell("Unit not found", <Alert role="status">No equipment with that ID was found, or you do not have access to it.</Alert>);

  const { unit: u, item } = d;
  const canOperateStock = canOperateAnyStock(ctx.grants) && d.canOperate;
  let form: FormContext = EMPTY_FORM;
  if (canOperateStock) {
    try { form = await loadFormContext(ctx, { projects: true, requests: true, rentals: true }); } catch (e) { console.error("[inventory] unit panel form context failed", e); }
  }
  const resolver = makeResolver(d.locations, d.bins, d.names);
  const isKit = item.tracking === "kit";
  const overdue = u.overdue;
  const cand = candidateBase({
    key: `unit-${u.id}`, type: "unit", unitId: u.id, code: u.code, serial: u.serial_number, itemId: item.id, itemName: item.name, condition: u.condition, lifecycle: u.lifecycle,
    custody: u.custody_kind, locationId: u.location_id, binId: u.bin_id, binLabel: u.binLabel, rentalId: u.rental_id, repairReference: u.repair_reference, inKit: !!u.in_kit_id,
    employeeId: u.employee_id, employeeName: u.employeeName, projectId: u.project_id, projectName: u.projectName, where: u.where,
  });
  const base = { candidates: [cand], locationId: u.location_id ?? undefined };
  const onShelf = u.lifecycle === "active" && u.custody_kind === "warehouse";
  const usable = onShelf && (u.condition === "good" || u.condition === "fair") && !u.in_kit_id;
  const code = encodeURIComponent(u.code);
  const quick: { label: string; href: string }[] = [];
  if (canOperateStock) {
    if (usable) {
      quick.push({ label: "Issue to a person", href: here({ action: "issue", codes: u.code, unit: null, open: null }) });
      quick.push({ label: "Dispatch to a project", href: here({ action: "dispatch", codes: u.code, unit: null, open: null }) });
      quick.push({ label: "Send to another location", href: here({ action: "transfer", codes: u.code, unit: null, open: null }) });
    }
    if (u.custody_kind === "employee") quick.push({ label: "Return from employee", href: here({ action: "return", codes: u.code, employee: u.employee_id, unit: null, open: null }) });
    if (u.custody_kind === "project") quick.push({ label: "Return from project", href: here({ action: "return", codes: u.code, project: u.project_id, unit: null, open: null }) });
    if (u.custody_kind === "transit" && u.transfer_id) quick.push({ label: "Receive the transfer", href: here({ action: "transfer", mode: "receive", transfer: u.transfer_id, unit: null, open: null }) });
  }

  const specs: ActionSpec[] = [];
  if (canOperateStock) {
    if (u.lifecycle === "missing") specs.push({ key: "found", label: "Mark found", hint: "It turned up again", movement: { kind: "adjust", initial: { ...base, adjustAction: "found" }, title: `Mark ${u.code} as found` } });
    if (onShelf) {
      specs.push({ key: "check", label: "Check condition", hint: "Release it after a check, or hold it back", movement: { kind: "check", initial: base, title: `Check ${u.code}` } });
      specs.push({ key: "repair-out", label: "Send for repair", movement: { kind: "repair_out", initial: base, title: `Send ${u.code} for repair` } });
      if (u.ownership === "rental" && u.rental_id) specs.push({ key: "rental", label: "Return rental to supplier", hint: d.rental ? `${d.rental.supplier_name}, reference ${d.rental.external_reference}` : undefined, movement: { kind: "return_rental", initial: { ...base, rentalId: u.rental_id }, title: `Return ${u.code} to the supplier` } });
      specs.push({ key: "missing", label: "Mark missing", separatorBefore: true, movement: { kind: "adjust", initial: { ...base, adjustAction: "missing" }, title: `Mark ${u.code} as missing` } });
      specs.push({ key: "retire", label: "Retire (write off)", danger: true, movement: { kind: "adjust", initial: { ...base, adjustAction: "retire" }, title: `Retire ${u.code}` } });
    }
    if (u.custody_kind === "repair") specs.push({ key: "repair-in", label: "Back from repair", movement: { kind: "repair_in", initial: base, title: `${u.code} back from repair` } });
    if (u.custody_kind === "project" && u.project_id) specs.push({ key: "project-move", label: "Move to another project", hint: "Directly, without coming back to the warehouse", movement: { kind: "project_transfer", initial: { ...base, projectId: u.project_id }, title: `Move ${u.code} to another project` } });
    if (isKit && onShelf) {
      specs.push({ key: "pack", label: "Pack the kit", hint: "Tick what is in the box", separatorBefore: true, dialog: { title: `Pack kit ${u.code}`, description: "Missing and substituted items are recorded, never hidden." } });
      if (d.kit.some((k) => k.status !== "missing")) specs.push({ key: "unpack", label: "Unpack the kit", movement: { kind: "unpack_kit", initial: { locationId: u.location_id ?? undefined, kitUnitId: u.id, kitLabel: `${u.code} (${item.name})` }, title: `Unpack kit ${u.code}` } });
    }
  }
  if (isKit && d.canEdit) {
    specs.push({ key: "checklist", label: "Edit the checklist", hint: "What belongs in this kit", separatorBefore: true, dialog: { title: `Checklist of ${u.code}`, description: "Changing the checklist moves no stock." } });
  }
  specs.push({ key: "print", label: "Print label", href: `/inventory/labels?codes=${code}`, separatorBefore: true });

  let checklistItems: { id: string; name: string }[] = [];
  if (isKit && d.canEdit) {
    const db = await createClient();
    const { data } = await db.from("inv_items").select("id, name").eq("company_id", u.company_id).eq("status", "active").neq("tracking", "kit").order("name").limit(500);
    checklistItems = data ?? [];
  }
  const kitRows: KitRow[] = d.kit.map((k) => ({
    itemId: k.item_id, itemName: k.itemName, tracking: k.itemTracking, uom: k.itemUom, scale: k.itemScale, expectedQty: Number(k.expected_qty), required: k.is_required, status: k.status,
    packedText: k.status === "missing" ? null : k.contentCode ? `${k.substituteName ? `${k.substituteName} ` : ""}${k.contentCode}` : k.present_qty ? `${formatQty(k.present_qty, k.itemUom)}${k.substituteName ? ` of ${k.substituteName}` : ""}` : null,
    options: d.packable.filter((p) => p.itemId === k.item_id).map((p) => ({ unitId: p.unitId ?? "", code: p.code ?? "", serial: p.serial })),
  }));
  const locationBins = d.bins.filter((b) => b.location_id === u.location_id).map((b) => ({ id: b.id, code: b.code, label: b.label }));
  const dialogs: Record<string, React.ReactNode> = {
    pack: u.location_id ? <LiveKitPackForm kit={{ unitId: u.id, code: u.code, companyId: u.company_id, locationId: u.location_id, locationName: u.locationName ?? "this location", itemName: item.name }} rows={kitRows} bins={locationBins} /> : null,
    checklist: (
      <div className="space-y-5">
        {d.kit.length > 0 ? d.kit.map((k) => <div key={k.id} className="rounded-md border border-border p-3"><KitLineForm kit={{ id: u.id, companyId: u.company_id }} items={checklistItems} current={{ itemId: k.item_id, itemName: k.itemName, expectedQty: Number(k.expected_qty), required: k.is_required, note: k.note }} /></div>) : <p className="text-sm text-muted-foreground">The checklist is empty. Add what belongs in this kit.</p>}
        <div className="rounded-md border border-dashed border-border p-3"><h4 className="mb-2 text-sm font-medium">Add an item to the checklist</h4><KitLineForm kit={{ id: u.id, companyId: u.company_id }} items={checklistItems.filter((i) => !d.kit.some((k) => k.item_id === i.id))} /></div>
      </div>
    ),
  };

  const detailRows: [string, React.ReactNode][] = [
    ["Item", <PanelLink key="i" href={here({ open: item.id, unit: null })} className="font-medium underline underline-offset-2">{item.name}</PanelLink>],
    ["Serial number", u.serial_number ?? "—"],
    ["Where it is", u.where || "—"],
    ...(u.expected_return_at && ["employee", "project", "transit", "repair"].includes(u.custody_kind) ? [["Expected back", <span key="e" className={overdue ? "font-medium text-destructive" : undefined}>{formatDateTime(u.expected_return_at)}{overdue ? " (overdue)" : ""}</span>] as [string, React.ReactNode]] : []),
    ...(u.in_kit_id ? [["Packed in kit", <PanelLink key="k" href={here({ unit: u.in_kit_id })} className="font-mono underline underline-offset-2">{d.inKitCode ?? "a kit"}</PanelLink>] as [string, React.ReactNode]] : []),
    ["Ownership", u.ownership === "rental" ? `Rented${d.rental ? ` from ${d.rental.supplier_name}, reference ${d.rental.external_reference}, back by ${formatDate(d.rental.return_deadline)}` : ""}` : "Owned"],
    ["Verified", u.verified_at ? `${formatDate(u.verified_at)} by ${d.names.user(u.verified_by)}` : "Not counted yet"],
    ["Registered", `${formatDate(u.created_at)}${u.created_by ? ` by ${d.names.user(u.created_by)}` : ""}`],
    ...(d.canSeeCosts ? [["Purchase cost", u.cost ? formatMoney(u.cost.amount, u.cost.currency) : "Not recorded"] as [string, React.ReactNode]] : []),
    ...(u.notes ? [["Notes", u.notes] as [string, React.ReactNode]] : []),
    ...(u.legacy_asset_id ? [["Earlier asset register", "This unit came from the HR asset register and is now managed here. Issuing and returning it here keeps the HR record in step."] as [string, React.ReactNode]] : []),
  ];

  return shell(
    `${u.code} · ${item.name}`,
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ConditionBadge condition={u.condition} />
        <LifecycleBadge lifecycle={u.lifecycle} />
        {u.ownership === "rental" ? <Badge variant="outline">Rented</Badge> : null}
        {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
        <span className="text-muted-foreground">{CUSTODY_WORDS[u.custody_kind]}</span>
      </div>
      {u.lifecycle === "draft" ? <Alert variant="warning" role="status">Not counted yet. It cannot be issued, dispatched or counted as available until the opening stock is confirmed.</Alert> : null}
      {u.lifecycle === "missing" ? <Alert variant="warning" role="status">Recorded as missing. If it turns up, mark it found; it is held for checking before anyone can use it.</Alert> : null}
      {u.lifecycle === "retired" ? <Alert role="status">Retired{u.retired_at ? ` on ${formatDate(u.retired_at)}` : ""}. Its history is kept.</Alert> : null}
      {(u.condition === "needs_inspection" || u.condition === "damaged" || u.condition === "unserviceable") && u.lifecycle === "active" ? <Alert variant="warning" role="status">Held back: it is not counted as available until someone checks it and releases it.</Alert> : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Unit actions">
        {quick.map((q) => <Link key={q.label} href={q.href} scroll={false} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>{q.label}</Link>)}
        <ActionMenu specs={specs} context={form} dialogs={dialogs} />
      </div>

      <Section title="About this unit">
        <dl className="divide-y divide-border rounded-md border border-border text-sm">
          {detailRows.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-[13px] font-medium text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>
          ))}
        </dl>
      </Section>

      {isKit ? (
        <Section title="Kit contents">
          {d.kit.length === 0 ? <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">No checklist yet. {d.canEdit ? "Use More actions, Edit the checklist, to say what belongs in this kit." : "Someone who manages the catalogue sets it up."}</p> : (
            <Table className={cn("min-w-[26rem]", listTable)}>
              <caption className="sr-only">Checklist of this kit</caption>
              <TableHeader><TableRow><TableHead scope="col">Item</TableHead><TableHead scope="col">Needed</TableHead><TableHead scope="col">In the kit</TableHead><TableHead scope="col">State</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.kit.map((k) => (
                  <TableRow key={k.id} className="align-top">
                    <TableCell className="font-medium">{k.itemName}{!k.is_required ? <span className="block text-[13px] font-normal text-muted-foreground">Optional</span> : null}{k.note ? <span className="block text-[13px] font-normal text-muted-foreground">{k.note}</span> : null}</TableCell>
                    <TableCell data-label="Needed" className="tabular-nums">{formatQty(k.expected_qty, k.itemUom)}</TableCell>
                    <TableCell data-label="In the kit">{k.contentCode ? <PanelLink href={here({ unit: k.content_unit_id })} className="font-mono underline underline-offset-2">{k.contentCode}</PanelLink> : Number(k.present_qty) > 0 ? formatQty(k.present_qty, k.itemUom) : "—"}</TableCell>
                    <TableCell data-label="State">{k.status === "present" ? <Badge variant="success">Present</Badge> : k.status === "substituted" ? <Badge variant="warning">Substituted by {k.substituteName}</Badge> : <Badge variant={k.is_required ? "destructive" : "secondary"}>Missing</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      ) : null}

      <Section title="History" aside={<Link href={`/inventory/movements?item=${item.id}`} className="text-sm font-medium underline-offset-2 hover:underline">All movements of this item</Link>}>
        <HistoryList rows={d.history} names={d.names} resolver={resolver} itemName={() => item.name} locations={d.locations} fallbackZone={d.locations[0]?.timezone ?? "Asia/Dubai"} emptyText="Nothing has been recorded for this unit yet." linkToLedger />
        {d.historyTruncated ? <p className="text-sm text-muted-foreground">Showing the latest 200 entries.</p> : null}
      </Section>
    </div>,
    `${item.status === "retired" ? "Retired item · " : ""}${d.companyName}`,
  );
}
