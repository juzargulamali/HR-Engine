/**
 * Pure helpers for the app-wide Chat panel (no database, no React): the unread badge text, the "@Name" handling of a message, day headings, short times and the one rule about what
 * a posted message may mention. The server decides who is a member and who may see a shared item; nothing here is a permission.
 */

export type ChatGroupKind = "sales" | "project";
export interface ChatGroup {
  id: string; key: string; name: string; unread: number; mentions: number; lastAt: string | null; lastSender: string | null; lastPreview: string | null;
  /** "project" = one project's group (members: the people actively enrolled in that project). Absent on a database without project groups: read as "sales". */
  kind?: ChatGroupKind; projectId?: string | null;
  /** A finished project's conversation: it can be read, not written (the server refuses a post). */
  readOnly?: boolean;
}

/** The address parameter that opens one group in the Chat panel from any page (old Discussion links and the project's "Open chat" shortcut use it). */
export const CHAT_PARAM = "chat";
/** The event a page fires to open one group in the panel without changing the address. */
export const CHAT_OPEN_EVENT = "enginious:open-chat";
export const openChatGroup = (groupId: string): void => { window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail: { groupId } })); };

/** The group list in sections: Sales groups, then project groups (already most recent first from the server). A section with no group is left out. */
export function groupSections<T extends Pick<ChatGroup, "kind">>(groups: readonly T[]): { title: string; groups: T[] }[] {
  const sales = groups.filter((g) => (g.kind ?? "sales") === "sales");
  const projects = groups.filter((g) => g.kind === "project");
  return [{ title: "Sales", groups: sales }, { title: "Projects", groups: projects }].filter((s) => s.groups.length > 0);
}
/** Who is in a group, in words (the server decides; this only describes it). */
export const membershipLine = (g: Pick<ChatGroup, "kind" | "readOnly">): string =>
  g.kind === "project" ? (g.readOnly ? "This project is finished: the conversation can be read, not added to" : "The people on this project") : "Everyone with Sales access to this company";
export const filterGroups = <T extends Pick<ChatGroup, "name">>(groups: readonly T[], query: string): T[] => {
  const q = query.trim().toLowerCase();
  return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : [...groups];
};
export interface ChatMention { userId: string; name: string }
export type SharedItem = { restricted: true } | { restricted?: undefined; type: ShareType; id: string; title: string; subtitle: string; href: string };
export interface ChatMessage { id: string; seq: number; senderId: string; senderName: string; body: string; createdAt: string; mentions: ChatMention[]; shared: SharedItem | null }
export type ShareType = "enquiry" | "estimate" | "account" | "event" | "edition";
export const SHARE_TYPES: { type: ShareType; label: string; hint: string }[] = [
  { type: "enquiry", label: "Enquiry", hint: "Reference or title" },
  { type: "estimate", label: "Estimate", hint: "Enquiry reference or title" },
  { type: "account", label: "Client or agency", hint: "Name" },
  { type: "event", label: "Event", hint: "Event name" },
  { type: "edition", label: "Edition", hint: "Event name" },
];

/** The number on the floating button: nothing when zero, the number up to 99, then "99+". */
export const badgeText = (n: number): string => (n <= 0 ? "" : n > 99 ? "99+" : String(n));
export const totalUnread = (groups: readonly Pick<ChatGroup, "unread">[]): number => groups.reduce((a, g) => a + g.unread, 0);

/** The button's spoken label, which carries the same counts the badge shows. */
export function launcherLabel(groups: readonly Pick<ChatGroup, "unread" | "mentions">[]): string {
  const n = totalUnread(groups);
  const at = groups.reduce((a, g) => a + g.mentions, 0);
  return n === 0 ? "Open chat" : `Open chat, ${n} unread${at > 0 ? `, ${at} mention${at === 1 ? "" : "s"} of you` : ""}`;
}

/** Splits a message body into plain text and the @Name parts that match a mention the server stored, so only real mentions are highlighted. */
export function splitMentions(body: string, mentions: readonly ChatMention[]): { text: string; mention?: ChatMention }[] {
  const names = [...new Set(mentions.map((m) => m.name))].sort((a, b) => b.length - a.length);
  if (names.length === 0 || !body.includes("@")) return [{ text: body }];
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  const out: { text: string; mention?: ChatMention }[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: body.slice(last, at) });
    const who = mentions.find((x) => x.name === m[1])!;
    out.push({ text: m[0], mention: who });
    last = at + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}

/** Of the people picked from the member list, only those whose "@Name" is still in the text are sent as mentions (deleting the text removes the mention). */
export function mentionsStillInText(body: string, picked: readonly ChatMention[]): ChatMention[] {
  const seen = new Set<string>();
  return picked.filter((p) => {
    if (seen.has(p.userId) || !new RegExp(`@${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "u").test(body)) return false;
    seen.add(p.userId);
    return true;
  });
}

/** The text after the last "@" the cursor is in, when that "@" starts a word: the filter for the mention list. null = not typing a mention. */
export function mentionQuery(text: string, cursor: number): { query: string; start: number } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
  const query = before.slice(at + 1);
  return /\s/.test(query) && query.trim().split(/\s+/).length > 2 ? null : { query, start: at };
}

export function filterMembers<T extends { name: string }>(members: readonly T[], query: string, limit = 6): T[] {
  const q = query.trim().toLowerCase();
  const hits = members.filter((m) => m.name.toLowerCase().includes(q));
  return [...hits.filter((m) => m.name.toLowerCase().startsWith(q)), ...hits.filter((m) => !m.name.toLowerCase().startsWith(q))].slice(0, limit);
}

const DAY = 86_400_000;
/** "Today", "Yesterday" or a short date, in the viewer's own calendar. */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
export const clockTime = (iso: string): string => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** A short "5m", "3h", "2d" for the group list. */
export function shortAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

/** Merges newly fetched messages into the list: by sequence number, no duplicates, oldest first. */
export function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const bySeq = new Map<number, ChatMessage>();
  for (const m of current) bySeq.set(m.seq, m);
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export const MAX_BODY = 4000;
