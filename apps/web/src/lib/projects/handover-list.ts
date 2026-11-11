/**
 * Which handovers the Handovers page shows where. Pure. The page asks the database for the OPEN ones (submitted, PM assigned, clarification asked) separately from the finished
 * ones (accepted, withdrawn), so however long the history grows an old open handover is still read; the history alone is paged.
 */
export const OPEN_HANDOVER_STATUSES = ["submitted", "pm_assigned", "clarification_requested"] as const;
export const CLOSED_HANDOVER_STATUSES = ["accepted", "withdrawn"] as const;
export const HANDOVER_HISTORY_PAGE = 20;
export const HANDOVER_PARAM = "handover";

export interface HandoverLite { id: string; status: string; pm_user_id: string | null; company_id: string; submitted_at: string | null; updated_at: string }

const oldestFirst = <T extends HandoverLite>(a: T, b: T) => (a.submitted_at ?? a.updated_at).localeCompare(b.submitted_at ?? b.updated_at);

/**
 * The open handovers by what the viewer can do: `mine` waits on them as the named Project Manager (accept, or ask Sales; one they already asked about is included so they can
 * see their question); `toAssign` waits on them to name a Project Manager; `otherOpen` is open but waits on someone else. Oldest first in each: the longest wait leads.
 */
export function splitOpenHandovers<T extends HandoverLite>(rows: readonly T[], userId: string, canAssign: (companyId: string) => boolean): { mine: T[]; toAssign: T[]; otherOpen: T[] } {
  const open = rows.filter((h) => (OPEN_HANDOVER_STATUSES as readonly string[]).includes(h.status));
  const mine = open.filter((h) => h.pm_user_id === userId && h.status !== "submitted").sort(oldestFirst);
  const toAssign = open.filter((h) => !mine.includes(h) && h.status === "submitted" && canAssign(h.company_id)).sort(oldestFirst);
  const otherOpen = open.filter((h) => !mine.includes(h) && !toAssign.includes(h)).sort(oldestFirst);
  return { mine, toAssign, otherOpen };
}

export const closedHandovers = <T extends HandoverLite>(rows: readonly T[]): T[] => rows.filter((h) => (CLOSED_HANDOVER_STATUSES as readonly string[]).includes(h.status));

/** The history page asked for in the address: a whole number from 1; anything else is page 1. */
export function parseHistoryPage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}

/** The address of one brief on the Handovers page (My Day and notices link here). */
export const handoverHref = (id: string): string => `/projects/handovers?${HANDOVER_PARAM}=${id}#handover-${id}`;
