import type { ProjMessageFeedRow } from "@/types/projects";

/**
 * Paging backwards through a project's discussion. The page opens on the latest messages; "Show earlier messages" fetches the
 * ones before the oldest message already loaded, EARLIER_PAGE at a time, until the first message. The database returns a page
 * newest first and the caller asks for one extra row, which only says whether anything older remains.
 */
export const EARLIER_PAGE = 50;

export interface EarlierPage {
  /** The page in reading order (oldest first), never more than `pageSize` messages. */
  messages: ProjMessageFeedRow[];
  /** True when at least one older message exists beyond this page. */
  hasMore: boolean;
}

export function splitEarlierPage(rowsNewestFirst: readonly ProjMessageFeedRow[], pageSize: number = EARLIER_PAGE): EarlierPage {
  const hasMore = rowsNewestFirst.length > pageSize;
  const messages = [...rowsNewestFirst.slice(0, pageSize)].sort((a, b) => a.seq - b.seq);
  return { messages, hasMore };
}

/** The cursor for the next request: the oldest sequence number in a page (null when the page is empty). */
export const oldestSeq = (messages: readonly ProjMessageFeedRow[]): number | null =>
  messages.length === 0 ? null : messages.reduce((n, m) => Math.min(n, m.seq), Number.POSITIVE_INFINITY);

export interface PollCursor {
  seq: number;
  changed: string | null;
}

/**
 * The live feed's cursor only ever moves forward, and only on what the live feed returned. Older messages loaded by hand must
 * never move it: an old message edited recently would otherwise push the "changed since" mark past edits to newer messages
 * that the next poll still has to deliver.
 */
export function advanceCursor(cursor: PollCursor, incoming: readonly ProjMessageFeedRow[]): PollCursor {
  let { seq, changed } = cursor;
  for (const m of incoming) {
    if (m.seq > seq) seq = m.seq;
    if (changed === null || m.changed_at > changed) changed = m.changed_at;
  }
  return { seq, changed };
}
