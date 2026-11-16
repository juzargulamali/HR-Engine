import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";
import {
  formTransferFrom, mapCounted, mapDestination, mapHead, mapTrace, mapUnit, type XCounted, type XDestination, type XTrace, type XTransferHead, type XUnit,
} from "./xshare";
import type { FormTransfer } from "./stock-candidates";
import { getInventoryContext } from "./context";

/**
 * Server-side reading of the cross-company receiving functions (inv_xshare_*), through the signed-in person's own session. The database decides
 * who may see what; these only read. A database without the migration has no such functions: that is "not installed" (an empty answer, since
 * nothing of another company can have been sent through it), while any other failed read throws so the page says it could not load.
 */
type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * The database functions name companies by their LEGAL name. On the screens a company is said by its short Inventory name (Enginious UAE, Enginious Saudi
 * Arabia, Enginious Europe), so the two sides of a transfer read the same everywhere. The name from the database is kept when the short one is not known.
 */
async function shortNames(): Promise<(id: string, fallback: string) => string> {
  const ctx = await getInventoryContext().catch(() => null);
  return (id, fallback) => { const n = ctx?.companyName(id); return n && n !== "Unknown" ? n : fallback; };
}
const headNames = (h: XTransferHead, name: (id: string, fallback: string) => string): XTransferHead => ({ ...h, senderName: name(h.senderCompanyId, h.senderName), toCompanyName: name(h.toCompanyId, h.toCompanyName) });

async function rows<T>(db: Db, fn: string, args: Record<string, unknown>, map: (r: Record<string, unknown>) => T): Promise<T[]> {
  const { data, error } = await (db.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>)(fn, args);
  if (error) {
    if (isNotInstalled(error)) return [];
    throw new Error(`${fn}: ${error.message}`);
  }
  return ((data ?? []) as Record<string, unknown>[]).map(map);
}

/** Warehouses of other companies the caller's own company has authorised as destinations (identifiers and names only). */
export async function loadXDestinations(db?: Db): Promise<XDestination[]> {
  const name = await shortNames();
  return (await rows(db ?? (await createClient()), "inv_xshare_destinations", {}, mapDestination)).map((d) => ({ ...d, companyName: name(d.companyId, d.companyName), ownerCompanyName: name(d.ownerCompanyId, d.ownerCompanyName) }));
}

/** Other companies' units in transit to, or on the shelf at, a warehouse the caller operates (the minimum fields), optionally for one warehouse or one exact code. */
export async function loadXUnits(opts: { locationId?: string | null; code?: string | null } = {}, db?: Db): Promise<XUnit[]> {
  const name = await shortNames();
  return (await rows(db ?? (await createClient()), "inv_xshare_units", { p_location_id: opts.locationId || null, p_code: opts.code || null }, mapUnit)).map((u) => ({ ...u, ownerName: name(u.ownerCompanyId, u.ownerName) }));
}

/** Other companies' counted stock in transit to, or on the shelf at, a warehouse the caller operates (item, owner, quantity, place; no costs). */
export async function loadXCounted(opts: { locationId?: string | null } = {}, db?: Db): Promise<XCounted[]> {
  const name = await shortNames();
  return (await rows(db ?? (await createClient()), "inv_xshare_counted_stock", { p_location_id: opts.locationId || null }, mapCounted)).map((c) => ({ ...c, ownerName: name(c.ownerCompanyId, c.ownerName) }));
}

/** Cross-company transfers the caller is a party to, newest first. */
export async function loadXTransfers(db?: Db): Promise<XTransferHead[]> {
  const name = await shortNames();
  return (await rows(db ?? (await createClient()), "inv_xshare_transfers", {}, mapHead)).map((h) => headNames(h, name));
}

/** One transfer as the caller may see it, or null (not found / not theirs: one answer for both). */
export async function loadXTrace(transferId: string, db?: Db): Promise<XTrace | null> {
  const client = db ?? (await createClient());
  const { data, error } = await (client.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>)("inv_xshare_transfer_trace", { p_transfer_id: transferId });
  if (error) {
    if (error.code === "P0002" || isNotInstalled(error)) return null;
    throw new Error(`inv_xshare_transfer_trace: ${error.message}`);
  }
  if (!data) return null;
  const name = await shortNames();
  const t = mapTrace(data as Record<string, unknown>);
  return {
    transfer: headNames(t.transfer, name),
    units: t.units.map((u) => ({ ...u, ownerName: name(u.ownerCompanyId, u.ownerName) })),
    quantities: t.quantities.map((q) => ({ ...q, ownerName: name(q.ownerCompanyId, q.ownerName) })),
    events: t.events.map((e) => ({ ...e, filedUnderName: name(e.filedUnderCompanyId, e.filedUnderName) })),
  };
}

/**
 * Warehouses of OTHER companies the person meets on a transfer they are a party to, or may send to, by id: "Riyadh · Enginious Saudi Arabia". The person
 * cannot read those warehouses' rows; the narrow functions name them. Used so History and the panels say the real other end of a transfer. A failed read
 * gives no names (the screens then say "a warehouse of another company", which is true), never a wrong one.
 */
export async function loadForeignPlaceNames(db?: Db): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const client = db ?? (await createClient());
    const [heads, dests] = await Promise.all([loadXTransfers(client), loadXDestinations(client)]);
    for (const d of dests) out.set(d.id, `${d.name} · ${d.companyName}`);
    for (const h of heads) { out.set(h.fromLocationId, `${h.fromName} · ${h.senderName}`); out.set(h.toLocationId, `${h.toName} · ${h.toCompanyName}`); }
  } catch (e) {
    console.error("[inventory] names of other companies' warehouses could not be read", e instanceof Error ? e.message : e);
  }
  return out;
}

/** Open cross-company transfers addressed to the given warehouses, ready for the Receive transfer form. */
export async function loadXIncoming(operableLocationIds: readonly string[], db?: Db): Promise<FormTransfer[]> {
  if (operableLocationIds.length === 0) return [];
  const client = db ?? (await createClient());
  const heads = (await loadXTransfers(client)).filter((t) => t.status === "in_transit" && operableLocationIds.includes(t.toLocationId));
  const traces = await Promise.all(heads.map((h) => loadXTrace(h.transferId, client)));
  return traces.flatMap((t) => (t ? [formTransferFrom(t, { from: `${t.transfer.fromName} · ${t.transfer.senderName}`, to: `${t.transfer.toName} · ${t.transfer.toCompanyName}` })] : []));
}

/**
 * Cross-company transfers that carried one unit, for the unit panel of its OWNER (whose own history lacks the receipt, which is filed under the
 * receiving company). Only transfers on the routes the unit's own dispatches took are traced, so this is a handful of calls at most.
 */
export async function loadXTransfersOfUnit(unitId: string, routes: readonly { from: string | null; to: string | null }[], db?: Db): Promise<XTrace[]> {
  if (routes.length === 0) return [];
  const client = db ?? (await createClient());
  const heads = (await loadXTransfers(client)).filter((h) => routes.some((r) => r.from === h.fromLocationId && r.to === h.toLocationId));
  const traces = await Promise.all(heads.slice(0, 20).map((h) => loadXTrace(h.transferId, client)));
  return traces.filter((t): t is XTrace => !!t && t.units.some((u) => u.unitId === unitId));
}
