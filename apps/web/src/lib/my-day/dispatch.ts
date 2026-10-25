/**
 * The equipment part of My Day, from the same request list the Inventory screens use. Wording keeps three things apart that the product
 * keeps apart: a reservation (stock held for the dates), a dispatch (equipment actually sent out) and an availability check (an answer, not
 * a commitment). "Lines dispatched" here is the number of request lines whose equipment has gone out in full (RequestSummary.done).
 */
export interface DispatchRequest {
  id: string;
  code: string;
  title: string | null;
  forLabel: string;
  status: string;
  needed_from: string | null;
  timezone: string | null;
  /** Lines fully dispatched / lines not cancelled / lines with a shortage. */
  done: number;
  total: number;
  shortageLines: number;
}

const LIVE = ["submitted", "in_progress"];

/** Requests being worked on: submitted or in progress (drafts, finished and cancelled ones are not "live"). */
export const liveRequests = <T extends Pick<DispatchRequest, "status">>(rows: readonly T[]): T[] => rows.filter((r) => LIVE.includes(r.status));

export interface EquipmentSummary { live: number; withShortage: number }
export const equipmentSummary = (rows: readonly Pick<DispatchRequest, "status" | "shortageLines">[]): EquipmentSummary => {
  const live = liveRequests(rows);
  return { live: live.length, withShortage: live.filter((r) => r.shortageLines > 0).length };
};

/**
 * The live request whose equipment is needed first and is not yet fully dispatched. One whose time has passed with lines still to send comes
 * first (it is the most urgent), then the soonest to come; requests with no date go last.
 */
export function nextDispatch<T extends DispatchRequest>(rows: readonly T[]): T | null {
  const open = liveRequests(rows).filter((r) => r.total > 0 && r.done < r.total);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => (a.needed_from ?? "9999") .localeCompare(b.needed_from ?? "9999") || a.code.localeCompare(b.code))[0] ?? null;
}
