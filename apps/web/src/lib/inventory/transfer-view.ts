/**
 * One warehouse transfer as a person reads it, whichever side they are on: who sent it from where, who receives it where, what was sent, what has been
 * received, what is still in transit, and who acts next. Pure (no React, no server-only imports), so it is unit tested. Nothing here is a permission and
 * nothing is stored: every number is counted from the transfer's own ledger lines and from what is still in transit, which the database returned to a
 * person who was allowed to read them.
 *
 * The three facts stay apart: the SENDING company and warehouse, the RECEIVING company and warehouse, and the OWNER of each thing (a transfer never
 * changes the owner).
 */
import type { XEvent, XTrace } from "./xshare";
import { formatQty } from "./words";

export interface TransferPlace {
  locationId: string;
  /** The warehouse: "Dubai". */
  name: string;
  companyId: string;
  /** The company that runs it: "Enginious UAE". */
  companyName: string;
  /** Both, the way a transfer always says a place: "Dubai · Enginious UAE". */
  label: string;
}

export interface TransferUnitLine {
  unitId: string; code: string; serial: string | null; itemName: string; ownerCompanyId: string; ownerName: string; rented: boolean;
  /** `in_transit`: sent and not received yet. `received`: on the shelf at the destination. `moved_on`: received and since moved elsewhere. */
  state: "in_transit" | "received" | "moved_on";
  /** The condition, when the viewer may still see it. */
  condition: string | null;
}

export interface TransferQtyLine { itemId: string; itemName: string; uom: string; ownerCompanyId: string; ownerName: string; sent: number; inTransit: number }

export interface TransferView {
  id: string; code: string; status: "in_transit" | "received" | "cancelled";
  from: TransferPlace; to: TransferPlace;
  /** The two warehouses are run by different companies. */
  crossCompany: boolean;
  dispatchedAt: string; expectedAt: string | null; receivedAt: string | null; carrier: string | null; reference: string | null;
  dispatchedBy: string | null; receivedBy: string | null; sharingRevoked: boolean;
  units: TransferUnitLine[]; quantities: TransferQtyLine[]; events: XEvent[];
}

export const placeLabel = (name: string, companyName: string | null | undefined): string => (companyName ? `${name} · ${companyName}` : name);

/** The view of a transfer from what the database returned for it (`inv_xshare_transfer_trace`, or the same shape read from the person's own company). */
export function viewFromTrace(t: XTrace): TransferView {
  const h = t.transfer;
  return {
    id: h.transferId, code: h.code, status: h.status,
    from: { locationId: h.fromLocationId, name: h.fromName, companyId: h.senderCompanyId, companyName: h.senderName, label: placeLabel(h.fromName, h.senderName) },
    to: { locationId: h.toLocationId, name: h.toName, companyId: h.toCompanyId, companyName: h.toCompanyName, label: placeLabel(h.toName, h.toCompanyName) },
    crossCompany: h.senderCompanyId !== h.toCompanyId,
    dispatchedAt: h.dispatchedAt, expectedAt: h.expectedAt, receivedAt: h.receivedAt, carrier: h.carrier, reference: h.reference,
    dispatchedBy: h.dispatchedBy, receivedBy: h.receivedBy, sharingRevoked: h.sharingRevoked,
    units: t.units.map((u) => ({
      unitId: u.unitId, code: u.code, serial: u.serial, itemName: u.itemName, ownerCompanyId: u.ownerCompanyId, ownerName: u.ownerName, rented: u.rented,
      state: u.onTheWay ? "in_transit" : u.atDestination ? "received" : "moved_on", condition: u.condition,
    })),
    quantities: t.quantities.map((q) => ({ itemId: q.itemId, itemName: q.itemName, uom: q.uom, ownerCompanyId: q.ownerCompanyId, ownerName: q.ownerName, sent: q.sent, inTransit: q.onTheWay })),
    events: t.events,
  };
}

/**
 * How much was sent, how much has been received and how much is still in transit. Individual units count one each and counted stock by its quantity, so
 * "received" is always "sent minus still in transit": nothing is assumed to have arrived.
 */
export interface TransferProgress { sent: number; received: number; inTransit: number }

export function transferProgress(v: Pick<TransferView, "units" | "quantities">): TransferProgress {
  const sent = v.units.length + v.quantities.reduce((n, q) => n + q.sent, 0);
  const inTransit = v.units.filter((u) => u.state === "in_transit").length + v.quantities.reduce((n, q) => n + q.inTransit, 0);
  return { sent, received: Math.max(0, sent - inTransit), inTransit };
}

const n = (x: number) => formatQty(x);

/** "5 sent · 3 received · 2 still in transit" */
export function progressWords(p: TransferProgress): string {
  return `${n(p.sent)} sent · ${n(p.received)} received · ${p.inTransit > 0 ? `${n(p.inTransit)} still in transit` : "nothing in transit"}`;
}

/** Which side acts next, in words. A transfer only ever waits for the receiving warehouse. */
export function nextAction(v: Pick<TransferView, "status" | "to" | "units" | "quantities">): { waitingOn: "receiver" | "nobody"; text: string } {
  if (v.status === "cancelled") return { waitingOn: "nobody", text: "Cancelled. Nothing is waiting." };
  const p = transferProgress(v);
  if (v.status === "received" || p.inTransit === 0) return { waitingOn: "nobody", text: `Complete. Everything was received at ${v.to.label}.` };
  return {
    waitingOn: "receiver",
    text: p.received > 0
      ? `${v.to.label} acts next: ${n(p.inTransit)} still in transit ${p.inTransit === 1 ? "is" : "are"} received there when ${p.inTransit === 1 ? "it arrives" : "they arrive"}.`
      : `${v.to.label} acts next: it records the transfer as received when it arrives.`,
  };
}

/** "Owned by Enginious UAE", only when the owner is not the company that runs the place the line is going to. */
export function ownerNote(line: { ownerCompanyId: string; ownerName: string }, v: Pick<TransferView, "to">): string | null {
  return line.ownerCompanyId === v.to.companyId ? null : `Owned by ${line.ownerName}`;
}

/**
 * What a receipt did, in practical words, from what the database returned for it (never from what the form asked for):
 * "2 received · 1 held for inspection · 1 still in transit."
 */
export function receiptResultWords(result: unknown): string | null {
  const r = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
  if (!r || !Array.isArray(r.lines)) return null;
  let received = 0; let held = 0;
  for (const raw of r.lines) {
    const l = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const qty = typeof l.qty === "number" ? l.qty : l.unit_id ? 1 : Number(l.qty ?? 1) || 1;
    received += qty;
    if (l.available !== true) held += qty;
  }
  const left = typeof r.still_on_the_way === "number" ? r.still_on_the_way : 0;
  const parts = [`${n(received)} received`];
  if (held > 0) parts.push(`${n(held)} held for inspection`);
  parts.push(left > 0 ? `${n(left)} line${left === 1 ? "" : "s"} still in transit` : "nothing left in transit");
  return `${parts.join(" · ")}.`;
}
