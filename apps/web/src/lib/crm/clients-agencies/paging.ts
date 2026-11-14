/**
 * Paging over a list that was already read and filtered in full (the directory, the shared organisations list). Nothing is read again: a page is a
 * slice, and the sentence always names the slice and the whole, so a long list is never cut off without saying so.
 */
export const DIRECTORY_PAGE_SIZE = 100;

export interface PageWindow {
  /** The page shown, 1-based, always an existing page (a number past the end falls back to the last page). */
  page: number;
  pages: number;
  /** 1-based position of the first and last row shown; both 0 for an empty list. */
  from: number;
  to: number;
  total: number;
}

/** `requested` is whatever the address held: anything that is not a whole number of 1 or more is page 1. */
export function pageWindow(total: number, requested: string | string[] | number | null | undefined, size: number = DIRECTORY_PAGE_SIZE): PageWindow {
  const pages = Math.max(1, Math.ceil(total / size));
  const n = typeof requested === "number" ? requested : typeof requested === "string" && /^\d+$/.test(requested) ? Number(requested) : 1;
  const page = Math.min(Math.max(1, n), pages);
  if (total === 0) return { page: 1, pages: 1, from: 0, to: 0, total: 0 };
  return { page, pages, from: (page - 1) * size + 1, to: Math.min(page * size, total), total };
}

export const pageSlice = <T>(rows: readonly T[], w: PageWindow): T[] => (w.total === 0 ? [] : rows.slice(w.from - 1, w.to));

/**
 * "Showing 1-100 of 240 accounts", or "3 accounts" when everything fits on the page. `whole` is the size of the unfiltered list: when filters
 * narrowed it, the sentence says so ("matching, of 900 in all").
 */
export function pagingSentence(w: PageWindow, one: string, many: string, whole?: number): string {
  const noun = w.total === 1 ? one : many;
  const narrowed = whole !== undefined && whole !== w.total ? ` matching, of ${whole} in all` : "";
  if (w.total === 0) return `No ${many}${narrowed}`;
  if (w.pages === 1) return `${w.total} ${noun}${narrowed}`;
  return `Showing ${w.from}-${w.to} of ${w.total} ${noun}${narrowed}`;
}
