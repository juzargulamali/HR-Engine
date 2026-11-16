import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { InvItemRow, InvMovementRow, InvTransferRow, InvUnitRow } from "@/types/inventory";
import type { InventoryContext } from "./context";
import { loadNames } from "./stock";
import { viewFromTrace, type TransferView } from "./transfer-view";
import type { XEvent, XTrace, XTraceQty, XTraceUnit } from "./xshare";
import { loadXTrace, loadXTransfers } from "./xshare-data";

/**
 * Server-side reading of ONE transfer, for whoever may read it. Nothing new is read and no permission is added:
 *   * a transfer BETWEEN COMPANIES comes from the existing narrow function (`inv_xshare_transfer_trace`), which answers the owner / sender side and the
 *     receiving warehouse's operators and nobody else;
 *   * a transfer INSIDE one company comes from the person's own rows (`inv_transfers`, its movements and lines, the units and counted stock still in
 *     transit), which row level security gives only to people who may view that company's stock.
 * Both are shaped the same way, so the transfer page, Today and the forms say the same thing. Not found and not allowed are the same answer (null); any
 * other failed read throws, so the page says it could not load.
 */
type Db = Awaited<ReturnType<typeof createClient>>;

async function ownTrace(db: Db, ctx: InventoryContext, id: string): Promise<XTrace | null> {
  const { data: t, error } = await db.from("inv_transfers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`transfer: ${error.message}`);
  if (!t) return null;
  const tr = t as InvTransferRow;
  const { data: moves, error: mErr } = await db.from("inv_movements").select("id, code, kind, occurred_at, performed_by, company_id").eq("transfer_id", id).in("kind", ["transfer_dispatch", "transfer_receive"]).order("occurred_at").order("recorded_at");
  if (mErr) throw new Error(`transfer movements: ${mErr.message}`);
  const movements = (moves ?? []) as Pick<InvMovementRow, "id" | "code" | "kind" | "occurred_at" | "performed_by" | "company_id">[];
  const moveIds = movements.map((m) => m.id);
  const [lines, transitBalances] = await Promise.all([
    moveIds.length > 0 ? db.from("inv_movement_lines").select("movement_id, item_id, unit_id, qty, condition_from, condition_to").in("movement_id", moveIds).limit(5000) : Promise.resolve({ data: [], error: null }),
    db.from("inv_balances").select("item_id, qty, condition, rental_id").eq("transfer_id", id).eq("holder_kind", "transit").gt("qty", 0),
  ]);
  if (lines.error || transitBalances.error) throw new Error(`transfer lines: ${(lines.error ?? transitBalances.error)!.message}`);
  const lineRows = (lines.data ?? []) as { movement_id: string; item_id: string; unit_id: string | null; qty: number | string; condition_from: string | null; condition_to: string | null }[];
  const unitIds = [...new Set(lineRows.map((l) => l.unit_id).filter((x): x is string => !!x))];
  const itemIds = [...new Set(lineRows.map((l) => l.item_id))];
  const [units, items] = await Promise.all([
    unitIds.length > 0 ? db.from("inv_units").select("id, code, serial_number, item_id, company_id, ownership, custody_kind, transfer_id, location_id, condition").in("id", unitIds.slice(0, 1000)) : Promise.resolve({ data: [], error: null }),
    itemIds.length > 0 ? db.from("inv_items").select("id, name, unit_of_measure, company_id").in("id", itemIds.slice(0, 1000)) : Promise.resolve({ data: [], error: null }),
  ]);
  if (units.error || items.error) throw new Error(`transfer contents: ${(units.error ?? items.error)!.message}`);
  const itemById = new Map(((items.data ?? []) as Pick<InvItemRow, "id" | "name" | "unit_of_measure" | "company_id">[]).map((i) => [i.id, i]));
  const unitById = new Map(((units.data ?? []) as Pick<InvUnitRow, "id" | "code" | "serial_number" | "item_id" | "company_id" | "ownership" | "custody_kind" | "transfer_id" | "location_id" | "condition">[]).map((u) => [u.id, u]));
  const names = await loadNames(db, ctx, { userIds: [tr.dispatched_by, tr.received_by, ...movements.map((m) => m.performed_by)].filter((x): x is string => !!x) });
  const dispatchIds = new Set(movements.filter((m) => m.kind === "transfer_dispatch").map((m) => m.id));
  const fromLoc = ctx.locations.find((l) => l.id === tr.from_location_id);
  const toLoc = ctx.locations.find((l) => l.id === tr.to_location_id);

  const traceUnits: XTraceUnit[] = [];
  const seen = new Set<string>();
  for (const l of lineRows) {
    if (!l.unit_id || !dispatchIds.has(l.movement_id) || seen.has(l.unit_id)) continue;
    seen.add(l.unit_id);
    const u = unitById.get(l.unit_id);
    if (!u) continue;
    traceUnits.push({
      unitId: u.id, code: u.code, serial: u.serial_number, itemId: u.item_id, itemName: itemById.get(u.item_id)?.name ?? "Equipment", category: null, rented: u.ownership === "rental",
      ownerCompanyId: u.company_id, ownerName: ctx.companyName(u.company_id), onTheWay: u.custody_kind === "transit" && u.transfer_id === tr.id,
      atDestination: u.custody_kind === "warehouse" && u.location_id === tr.to_location_id, condition: u.condition, custody: u.custody_kind,
    });
  }
  traceUnits.sort((a, b) => a.code.localeCompare(b.code));
  const sentQty = new Map<string, number>();
  for (const l of lineRows) if (!l.unit_id && dispatchIds.has(l.movement_id)) sentQty.set(l.item_id, (sentQty.get(l.item_id) ?? 0) + Number(l.qty));
  const quantities: XTraceQty[] = [...sentQty.entries()].map(([itemId, sent]) => {
    const i = itemById.get(itemId);
    const left = ((transitBalances.data ?? []) as { item_id: string; qty: number | string; condition: string; rental_id: string | null }[]).filter((b) => b.item_id === itemId);
    return {
      itemId, itemName: i?.name ?? "Item", category: null, uom: i?.unit_of_measure ?? "each", ownerCompanyId: i?.company_id ?? tr.company_id, ownerName: ctx.companyName(i?.company_id ?? tr.company_id), sent,
      onTheWay: left.reduce((n, b) => n + Number(b.qty), 0), byCondition: left.map((b) => ({ condition: b.condition, qty: Number(b.qty), rented: b.rental_id !== null })),
    };
  }).sort((a, b) => a.itemName.localeCompare(b.itemName));
  const events: XEvent[] = movements.map((m) => ({
    movementCode: m.code, kind: m.kind === "transfer_receive" ? "transfer_receive" : "transfer_dispatch", at: m.occurred_at, by: names.user(m.performed_by), filedUnderCompanyId: m.company_id, filedUnderName: ctx.companyName(m.company_id),
    lines: lineRows.filter((l) => l.movement_id === m.id).map((l) => ({ code: l.unit_id ? (unitById.get(l.unit_id)?.code ?? null) : null, itemName: itemById.get(l.item_id)?.name ?? "Item", qty: Number(l.qty), conditionFrom: l.condition_from, conditionTo: l.condition_to })),
  }));
  const toCompanyId = toLoc?.company_id ?? tr.company_id;
  return {
    transfer: {
      transferId: tr.id, code: tr.code, status: tr.status, senderCompanyId: tr.company_id, senderName: ctx.companyName(tr.company_id),
      fromLocationId: tr.from_location_id, fromName: fromLoc?.name ?? "A warehouse", toLocationId: tr.to_location_id, toName: toLoc?.name ?? "A warehouse of another company",
      toCompanyId, toCompanyName: ctx.companyName(toCompanyId), dispatchedAt: tr.dispatched_at, expectedAt: tr.expected_at, receivedAt: tr.received_at, carrier: tr.carrier, reference: tr.reference,
      dispatchedBy: names.user(tr.dispatched_by), receivedBy: tr.received_by ? names.user(tr.received_by) : null,
      lineCount: traceUnits.length + quantities.length, stillOnTheWay: traceUnits.filter((u) => u.onTheWay).length + quantities.filter((q) => q.onTheWay > 0).length, sharingRevoked: false,
    },
    units: traceUnits, quantities, events,
  };
}

/** One transfer as the signed-in person may read it, or null (not found and not theirs are one answer). */
export async function loadTransferView(ctx: InventoryContext, id: string): Promise<TransferView | null> {
  const db = await createClient();
  const cross = await loadXTrace(id, db);
  if (cross) return viewFromTrace(cross);
  const own = await ownTrace(db, ctx, id);
  return own ? viewFromTrace(own) : null;
}

/** What a list needs of a transfer that is still open: where it is going, and how many of its lines have arrived. */
export interface OpenTransfer {
  id: string; code: string; fromLocationId: string; fromLabel: string; toLocationId: string; toLabel: string; toCompanyId: string; senderCompanyId: string;
  expectedAt: string | null; dispatchedAt: string; crossCompany: boolean;
  /** Lines sent and lines still in transit (a unit is one line, a counted item is one line). Null when they could not be counted: the row is still shown, without numbers. */
  lines: { sent: number; inTransit: number } | null;
}

/**
 * Every transfer still in transit that the person is a party to, on either side: the ones their own company filed (read through row level security) and the
 * ones between companies (from `inv_xshare_transfers`, which also answers the receiving warehouse's operators). A transfer is listed once.
 */
export async function loadOpenTransfers(ctx: InventoryContext): Promise<OpenTransfer[]> {
  const db = await createClient();
  const [own, cross] = await Promise.all([
    db.from("inv_transfers").select("id, code, company_id, from_location_id, to_location_id, expected_at, dispatched_at").eq("status", "in_transit").order("dispatched_at", { ascending: false }).limit(200),
    loadXTransfers(db),
  ]);
  if (own.error) throw new Error(`transfers: ${own.error.message}`);
  const loc = new Map(ctx.locations.map((l) => [l.id, l]));
  const label = (id: string, companyName: string) => `${loc.get(id)?.name ?? "A warehouse"} · ${companyName}`;
  const crossOpen = cross.filter((t) => t.status === "in_transit");
  const crossIds = new Set(crossOpen.map((t) => t.transferId));
  const ownRows = (own.data ?? []).filter((t) => !crossIds.has(t.id));

  // Lines of the person's own transfers, counted in three reads for all of them. A failure leaves the rows without numbers, never with a zero.
  const counted = new Map<string, { sent: Set<string>; inTransit: Set<string> }>();
  let countsKnown = true;
  if (ownRows.length > 0) {
    const ids = ownRows.map((t) => t.id);
    const [moves, units, balances] = await Promise.all([
      db.from("inv_movements").select("transfer_id, inv_movement_lines(item_id, unit_id)").in("transfer_id", ids).eq("kind", "transfer_dispatch").limit(1000),
      db.from("inv_units").select("id, transfer_id").in("transfer_id", ids).eq("custody_kind", "transit").limit(5000),
      db.from("inv_balances").select("item_id, transfer_id").in("transfer_id", ids).eq("holder_kind", "transit").gt("qty", 0).limit(5000),
    ]);
    if (moves.error || units.error || balances.error) {
      console.error("[inventory] transfer contents could not be counted", (moves.error ?? units.error ?? balances.error)!.message);
      countsKnown = false;
    } else {
      const of = (id: string) => counted.get(id) ?? counted.set(id, { sent: new Set(), inTransit: new Set() }).get(id)!;
      for (const m of (moves.data ?? []) as unknown as { transfer_id: string | null; inv_movement_lines: { item_id: string; unit_id: string | null }[] }[]) {
        if (m.transfer_id) for (const l of m.inv_movement_lines ?? []) of(m.transfer_id).sent.add(l.unit_id ? `unit:${l.unit_id}` : `item:${l.item_id}`);
      }
      for (const u of units.data ?? []) if (u.transfer_id) of(u.transfer_id).inTransit.add(`unit:${u.id}`);
      for (const b of balances.data ?? []) if (b.transfer_id) of(b.transfer_id).inTransit.add(`item:${b.item_id}`);
    }
  }
  const out: OpenTransfer[] = [];
  for (const t of ownRows) {
    const toCompanyId = loc.get(t.to_location_id)?.company_id ?? t.company_id;
    const c = counted.get(t.id);
    out.push({
      id: t.id, code: t.code, fromLocationId: t.from_location_id, fromLabel: label(t.from_location_id, ctx.companyName(t.company_id)),
      toLocationId: t.to_location_id, toLabel: label(t.to_location_id, ctx.companyName(toCompanyId)), toCompanyId, senderCompanyId: t.company_id,
      expectedAt: t.expected_at, dispatchedAt: t.dispatched_at, crossCompany: toCompanyId !== t.company_id, lines: countsKnown ? { sent: c?.sent.size ?? 0, inTransit: c?.inTransit.size ?? 0 } : null,
    });
  }
  for (const t of crossOpen) {
    out.push({
      id: t.transferId, code: t.code, fromLocationId: t.fromLocationId, fromLabel: `${t.fromName} · ${t.senderName}`, toLocationId: t.toLocationId, toLabel: `${t.toName} · ${t.toCompanyName}`,
      toCompanyId: t.toCompanyId, senderCompanyId: t.senderCompanyId, expectedAt: t.expectedAt, dispatchedAt: t.dispatchedAt, crossCompany: true, lines: { sent: t.lineCount, inTransit: t.stillOnTheWay },
    });
  }
  return out;
}
