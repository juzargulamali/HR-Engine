import type { InvBalanceCondition, InvCondition, InvCustody, InvLifecycle, InvMovementKind, InvTracking } from "@/types/inventory";

/** The plain words Inventory uses everywhere (tables, panels, forms, labels). One place, so the same thing is always called the same thing. */

export const TRACKING_WORDS: Record<InvTracking, { label: string; help: string }> = {
  individual: { label: "Individual item", help: "Each one has its own ID and QR label (laptops, headsets, controllers, motors)." },
  quantity: { label: "Counted stock", help: "Identical items counted per shelf or bin (connectors, cards, small parts)." },
  kit: { label: "Kit", help: "A box or set with its own ID and a checklist of what should be inside." },
  consumable: { label: "Consumable", help: "Used up when issued (tape, cable ties, screws)." },
};

export const CONDITION_WORDS: Record<InvCondition, string> = {
  good: "Good",
  fair: "Fair",
  needs_inspection: "Needs checking",
  damaged: "Damaged",
  unserviceable: "Cannot be used",
};
export const BALANCE_CONDITION_WORDS: Record<InvBalanceCondition, string> = { good: "Good", needs_inspection: "Needs checking", damaged: "Damaged" };

export const LIFECYCLE_WORDS: Record<InvLifecycle, string> = {
  draft: "Not counted yet",
  active: "In use",
  retired: "Retired",
  missing: "Missing",
};

export const CUSTODY_WORDS: Record<InvCustody, string> = {
  warehouse: "In the warehouse",
  employee: "With an employee",
  project: "On a project",
  transit: "In transit",
  repair: "Out for repair",
  kit: "Inside a kit",
};

export const MOVEMENT_WORDS: Record<InvMovementKind, string> = {
  opening: "Opening stock",
  receipt: "Stock received",
  rental_receipt: "Rental received",
  rental_return: "Rental returned to supplier",
  issue_employee: "Issued to employee",
  return_employee: "Returned by employee",
  reassign_employee: "Reassigned to employee",
  dispatch_project: "Dispatched to project",
  return_project: "Returned from project",
  transfer_project: "Moved between projects",
  transfer_dispatch: "Sent to another location",
  transfer_receive: "Received from another location",
  consume: "Used up",
  return_unused: "Unused stock returned",
  repair_out: "Sent for repair",
  repair_in: "Back from repair",
  pack_kit: "Packed into kit",
  unpack_kit: "Taken out of kit",
  pool_change: "Moved to the project pool",
  condition_check: "Condition checked",
  adjust_missing: "Marked missing",
  adjust_found: "Found",
  adjust_retire: "Retired",
  count_adjust: "Count correction",
  correction: "Correction",
};

export const REQUEST_STATUS_WORDS: Record<string, string> = {
  draft: "Draft",
  submitted: "Waiting for the warehouse",
  in_progress: "Being prepared",
  fulfilled: "All dispatched",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const SHORTAGE_WORDS: Record<string, string> = { none: "—", need_to_buy: "Need to buy", need_to_rent: "Need to rent" };

export const AVAILABILITY_RESULT_WORDS: Record<string, string> = {
  pending: "Warehouse check asked for",
  available: "Available",
  partial: "Partly available",
  short: "Not enough in stock",
  check_required: "Warehouse check required",
};

/** A quantity as people read it: no trailing zeros, with the unit ("12 each", "36.5 m"). */
export function formatQty(qty: number | string | null | undefined, unit?: string | null): string {
  if (qty === null || qty === undefined || qty === "") return "—";
  const n = typeof qty === "number" ? qty : Number(qty);
  if (!Number.isFinite(n)) return String(qty);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return unit && unit !== "each" ? `${text} ${unit}` : text;
}
