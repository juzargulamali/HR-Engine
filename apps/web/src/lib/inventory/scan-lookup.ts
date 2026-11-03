/**
 * Resolves a scanned or typed code into something the person may see. It READS only, through the typed client and row-level security:
 * units by code (inv_units), bin labels by label_code (inv_balances). The one function it calls is the read-only inv_xshare_units (another
 * company's unit that is in transit to, or on the shelf at, a warehouse the person operates), so it can never change stock.
 * Whoever the database will not show the row to gets the same answer as for a code that does not exist, so the page can never be used
 * to find out whether a code is real.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseInventoryScan } from "@enginious-hr/domain";
import type { Database } from "@/types/database.types";
import { isNotInstalled } from "@/lib/projects/errors";
import { CUSTODY_WORDS, LIFECYCLE_WORDS } from "./words";
import { mapUnit, ownedByText, xUnitStatus } from "./xshare";

export type ScanResolution =
  | {
      status: "found";
      kind: "unit" | "stock";
      code: string;
      id: string;
      itemId: string;
      itemName: string;
      /** Where the record opens: a unit opens its own record, a bin label opens the item. */
      openHref: string;
      /** Short facts for people, never an employee or project name. */
      facts: string[];
    }
  | { status: "unavailable" }
  | { status: "not_inventory"; problem: "empty" | "too_long" | "not_inventory" }
  | { status: "error" };

type Db = SupabaseClient<Database>;

async function itemLabel(db: Db, itemId: string): Promise<string> {
  const { data } = await db.from("inv_items").select("name, model, specification").eq("id", itemId).maybeSingle();
  if (!data) return "Equipment";
  return [data.name, data.model, data.specification].filter((x): x is string => !!x && x.trim() !== "").join(" · ");
}

async function placeName(db: Db, table: "inv_locations" | "inv_bins", id: string | null, column: "name" | "code"): Promise<string | null> {
  if (!id) return null;
  const { data } = table === "inv_locations"
    ? await db.from("inv_locations").select("name").eq("id", id).maybeSingle()
    : await db.from("inv_bins").select("code").eq("id", id).maybeSingle();
  return (data as Record<string, string> | null)?.[column] ?? null;
}

/** A unit of another company that this person may handle (the narrow database function answers; anything else is "unavailable", the same as an unknown code). */
async function crossCompanyUnit(db: Db, code: string): Promise<ScanResolution> {
  const { data, error } = await (db.rpc as unknown as (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>)("inv_xshare_units", { p_location_id: null, p_code: code });
  if (error) return isNotInstalled(error) ? { status: "unavailable" } : { status: "error" };
  const first = ((data ?? []) as Record<string, unknown>[])[0];
  if (!first) return { status: "unavailable" };
  const u = mapUnit(first);
  return {
    status: "found", kind: "unit", code: u.code, id: u.unitId, itemId: u.itemId, itemName: u.itemName,
    openHref: `/inventory/stock?unit=${encodeURIComponent(u.code)}`, facts: [xUnitStatus(u), ownedByText(u.ownerName)],
  };
}

export async function resolveScan(db: Db, raw: string): Promise<ScanResolution> {
  const parsed = parseInventoryScan(raw);
  if (!parsed.ok) return { status: "not_inventory", problem: parsed.problem };

  if (parsed.kind === "unit") {
    const { data, error } = await db.from("inv_units").select("id, code, item_id, lifecycle, custody_kind, location_id, bin_id").eq("code", parsed.code).maybeSingle();
    if (error) return { status: "error" };
    if (!data) return crossCompanyUnit(db, parsed.code);
    const [itemName, loc] = await Promise.all([itemLabel(db, data.item_id), placeName(db, "inv_locations", data.location_id, "name")]);
    const facts = [LIFECYCLE_WORDS[data.lifecycle] ?? data.lifecycle, CUSTODY_WORDS[data.custody_kind] ?? data.custody_kind];
    if (loc && data.custody_kind === "warehouse") facts.push(loc);
    return { status: "found", kind: "unit", code: data.code, id: data.id, itemId: data.item_id, itemName, openHref: `/inventory/stock?unit=${data.id}`, facts };
  }

  const { data, error } = await db.from("inv_balances").select("id, label_code, item_id, location_id, bin_id").eq("label_code", parsed.code).maybeSingle();
  if (error) return { status: "error" };
  if (!data) return { status: "unavailable" };
  const [itemName, loc, bin] = await Promise.all([itemLabel(db, data.item_id), placeName(db, "inv_locations", data.location_id, "name"), placeName(db, "inv_bins", data.bin_id, "code")]);
  const facts = ["Item in a bin"];
  if (bin) facts.push(`Bin ${bin}`);
  if (loc) facts.push(loc);
  return { status: "found", kind: "stock", code: parsed.code, id: data.id, itemId: data.item_id, itemName, openHref: `/inventory/stock?open=${data.item_id}`, facts };
}
