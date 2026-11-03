import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";
import {
  formTransferFrom, mapCounted, mapDestination, mapHead, mapTrace, mapUnit, type XCounted, type XDestination, type XTrace, type XTransferHead, type XUnit,
} from "./xshare";
import type { FormTransfer } from "./stock-candidates";

/**
 * Server-side reading of the cross-company receiving functions (inv_xshare_*), through the signed-in person's own session. The database decides
 * who may see what; these only read. A database without the migration has no such functions: that is "not installed" (an empty answer, since
 * nothing of another company can have been sent through it), while any other failed read throws so the page says it could not load.
 */
type Db = Awaited<ReturnType<typeof createClient>>;

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
  return rows(db ?? (await createClient()), "inv_xshare_destinations", {}, mapDestination);
}

/** Other companies' units in transit to, or on the shelf at, a warehouse the caller operates (the minimum fields), optionally for one warehouse or one exact code. */
export async function loadXUnits(opts: { locationId?: string | null; code?: string | null } = {}, db?: Db): Promise<XUnit[]> {
  return rows(db ?? (await createClient()), "inv_xshare_units", { p_location_id: opts.locationId || null, p_code: opts.code || null }, mapUnit);
}

/** Other companies' counted stock in transit to, or on the shelf at, a warehouse the caller operates (item, owner, quantity, place; no costs). */
export async function loadXCounted(opts: { locationId?: string | null } = {}, db?: Db): Promise<XCounted[]> {
  return rows(db ?? (await createClient()), "inv_xshare_counted_stock", { p_location_id: opts.locationId || null }, mapCounted);
}

/** Cross-company transfers the caller is a party to, newest first. */
export async function loadXTransfers(db?: Db): Promise<XTransferHead[]> {
  return rows(db ?? (await createClient()), "inv_xshare_transfers", {}, mapHead);
}

/** One transfer as the caller may see it, or null (not found / not theirs: one answer for both). */
export async function loadXTrace(transferId: string, db?: Db): Promise<XTrace | null> {
  const client = db ?? (await createClient());
  const { data, error } = await (client.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>)("inv_xshare_transfer_trace", { p_transfer_id: transferId });
  if (error) {
    if (error.code === "P0002" || isNotInstalled(error)) return null;
    throw new Error(`inv_xshare_transfer_trace: ${error.message}`);
  }
  return data ? mapTrace(data as Record<string, unknown>) : null;
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
