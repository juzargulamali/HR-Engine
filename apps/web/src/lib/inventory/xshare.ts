/**
 * Cross-company receiving, the pure part (no React, no server-only imports, so it is unit tested). The database functions inv_xshare_* return the
 * MINIMUM a receiving company's warehouse operator needs to receive and handle another company's equipment, and let both sides trace the same
 * transfer. Nothing here is a permission: these shape what those functions returned into the rows the screens and forms already use. Costs,
 * suppliers, notes, employees and projects are never part of them.
 */
import { candidateBase, type Candidate, type FormLocation, type FormTransfer } from "./stock-candidates";
import { CONDITION_WORDS, CUSTODY_WORDS } from "./words";
import type { InvCondition } from "@/types/inventory";

export type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
const n = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** A warehouse of another company the owner has authorised, as the Send form lists it. */
export interface XDestination { id: string; code: string; name: string; timezone: string; companyId: string; companyName: string; ownerCompanyId: string; ownerCompanyName: string }

export interface XUnit {
  unitId: string; code: string; serial: string | null; itemId: string; itemName: string; category: string | null; condition: string; custody: "warehouse" | "transit";
  rented: boolean; ownerCompanyId: string; ownerName: string; locationId: string; locationName: string; locationCompanyId: string;
  binId: string | null; binCode: string | null; transferId: string | null; transferCode: string | null; usableHere: boolean;
}

export interface XTransferHead {
  transferId: string; code: string; status: "in_transit" | "received" | "cancelled"; senderCompanyId: string; senderName: string;
  fromLocationId: string; fromName: string; toLocationId: string; toName: string; toCompanyId: string; toCompanyName: string;
  dispatchedAt: string; expectedAt: string | null; receivedAt: string | null; carrier: string | null; reference: string | null;
  dispatchedBy: string | null; receivedBy: string | null; lineCount: number; stillOnTheWay: number;
}

export interface XTraceUnit {
  unitId: string; code: string; serial: string | null; itemId: string; itemName: string; category: string | null; rented: boolean; ownerCompanyId: string; ownerName: string;
  onTheWay: boolean; atDestination: boolean; condition: string | null; custody: string | null;
}
export interface XTraceQty { itemId: string; itemName: string; category: string | null; uom: string; ownerCompanyId: string; ownerName: string; sent: number; onTheWay: number; byCondition: { condition: string; qty: number; rented: boolean }[] }
export interface XEvent {
  movementCode: string; kind: "transfer_dispatch" | "transfer_receive"; at: string; by: string | null; filedUnderCompanyId: string; filedUnderName: string;
  lines: { code: string | null; itemName: string; qty: number; conditionFrom: string | null; conditionTo: string | null }[];
}
export interface XTrace { transfer: XTransferHead; units: XTraceUnit[]; quantities: XTraceQty[]; events: XEvent[] }

export const mapDestination = (r: Raw): XDestination => ({
  id: String(r.location_id), code: String(r.location_code), name: String(r.location_name), timezone: String(r.timezone), companyId: String(r.company_id),
  companyName: s(r.company_name) ?? "another company", ownerCompanyId: String(r.owner_company_id), ownerCompanyName: s(r.owner_company_name) ?? "another company",
});

export const mapUnit = (r: Raw): XUnit => ({
  unitId: String(r.unit_id), code: String(r.code), serial: s(r.serial_number), itemId: String(r.item_id), itemName: String(r.item_name), category: s(r.category_name),
  condition: String(r.condition), custody: r.custody_kind === "transit" ? "transit" : "warehouse", rented: r.ownership === "rental", ownerCompanyId: String(r.owner_company_id),
  ownerName: s(r.owner_company_name) ?? "another company", locationId: String(r.location_id), locationName: String(r.location_name), locationCompanyId: String(r.location_company_id),
  binId: s(r.bin_id), binCode: s(r.bin_code), transferId: s(r.transfer_id), transferCode: s(r.transfer_code), usableHere: r.usable_here === true,
});

export const mapHead = (r: Raw): XTransferHead => ({
  transferId: String(r.transfer_id), code: String(r.code), status: r.status as XTransferHead["status"], senderCompanyId: String(r.sender_company_id), senderName: s(r.sender_company_name) ?? "another company",
  fromLocationId: String(r.from_location_id), fromName: String(r.from_location_name), toLocationId: String(r.to_location_id), toName: String(r.to_location_name),
  toCompanyId: String(r.to_company_id), toCompanyName: s(r.to_company_name) ?? "another company", dispatchedAt: String(r.dispatched_at), expectedAt: s(r.expected_at), receivedAt: s(r.received_at),
  carrier: s(r.carrier), reference: s(r.reference), dispatchedBy: s(r.dispatched_by_name), receivedBy: s(r.received_by_name), lineCount: n(r.line_count), stillOnTheWay: n(r.still_on_the_way),
});

export function mapTrace(raw: Raw): XTrace {
  const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
  return {
    transfer: mapHead(raw.transfer as Raw),
    units: list(raw.units).map((u) => ({
      unitId: String(u.unit_id), code: String(u.code), serial: s(u.serial_number), itemId: String(u.item_id), itemName: String(u.item_name), category: s(u.category), rented: u.ownership === "rental",
      ownerCompanyId: String(u.owner_company_id), ownerName: s(u.owner_company_name) ?? "another company", onTheWay: u.on_the_way === true, atDestination: u.at_destination === true,
      condition: s(u.condition), custody: s(u.custody_kind),
    })),
    quantities: list(raw.quantities).map((q) => ({
      itemId: String(q.item_id), itemName: String(q.item_name), category: s(q.category), uom: s(q.unit_of_measure) ?? "each", ownerCompanyId: String(q.owner_company_id), ownerName: s(q.owner_company_name) ?? "another company",
      sent: n(q.qty_sent), onTheWay: n(q.qty_on_the_way), byCondition: list(q.on_the_way).map((b) => ({ condition: String(b.condition), qty: n(b.qty), rented: b.rented === true })),
    })),
    events: list(raw.events).map((e) => ({
      movementCode: String(e.movement_code), kind: e.kind === "transfer_receive" ? "transfer_receive" : "transfer_dispatch", at: String(e.occurred_at), by: s(e.by_name),
      filedUnderCompanyId: String(e.filed_under_company_id), filedUnderName: s(e.filed_under_company_name) ?? "another company",
      lines: list(e.lines).map((l) => ({ code: s(l.code), itemName: String(l.item_name), qty: n(l.qty), conditionFrom: s(l.condition_from), conditionTo: s(l.condition_to) })),
    })),
  };
}

/** "Owned by Enginious UAE": always said for another company's equipment (it is, by definition, not the warehouse's own). */
export const ownedByText = (ownerName: string) => `Owned by ${ownerName}`;

/** What the receiving form lists for a unit that is on its way to the person's warehouse. */
export function unitCandidate(u: XTraceUnit | XUnit, extra: { transit: boolean; locationId: string | null }): Candidate {
  const id = "unitId" in u ? u.unitId : "";
  const ownerName = u.ownerName;
  const transit = extra.transit;
  return candidateBase({
    key: `unit-${id}`, type: "unit", unitId: id, code: u.code, serial: u.serial, itemId: u.itemId, itemName: u.itemName, detail: u.category,
    condition: (u.condition ?? "good"), lifecycle: "active", custody: transit ? "transit" : "warehouse", locationId: extra.locationId,
    where: `${transit ? CUSTODY_WORDS.transit : CUSTODY_WORDS.warehouse} · ${ownedByText(ownerName)}`, ownedBy: ownedByText(ownerName),
  });
}

/** Counted stock still on the way: one line per condition, so the form's line carries the exact condition the database holds it in. */
export function quantityCandidates(q: XTraceQty): Candidate[] {
  return q.byCondition.map((b, i) => candidateBase({
    key: `xqty-${q.itemId}-${b.condition}-${b.rented ? "r" : "o"}-${i}`, type: "counted", itemId: q.itemId, itemName: q.itemName, detail: q.category, tracking: "quantity", uom: q.uom,
    condition: b.condition, custody: "transit", qty: b.qty, lifecycle: "active", where: `${CUSTODY_WORDS.transit}${b.rented ? " (rented)" : ""} · ${ownedByText(q.ownerName)}`, ownedBy: ownedByText(q.ownerName),
  }));
}

/** An open cross-company transfer addressed to a warehouse the person operates, as the Receive transfer form lists it. */
export function formTransferFrom(trace: XTrace, names: { from: string; to: string }): FormTransfer {
  const t = trace.transfer;
  const held: Candidate[] = [
    ...trace.units.filter((u) => u.onTheWay).map((u) => unitCandidate(u, { transit: true, locationId: null })),
    ...trace.quantities.flatMap((q) => quantityCandidates(q)),
  ];
  return { id: t.transferId, code: t.code, companyId: t.senderCompanyId, fromLocationId: t.fromLocationId, fromName: names.from, toLocationId: t.toLocationId, toName: names.to, expectedAt: t.expectedAt, carrier: t.carrier, reference: t.reference, dispatchedAt: t.dispatchedAt, held };
}

/** A destination in the Send form. `sharedFrom` is the owning company that authorised it: it is offered only when sending from that company's warehouse. */
export const formDestination = (d: XDestination): FormLocation & { sharedFrom: string } => ({
  id: d.id, companyId: d.companyId, companyName: d.companyName, name: d.name, timezone: d.timezone, bins: [], sharedFrom: d.ownerCompanyId,
});

/** Sentence for a unit's state on the receiving side. */
export function xUnitStatus(u: XUnit): string {
  if (u.custody === "transit") return `On the way to ${u.locationName}${u.transferCode ? ` (${u.transferCode})` : ""}`;
  const cond = (CONDITION_WORDS as Record<string, string>)[u.condition] ?? u.condition;
  return u.usableHere ? `Available at ${u.locationName}` : `At ${u.locationName}, held back (${cond.toLowerCase()})`;
}

export const conditionWord = (c: string | null): string => (c ? ((CONDITION_WORDS as Record<string, string>)[c as InvCondition] ?? c) : "—");

/** The three steps of a cross-company transfer for the trace page, with what is known of each. */
export interface TraceStep { key: "dispatched" | "in_transit" | "received"; label: string; state: "done" | "current" | "waiting"; detail: string }
export function traceSteps(t: XTrace, fmt: (iso: string) => string): TraceStep[] {
  const head = t.transfer;
  const dispatch = t.events.find((e) => e.kind === "transfer_dispatch");
  const receipts = t.events.filter((e) => e.kind === "transfer_receive");
  const received = head.status === "received";
  return [
    { key: "dispatched", label: "Dispatched", state: "done", detail: `${fmt(dispatch?.at ?? head.dispatchedAt)} from ${head.fromName} (${head.senderName})${dispatch?.by ?? head.dispatchedBy ? `, by ${dispatch?.by ?? head.dispatchedBy}` : ""}` },
    { key: "in_transit", label: "In transit", state: received ? "done" : "current", detail: received ? "Arrived" : `${head.stillOnTheWay} line${head.stillOnTheWay === 1 ? "" : "s"} on the way to ${head.toName}${head.expectedAt ? `, expected ${fmt(head.expectedAt)}` : ""}${head.carrier ? ` · ${head.carrier}` : ""}${head.reference ? ` · ref ${head.reference}` : ""}` },
    { key: "received", label: "Received", state: received ? "done" : receipts.length > 0 ? "current" : "waiting",
      detail: receipts.length > 0 ? receipts.map((r) => `${fmt(r.at)} at ${head.toName} (${r.filedUnderName})${r.by ? `, by ${r.by}` : ""}`).join("; ") : `Not received yet at ${head.toName}` },
  ];
}
