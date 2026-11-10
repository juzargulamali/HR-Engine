"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { friendlyCrmError } from "@/lib/crm/errors";
import { loadChatGroups } from "@/lib/chat/data";
import { MAX_BODY, SHARE_TYPES, type ChatGroup, type ChatMention, type ChatMessage } from "@/lib/chat/model";

/**
 * App-wide Chat server actions (migration 20261225000100). Thin wrappers over the chat_* database functions: the function, not this file, decides who is a member (an active Sales
 * grant for that company), who may be mentioned, who may share an item and what each reader may see of it. This layer parses the input and turns errors into sentences.
 */
const uuid = z.string().uuid();
const fail = (message: string) => ({ ok: false as const, error: friendlyCrmError(message) });

export type ChatResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function chatGroups(): Promise<ChatResult<{ groups: ChatGroup[] }>> {
  const r = await loadChatGroups();
  return r.state === "ok" ? { ok: true, groups: r.groups } : fail("Chat could not be loaded.");
}

export async function chatMessages(groupId: string, opts: { before?: number; after?: number } = {}): Promise<ChatResult<{ messages: ChatMessage[]; hasMore: boolean; lastRead: number }>> {
  if (!uuid.safeParse(groupId).success) return fail("Missing group.");
  const { data, error } = await (await createClient()).rpc("chat_messages", { p_group: groupId, p_before: opts.before ?? null, p_after: opts.after ?? null, p_limit: 40 });
  if (error) return fail(error.message);
  const d = data as { messages: ChatMessage[]; hasMore: boolean; lastRead: number };
  return { ok: true, messages: d.messages, hasMore: d.hasMore, lastRead: Number(d.lastRead) };
}

export async function chatMembers(groupId: string): Promise<ChatResult<{ members: ChatMention[] }>> {
  if (!uuid.safeParse(groupId).success) return fail("Missing group.");
  const { data, error } = await (await createClient()).rpc("chat_group_members", { p_group: groupId });
  if (error) return fail(error.message);
  return { ok: true, members: (data ?? []).map((m) => ({ userId: m.user_id, name: m.name })) };
}

const postSchema = z.object({
  groupId: uuid, body: z.string().max(MAX_BODY, `A message can be at most ${MAX_BODY} characters`), mentions: z.array(uuid).max(20),
  share: z.object({ type: z.enum(SHARE_TYPES.map((s) => s.type) as [string, ...string[]]), id: uuid }).nullable(), clientKey: z.string().min(8).max(64),
});

export async function chatPost(input: z.input<typeof postSchema>): Promise<ChatResult<{ id: string; seq: number }>> {
  const p = postSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Invalid message.");
  const d = p.data;
  const { data, error } = await (await createClient()).rpc("chat_post", {
    p_group: d.groupId, p_body: d.body, p_mentions: d.mentions, p_ref_type: d.share?.type ?? null, p_ref_id: d.share?.id ?? null, p_client_key: d.clientKey,
  });
  if (error) return fail(error.message);
  const r = data as { id: string; seq: number };
  return { ok: true, id: r.id, seq: Number(r.seq) };
}

export async function chatMarkRead(groupId: string, seq: number): Promise<{ ok: boolean }> {
  if (!uuid.safeParse(groupId).success || !Number.isFinite(seq)) return { ok: false };
  const { error } = await (await createClient()).rpc("chat_mark_read", { p_group: groupId, p_seq: seq });
  return { ok: !error };
}

export interface ShareHit { id: string; label: string; detail: string }

const esc = (q: string) => q.trim().replace(/[\\%_,()]/g, " ").trim().slice(0, 60);

/**
 * The searchable "Share item" control: finds items the SIGNED-IN person can see (their own session, so row-level security decides) by type and text. Sharing re-checks the sender's access
 * in the database, and each reader's access is checked when the message is shown, so this list is a convenience, never a permission.
 */
export async function chatSearchItems(type: string, query: string): Promise<ChatResult<{ hits: ShareHit[] }>> {
  const q = esc(query);
  const like = `%${q}%`;
  const db = await createClient();
  const LIMIT = 8;
  try {
    if (type === "enquiry") {
      const cols = "id, reference, title, stage";
      const [a, b] = q ? await Promise.all([db.from("crm_opportunities").select(cols).ilike("reference", like).order("updated_at", { ascending: false }).limit(LIMIT), db.from("crm_opportunities").select(cols).ilike("title", like).order("updated_at", { ascending: false }).limit(LIMIT)])
        : [await db.from("crm_opportunities").select(cols).order("updated_at", { ascending: false }).limit(LIMIT), { data: [], error: null }];
      if (a.error || b.error) return fail("Search failed.");
      const rows = new Map([...(a.data ?? []), ...(b.data ?? [])].map((r) => [r.id, r]));
      return { ok: true, hits: [...rows.values()].slice(0, LIMIT).map((r) => ({ id: r.id, label: `${r.reference} · ${r.title}`, detail: r.reference })) };
    }
    if (type === "estimate") {
      let oppIds: string[] | null = null;
      const opps = new Map<string, { reference: string; title: string }>();
      if (q) {
        const [a, b] = await Promise.all([db.from("crm_opportunities").select("id, reference, title").ilike("reference", like).limit(10), db.from("crm_opportunities").select("id, reference, title").ilike("title", like).limit(10)]);
        if (a.error || b.error) return fail("Search failed.");
        for (const r of [...(a.data ?? []), ...(b.data ?? [])]) opps.set(r.id, r);
        oppIds = [...opps.keys()];
        if (oppIds.length === 0) return { ok: true, hits: [] };
      }
      const pq = db.from("crm_proposals").select("id, version, opportunity_id").order("created_at", { ascending: false }).limit(LIMIT);
      const props = await (oppIds ? pq.in("opportunity_id", oppIds) : pq);
      if (props.error) return fail("Search failed.");
      const missing = [...new Set((props.data ?? []).map((p) => p.opportunity_id))].filter((i) => !opps.has(i));
      if (missing.length) {
        const more = await db.from("crm_opportunities").select("id, reference, title").in("id", missing);
        for (const r of more.data ?? []) opps.set(r.id, r);
      }
      return { ok: true, hits: (props.data ?? []).map((p) => { const o = opps.get(p.opportunity_id); return { id: p.id, label: `Estimate v${p.version} · ${o?.reference ?? ""}`, detail: o?.title ?? "" }; }) };
    }
    if (type === "account") {
      let qb = db.from("crm_organisations").select("id, name, roles, country_code").is("archived_at", null).order("name").limit(LIMIT);
      if (q) qb = qb.ilike("name", like);
      const r = await qb;
      if (r.error) return fail("Search failed.");
      return { ok: true, hits: (r.data ?? []).map((o) => ({ id: o.id, label: o.name, detail: [o.roles.join(", "), o.country_code].filter(Boolean).join(" · ") })) };
    }
    if (type === "event") {
      let qb = db.from("crm_events").select("id, name, kind").is("archived_at", null).order("name").limit(LIMIT);
      if (q) qb = qb.ilike("name", like);
      const r = await qb;
      if (r.error) return fail("Search failed.");
      return { ok: true, hits: (r.data ?? []).map((e) => ({ id: e.id, label: e.name, detail: e.kind })) };
    }
    if (type === "edition") {
      const names = new Map<string, string>();
      let ids: string[] | null = null;
      if (q) {
        const ev = await db.from("crm_events").select("id, name").ilike("name", like).limit(10);
        if (ev.error) return fail("Search failed.");
        for (const e of ev.data ?? []) names.set(e.id, e.name);
        ids = [...names.keys()];
        if (ids.length === 0) return { ok: true, hits: [] };
      }
      const eq = db.from("crm_event_editions").select("id, event_id, start_date, city").is("archived_at", null).order("start_date", { ascending: false }).limit(LIMIT);
      const eds = await (ids ? eq.in("event_id", ids) : eq);
      if (eds.error) return fail("Search failed.");
      const missing = [...new Set((eds.data ?? []).map((d) => d.event_id))].filter((i) => !names.has(i));
      if (missing.length) for (const e of (await db.from("crm_events").select("id, name").in("id", missing)).data ?? []) names.set(e.id, e.name);
      return { ok: true, hits: (eds.data ?? []).map((d) => ({ id: d.id, label: `${names.get(d.event_id) ?? "Event"} · ${d.start_date.slice(0, 4)}${d.city ? ` · ${d.city}` : ""}`, detail: d.start_date })) };
    }
  } catch {
    return fail("Search failed.");
  }
  return fail("Choose what to share.");
}
