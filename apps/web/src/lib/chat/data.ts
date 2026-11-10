import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ChatGroup } from "./model";

/** True when the Chat functions do not exist yet (the migration has not been applied to this database): the button then simply does not appear. */
export function chatNotInstalled(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42883" || error.code === "42P01" || error.code === "PGRST202" || error.code === "PGRST205" || /schema cache|does not exist/i.test(error.message ?? "");
}

export type ChatGroupsResult = { state: "ok"; groups: ChatGroup[] } | { state: "error" };

/**
 * The signed-in person's Chat groups with unread counts, from the database function that checks membership itself. An empty list means "no eligible group" (the button is hidden);
 * a missing migration also reads as no groups; any other failure is `error` (the button keeps what it last showed).
 */
export async function loadChatGroups(): Promise<ChatGroupsResult> {
  const { data, error } = await (await createClient()).rpc("chat_my_groups");
  if (error) return chatNotInstalled(error) ? { state: "ok", groups: [] } : { state: "error" };
  return {
    state: "ok",
    groups: (data ?? []).map((g) => ({ id: g.gid, key: g.gkey, name: g.gname, unread: Number(g.unread), mentions: Number(g.mentions), lastAt: g.last_at, lastSender: g.last_sender, lastPreview: g.last_preview })),
  };
}
