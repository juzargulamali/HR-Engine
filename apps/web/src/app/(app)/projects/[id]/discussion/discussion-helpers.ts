import type { ProjMessageFeedRow } from "@/types/projects";

/** Pure helpers for the live discussion: merging polled messages, poll timing, @mentions, threads. */

export const POLL_VISIBLE_MS = 8_000;
export const POLL_HIDDEN_MS = 60_000;
export const POLL_MAX_MS = 60_000;
export const GIVE_UP_NOTICE_AFTER = 4;

/** Merge by id: a message that arrives again keeps whichever copy changed last (edits and deletions arrive this way). Ordered by seq. */
export function mergeMessages(existing: readonly ProjMessageFeedRow[], incoming: readonly ProjMessageFeedRow[]): ProjMessageFeedRow[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) {
    const have = byId.get(m.id);
    if (!have || m.changed_at >= have.changed_at) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export const maxSeq = (messages: readonly ProjMessageFeedRow[]) => messages.reduce((n, m) => Math.max(n, m.seq), 0);
export const maxChangedAt = (messages: readonly ProjMessageFeedRow[]): string | null =>
  messages.reduce<string | null>((acc, m) => (acc === null || m.changed_at > acc ? m.changed_at : acc), null);

/** How many messages in `incoming` are new to the list (not seen before, not mine). */
export const countNewFromOthers = (existing: readonly ProjMessageFeedRow[], incoming: readonly ProjMessageFeedRow[], me: string) => {
  const known = new Set(existing.map((m) => m.id));
  return incoming.filter((m) => !known.has(m.id) && m.author_id !== me && !m.deleted_at).length;
};

/**
 * Delay before the next poll: about every 8 s while the tab is visible, once a minute while it is hidden, and exponentially
 * longer after failures (never more than a minute), so an outage is not hammered.
 */
export function nextPollDelay(visible: boolean, failures: number): number {
  const base = visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;
  if (failures <= 0) return base;
  return Math.min(POLL_MAX_MS, base * 2 ** Math.min(failures, 6));
}

export type ConnectionState = "ok" | "reconnecting" | "failed";
export const connectionState = (failures: number): ConnectionState => (failures <= 0 ? "ok" : failures >= GIVE_UP_NOTICE_AFTER ? "failed" : "reconnecting");

export interface Mentionable {
  id: string;
  name: string;
}

/** The ids of picked people whose "@Name" is still in the text. Typing a name without picking mentions nobody. */
export function extractMentionIds(text: string, picked: readonly Mentionable[]): string[] {
  const ids = new Set<string>();
  for (const p of picked) if (p.name && text.includes(`@${p.name}`)) ids.add(p.id);
  return [...ids];
}

export interface TextSegment {
  text: string;
  mention: boolean;
}

/** Splits text so every "@Known Name" can be highlighted. Longer names are matched first so "@Ann Lee" beats "@Ann". */
export function highlightMentions(text: string, names: readonly string[]): TextSegment[] {
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (sorted.length === 0 || !text.includes("@")) return [{ text, mention: false }];
  const out: TextSegment[] = [];
  let i = 0;
  let buf = "";
  while (i < text.length) {
    const hit = text[i] === "@" ? sorted.find((n) => text.startsWith(`@${n}`, i)) : undefined;
    if (hit) {
      if (buf) out.push({ text: buf, mention: false });
      buf = "";
      out.push({ text: `@${hit}`, mention: true });
      i += hit.length + 1;
    } else {
      buf += text[i];
      i += 1;
    }
  }
  if (buf) out.push({ text: buf, mention: false });
  return out;
}

export interface Thread {
  root: ProjMessageFeedRow;
  replies: ProjMessageFeedRow[];
}

/** One level of replies: a reply to a reply sits under the same root. A reply whose parent is not loaded is shown on its own. */
export function groupThreads(messages: readonly ProjMessageFeedRow[]): Thread[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const rootOf = (m: ProjMessageFeedRow): string => {
    let cur = m;
    for (let guard = 0; guard < 50 && cur.parent_id; guard++) {
      const p = byId.get(cur.parent_id);
      if (!p) return cur.id;
      cur = p;
    }
    return cur.id;
  };
  const threads = new Map<string, Thread>();
  for (const m of messages) {
    const rid = rootOf(m);
    if (rid === m.id) threads.set(m.id, { root: m, replies: [] });
  }
  for (const m of messages) {
    const rid = rootOf(m);
    if (rid !== m.id) threads.get(rid)?.replies.push(m);
  }
  return [...threads.values()];
}
