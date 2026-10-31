import type { Candidate } from "./stock-candidates";
import type { RequestModel } from "./planning-data";

/**
 * Pure rules for the project equipment workspace (Prepare, Send out, Receive back). Nothing here decides what is allowed: the database does
 * (it refuses an unreserved unit, too much, a bad condition). These helpers shape what the screen shows, warn BEFORE confirmation about what the
 * database would refuse or what is only partial, and, above all, say honestly at which level a number can be trusted:
 *
 *  - a unit is exact everywhere (the reservation names the unit, and a return names the unit);
 *  - counted stock is exact for what was sent against a request, and exact for what the PROJECT still holds, but a return of counted stock is
 *    recorded against the project and the item, not against a request line, so "returned for this request" is only shown when nothing else
 *    could have been returned in its place.
 */

const isIndividual = (tracking: string) => tracking === "individual" || tracking === "kit";
const n = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

// ---------------------------------------------------------------------------------------------------------------
// Send out: what is reserved and not yet sent
// ---------------------------------------------------------------------------------------------------------------

export interface SendUnit { unitId: string; code: string | null; serial: string | null }
export interface SendItem {
  itemId: string;
  name: string;
  model: string | null;
  tracking: string;
  individual: boolean;
  uom: string;
  scale: number;
  /** Reserved units not yet sent (individual items). */
  units: SendUnit[];
  /** Reserved quantity not yet sent, over every line of the request for this item (counted items). */
  countedToSend: number;
  reserved: number;
  sent: number;
}

/** One entry per item (never per line: the database matches a dispatch to reservations by request and item, so a split by line would be a guess). */
export function sendItemsOf(model: RequestModel): SendItem[] {
  const byItem = new Map<string, SendItem>();
  for (const l of model.lines) {
    if (l.status !== "open") continue;
    // A proposed substitute is not accepted yet: the reservation is on the line's own item (what the line says), as the database reads it.
    const item = byItem.get(l.itemId) ?? { itemId: l.itemId, name: l.itemName, model: l.itemModel, tracking: l.tracking, individual: isIndividual(l.tracking), uom: l.unit, scale: l.scale, units: [], countedToSend: 0, reserved: 0, sent: 0 };
    for (const r of l.reservations) {
      if (r.status === "released") continue;
      const qty = n(r.qty), sent = n(r.dispatched_qty);
      item.reserved += qty;
      item.sent += sent;
      if (r.status !== "active") continue;
      if (r.unit_id) { if (sent < qty) item.units.push({ unitId: r.unit_id, code: r.unit_code ?? null, serial: r.serial_number ?? null }); }
      else item.countedToSend += Math.max(0, qty - sent);
    }
    byItem.set(l.itemId, item);
  }
  return [...byItem.values()].filter((i) => i.reserved > 0).sort((a, b) => a.name.localeCompare(b.name));
}

/** The equipment IDs of this request's units that are already out (so a scan can say "already sent" instead of "not reserved"). */
export function sentCodesOf(model: RequestModel): string[] {
  const out = new Set<string>();
  for (const l of model.lines) for (const r of l.reservations) if (r.unit_id && r.unit_code && n(r.dispatched_qty) > 0) out.add(r.unit_code);
  return [...out];
}

export interface SendSelection { itemId: string; units: readonly string[]; counted: number | null }
export interface Flag { level: "block" | "warn"; text: string }

/**
 * What to tell the person before they confirm. "block": the database would refuse it. "warn": allowed, but only part of what is reserved.
 * A code that is not on the reserved list can never be sent for this request; an unplanned dispatch is a separate, labelled exception.
 */
export function sendFlags(items: readonly SendItem[], selection: readonly SendSelection[], notReserved: readonly string[]): Flag[] {
  const out: Flag[] = [];
  for (const code of notReserved) out.push({ level: "block", text: `${code} is not reserved for this request, so the system would refuse it. Take it off the list, or send it as an unplanned dispatch (it will not fulfil this request).` });
  for (const sel of selection) {
    const item = items.find((i) => i.itemId === sel.itemId);
    if (!item) continue;
    if (item.individual) {
      const picked = sel.units.length;
      if (picked > 0 && picked < item.units.length) out.push({ level: "warn", text: `${item.name}: sending ${picked} of ${item.units.length} reserved. The other ${item.units.length - picked} stay reserved and unsent.` });
    } else if (sel.counted !== null) {
      if (sel.counted > item.countedToSend) out.push({ level: "block", text: `${item.name}: ${sel.counted} counted, but only ${item.countedToSend} are reserved and still to send.` });
      else if (sel.counted > 0 && sel.counted < item.countedToSend) out.push({ level: "warn", text: `${item.name}: sending ${sel.counted} of ${item.countedToSend} reserved. The other ${item.countedToSend - sel.counted} stay reserved and unsent.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Receive back: Sent / Returned / Still out, at the level the data supports
// ---------------------------------------------------------------------------------------------------------------

export interface ItemTotals {
  itemId: string;
  name: string;
  individual: boolean;
  /** Sent against THIS request (exact: the dispatch names the request). */
  sent: number;
  /** Returned for this request, or null when the data cannot say. */
  returned: number | null;
  /** Still out. For a request-level figure this is sent minus returned; at project level it is what the project holds. Null when unknown. */
  stillOut: number | null;
  level: "request" | "project";
  /** Why the figures are at project level, in plain words. */
  note: string | null;
}

/** What the project holds per item, from the units and counted rows it is recorded as holding (the same list the return form uses). */
export function heldTotals(held: readonly Pick<Candidate, "itemId" | "type" | "qty">[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of held) m.set(c.itemId, (m.get(c.itemId) ?? 0) + (c.type === "unit" ? 1 : n(c.qty)));
  return m;
}

export function requestItemTotals(model: RequestModel, projectModels: readonly RequestModel[], held: ReadonlyMap<string, number> | null): ItemTotals[] {
  const lineCount = new Map<string, number>();
  const sent = new Map<string, number>();
  const returned = new Map<string, number>();
  const name = new Map<string, { name: string; individual: boolean }>();
  for (const l of model.lines) {
    if (l.status === "cancelled") continue;
    lineCount.set(l.itemId, (lineCount.get(l.itemId) ?? 0) + 1);
    name.set(l.itemId, { name: l.itemName, individual: isIndividual(l.tracking) });
    for (const r of l.reservations) {
      if (r.status === "released" && n(r.dispatched_qty) === 0) continue;
      sent.set(l.itemId, (sent.get(l.itemId) ?? 0) + n(r.dispatched_qty));
      returned.set(l.itemId, (returned.get(l.itemId) ?? 0) + n(r.returned_qty));
    }
  }
  // Other requests of the same project that sent the same item: a counted return cannot be told apart from theirs.
  const otherSent = new Map<string, number>();
  for (const m of projectModels) {
    if (m.request.id === model.request.id) continue;
    for (const l of m.lines) for (const r of l.reservations) otherSent.set(l.itemId, (otherSent.get(l.itemId) ?? 0) + n(r.dispatched_qty));
  }
  const out: ItemTotals[] = [];
  for (const [itemId, sentQty] of sent) {
    if (sentQty <= 0) continue;
    const info = name.get(itemId)!;
    const ret = returned.get(itemId) ?? 0;
    if (info.individual) {
      out.push({ itemId, name: info.name, individual: true, sent: sentQty, returned: ret, stillOut: Math.max(0, sentQty - ret), level: "request", note: null });
      continue;
    }
    const heldNow = held?.get(itemId) ?? null;
    const single = (lineCount.get(itemId) ?? 0) === 1 && (otherSent.get(itemId) ?? 0) === 0;
    const consistent = heldNow !== null && Math.abs(heldNow - (sentQty - ret)) < 1e-9;
    if (single && consistent) {
      out.push({ itemId, name: info.name, individual: false, sent: sentQty, returned: ret, stillOut: sentQty - ret, level: "request", note: null });
    } else {
      const why = heldNow === null
        ? "What the project holds could not be loaded, so only what was sent is shown."
        : (otherSent.get(itemId) ?? 0) > 0 || (lineCount.get(itemId) ?? 0) > 1
          ? "This item was sent for more than one request or line. Counted stock comes back to the project, not to a request line, so only what was sent and what the project holds now are shown."
          : "The project holds a different amount than this request sent (some was sent or returned without this request), so returns are shown for the project, not for the request.";
      out.push({ itemId, name: info.name, individual: false, sent: sentQty, returned: null, stillOut: heldNow, level: "project", note: why });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export type HolderOf = "this" | "other" | "none";

/** Whose request an individual unit that the project holds belongs to. Counted stock is never attributed (see above). */
export function unitHolder(unitId: string, model: RequestModel, projectModels: readonly RequestModel[]): HolderOf {
  const has = (m: RequestModel) => m.lines.some((l) => l.reservations.some((r) => r.unit_id === unitId && n(r.dispatched_qty) > n(r.returned_qty)));
  if (has(model)) return "this";
  if (projectModels.some((m) => m.request.id !== model.request.id && has(m))) return "other";
  return "none";
}

/** Good or fair units, and good counted stock, become available again at once; anything else is held for checking. Same rule as the database's return. */
export function returnOutcome(condition: string, individual: boolean): "available" | "held" | "unset" {
  if (!condition) return "unset";
  if (individual) return condition === "good" || condition === "fair" ? "available" : "held";
  return condition === "good" ? "available" : "held";
}
