/**
 * Where a unit PHYSICALLY is, who OPERATES that place, and who OWNS the unit are three different facts:
 *   * the permanent code, serial number and owning company belong to the unit and never change when it moves (the database never
 *     changes `inv_units.company_id` on a transfer);
 *   * the physical place is `location_id`, and the company that runs that place is the location's `company_id`;
 *   * custody (a project or a person) is separate again.
 * Pure helpers, no React and no server-only imports, so they are unit tested. Nothing here is a permission: they only turn rows the
 * person was already allowed to read into words. A place the person cannot read is said to be "a warehouse of another company"
 * (never guessed, never shown as "on the shelf" with the place missing).
 */

export interface PlaceCtx {
  /** Locations the person can read (names only). */
  locations: readonly { id: string; name: string; company_id: string }[];
  companyName: (companyId: string) => string;
  /** How many companies the person works with: with more than one, a place is named together with its company ("Dubai · Enginious UAE"). */
  companyCount: number;
}

export interface Place {
  /** The place as a person reads it: "Riyadh warehouse", "Riyadh warehouse · Enginious KSA" or "a warehouse of another company"; null without a location. */
  label: string | null;
  /** The company that runs the place; null when there is no place or the person cannot read it. */
  operatingCompanyId: string | null;
  /** A place exists but the person cannot read it (it is another company's). */
  unreadable: boolean;
}

export const FOREIGN_PLACE = "a warehouse of another company";

export function placeOf(ctx: PlaceCtx, locationId: string | null | undefined, ownerCompanyId: string): Place {
  if (!locationId) return { label: null, operatingCompanyId: null, unreadable: false };
  const loc = ctx.locations.find((l) => l.id === locationId);
  if (!loc) return { label: FOREIGN_PLACE, operatingCompanyId: null, unreadable: true };
  const named = ctx.companyCount > 1 || loc.company_id !== ownerCompanyId;
  return { label: named ? `${loc.name} · ${ctx.companyName(loc.company_id)}` : loc.name, operatingCompanyId: loc.company_id, unreadable: false };
}

/**
 * "Owned by Enginious UAE", only when the company that owns the unit is not the company that runs the place it is in. Nothing (null) when
 * they are the same, so a unit at home is never cluttered. An unreadable place is by definition another company's.
 */
export function ownedByNote(ctx: Pick<PlaceCtx, "companyName">, ownerCompanyId: string, place: Pick<Place, "operatingCompanyId" | "unreadable"> | null): string | null {
  if (!place) return null;
  if (!place.unreadable && (place.operatingCompanyId === null || place.operatingCompanyId === ownerCompanyId)) return null;
  const name = ctx.companyName(ownerCompanyId);
  return `Owned by ${name === "Unknown" ? "another company" : name}`;
}

/** The note for a counted-stock or catalogue row seen under a chosen warehouse: only when the warehouse is run by a different company than the one that owns the item. */
export function itemOwnedByNote(ctx: Pick<PlaceCtx, "companyName">, ownerCompanyId: string, warehouseCompanyId: string | null | undefined): string | null {
  if (!warehouseCompanyId || warehouseCompanyId === ownerCompanyId) return null;
  return ownedByNote(ctx, ownerCompanyId, { operatingCompanyId: warehouseCompanyId, unreadable: false });
}

/** "Dubai warehouse to Riyadh warehouse · Enginious KSA" style route for a transfer in transit. */
export function transitRoute(from: string | null, to: string | null): string {
  return `${from ?? FOREIGN_PLACE} to ${to ?? FOREIGN_PLACE}`;
}
