import { canOperateLocation } from "@enginious-hr/domain";
import type { InvGrant } from "@enginious-hr/domain";

/**
 * Which warehouse a person is working in. Pure, so it is unit tested; nothing here is a permission: the database still checks
 * `inv_can_operate` on every movement. It only decides what the screens show first and what the switcher offers.
 *
 * A warehouse operator is offered the locations they may operate (their assigned ones, or all with "All locations", founders all).
 * Someone who cannot operate anywhere (a stock reader, an HR custody reader) is offered every active location of their companies.
 */
export interface WarehouseOption { id: string; name: string; companyId: string; companyName: string }

export interface WarehouseInput {
  grants: readonly InvGrant[];
  locations: readonly { id: string; name: string; company_id: string; is_active: boolean }[];
  assignedLocationIds: readonly string[];
  companyName: (id: string) => string;
}

export const WAREHOUSE_COOKIE = "inv_warehouse";
/** The URL value that means "every warehouse" (company-wide counts). Only the Stock and History screens offer it. */
export const ALL_WAREHOUSES = "all";

export function warehouseOptions(input: WarehouseInput): { options: WarehouseOption[]; operable: ReadonlySet<string> } {
  const active = input.locations.filter((l) => l.is_active);
  const operableIds = new Set(active.filter((l) => canOperateLocation(input.grants, l.company_id, l.id, input.assignedLocationIds)).map((l) => l.id));
  const chosen = operableIds.size > 0 ? active.filter((l) => operableIds.has(l.id)) : active;
  return {
    options: chosen.map((l) => ({ id: l.id, name: l.name, companyId: l.company_id, companyName: input.companyName(l.company_id) })),
    operable: operableIds,
  };
}

export interface WorkingLocation {
  /** The chosen location, or null when none applies (nothing to choose from) or when every warehouse was asked for. */
  id: string | null;
  /** True when the person asked for every warehouse (company-wide). */
  all: boolean;
}

/**
 * The URL wins (a link or the switcher), then the remembered choice (a cookie, set by the switcher), then the first location the person
 * is assigned to, then the first one on offer. A value that is not on offer is ignored, never trusted.
 */
export function pickWorkingLocation(opts: {
  options: readonly WarehouseOption[];
  everyLocationId: readonly string[];
  fromUrl: string;
  remembered: string;
  assigned: readonly string[];
  allowAll: boolean;
  /** When nothing else decides: show every warehouse together (for people who cannot operate anywhere, such as stock readers and project managers). */
  defaultAll?: boolean;
}): WorkingLocation {
  const offered = new Set(opts.options.map((o) => o.id));
  const known = new Set(opts.everyLocationId);
  if (opts.allowAll && opts.fromUrl === ALL_WAREHOUSES) return { id: null, all: true };
  // A link may name a location the person can read but not operate (a stock reader): it is shown, never assumed operable.
  if (known.has(opts.fromUrl)) return { id: opts.fromUrl, all: false };
  if (opts.allowAll && opts.remembered === ALL_WAREHOUSES) return { id: null, all: true };
  if (offered.has(opts.remembered)) return { id: opts.remembered, all: false };
  const assigned = opts.assigned.find((a) => offered.has(a));
  if (assigned) return { id: assigned, all: false };
  if (opts.allowAll && opts.defaultAll) return { id: null, all: true };
  return { id: opts.options[0]?.id ?? null, all: false };
}
