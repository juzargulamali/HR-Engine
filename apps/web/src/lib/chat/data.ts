import "server-only";
import { cache } from "react";
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
    groups: (data ?? []).map((g) => ({ id: g.gid, key: g.gkey, name: g.gname, unread: Number(g.unread), mentions: Number(g.mentions), lastAt: g.last_at, lastSender: g.last_sender, lastPreview: g.last_preview,
      kind: g.gkind === "project" ? "project" as const : "sales" as const, projectId: g.project_id ?? null, readOnly: g.read_only === true,
      projectStatus: g.project_status ?? null, viaOperations: g.via_operations === true })),
  };
}

export type ProjectChat = { state: "ready"; groupId: string } | { state: "not_member" } | { state: "not_installed" } | { state: "error" };

/**
 * The Chat group of one project for the signed-in person. `ready` only for someone actively enrolled in the project (the database function decides and refuses everyone else);
 * `not_installed` when the project-groups migration is not applied to this database, in which case the old Discussion tab is still the conversation.
 */
export async function loadProjectChat(projectId: string): Promise<ProjectChat> {
  const { data, error } = await (await createClient()).rpc("chat_project_group", { p_project: projectId });
  if (error) {
    if (chatNotInstalled(error)) return { state: "not_installed" };
    return error.code === "42501" || /not a member/i.test(error.message ?? "") ? { state: "not_member" } : { state: "error" };
  }
  return typeof data === "string" ? { state: "ready", groupId: data } : { state: "error" };
}

const NO_PROJECT = "00000000-0000-0000-0000-000000000000";
/** Whether this database has project groups (migration 20261230000100). Asked once per request: the function refuses an unknown project, which proves it exists. */
export const projectChatInstalled = cache(async (): Promise<boolean> => {
  const { error } = await (await createClient()).rpc("chat_project_group", { p_project: NO_PROJECT });
  return !chatNotInstalled(error);
});

/**
 * Unread project conversation messages per project, for the signed-in person. From Chat once project groups exist (the read marker people move by reading the group); from the
 * old Discussion's own counts on a database that does not have them yet. `null` = the count could not be read (callers must not show that as zero).
 */
export const loadProjectUnread = cache(async (): Promise<Map<string, number> | null> => {
  const db = await createClient();
  if (await projectChatInstalled()) {
    const r = await loadChatGroups();
    if (r.state !== "ok") return null;
    return new Map(r.groups.filter((g) => g.kind === "project" && g.projectId && g.unread > 0).map((g) => [g.projectId as string, g.unread]));
  }
  const { data, error } = await db.rpc("proj_unread_counts");
  if (error) return null;
  return new Map((data ?? []).filter((x) => x.unread > 0).map((x) => [x.project_id, x.unread]));
});
