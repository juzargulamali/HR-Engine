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

/** The one read of the person's groups in a request: the list, the unread counts and the "are project groups installed" answer below all come from it. */
const readMyGroups = cache(async () => (await createClient()).rpc("chat_my_groups"));

/**
 * The signed-in person's Chat groups with unread counts, from the database function that checks membership itself. An empty list means "no eligible group" (the button is hidden);
 * a missing migration also reads as no groups; any other failure is `error` (the button keeps what it last showed).
 */
export async function loadChatGroups(): Promise<ChatGroupsResult> {
  const { data, error } = await readMyGroups();
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
 * The Chat group of one project for the signed-in person. `ready` only for someone the database lets in: a person actively enrolled in the project, or an Operations Manager of
 * its company (chat_project_group decides and refuses everyone else). `not_installed` when the project-groups migration is not applied to this database, in which case the old
 * Discussion tab is still the conversation.
 *
 * `mayBeMember` is what the page already knows about the person's standing (on the project's team, or Operations Manager of its company). When it is false the database is NOT
 * asked: it would only refuse, and every refusal is recorded by the database as an error ("You are not a member of this group"). The answer is the same `not_member` it would
 * have given. When it is true the database is asked and still decides, so nothing here can let anyone in.
 */
export async function loadProjectChat(projectId: string, mayBeMember = true): Promise<ProjectChat> {
  if (!mayBeMember) return (await projectChatInstalled()) ? { state: "not_member" } : { state: "not_installed" };
  const { data, error } = await (await createClient()).rpc("chat_project_group", { p_project: projectId });
  if (error) {
    if (chatNotInstalled(error)) return { state: "not_installed" };
    return error.code === "42501" || /not a member/i.test(error.message ?? "") ? { state: "not_member" } : { state: "error" };
  }
  return typeof data === "string" ? { state: "ready", groupId: data } : { state: "error" };
}

/**
 * Whether this database has project groups (migration 20261230000100). Asked once per request, and answered without a refused call: it looks at what the person's own group
 * list returns (a row from that migration carries the group's kind), and only when the list is empty asks for that one column, which a database without the migration does not
 * have. Until 2026-11-12 this called chat_project_group for a project that does not exist and read the refusal as "it exists"; that refusal was recorded by the database as an
 * error on every page that showed unread project chat counts.
 */
export const projectChatInstalled = cache(async (): Promise<boolean> => {
  const { data, error } = await readMyGroups();
  // A failure that is not "missing" counts as installed, as before: the list read then reports the failure, and nothing falls back to the old Discussion's counts.
  if (error) return !chatNotInstalled(error);
  const first = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (first) return "gkind" in first;
  const probe = await (await createClient()).rpc("chat_my_groups").select("gkind").limit(1);
  return !probe.error;
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
