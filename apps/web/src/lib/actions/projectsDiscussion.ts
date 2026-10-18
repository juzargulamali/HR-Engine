"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, ok, optionalText, refreshProjects, uuid, type ProjectActionState } from "@/lib/projects/action-utils";
import type { ProjMessageFeedRow } from "@/types/projects";

/**
 * Private project discussion. The page keeps its own list in the browser and polls `fetchProjectMessages` modestly while the
 * tab is visible; posting is idempotent (a client nonce), so a retry after a timeout never posts twice. Chat never changes
 * a task, the scope or an approval: it is text only.
 */
type S = ProjectActionState;

export async function postProjectMessage(input: { projectId: string; body: string; parentId?: string | null; nonce: string; mentions: string[] }): Promise<{ error: string | null; id?: string }> {
  const p = z.object({ projectId: uuid, body: z.string().trim().min(1, "Write a message").max(4000, "Messages are limited to 4000 characters"), parentId: uuid.nullish(), nonce: uuid, mentions: z.array(uuid).max(20) }).safeParse(input);
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_post_message", { p_project_id: p.data.projectId, p_body: p.data.body, p_parent_id: p.data.parentId ?? null, p_nonce: p.data.nonce, p_mentions: p.data.mentions });
  if (error) return { error: fail(error.message).error };
  refreshProjects(p.data.projectId);
  return { error: null, id: data };
}

export async function fetchProjectMessages(projectId: string, afterSeq: number, changedSince: string | null): Promise<{ error: string | null; messages: ProjMessageFeedRow[] }> {
  if (!uuid.safeParse(projectId).success) return { error: "Missing project.", messages: [] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_messages_since", { p_project_id: projectId, p_after_seq: Math.max(0, Math.floor(afterSeq) || 0), p_changed_since: changedSince, p_limit: 200 });
  if (error) return { error: fail(error.message).error, messages: [] };
  return { error: null, messages: data ?? [] };
}

export async function markProjectRead(projectId: string): Promise<void> {
  if (!uuid.safeParse(projectId).success) return;
  const supabase = await createClient();
  await supabase.rpc("proj_mark_read", { p_project_id: projectId });
}

export async function editProjectMessage(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, messageId: uuid, body: z.string().trim().min(1, "Write a message").max(4000) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_edit_message", { p_message_id: p.data.messageId, p_body: p.data.body });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function deleteProjectMessage(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, messageId: uuid, reason: optionalText }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_delete_message", { p_message_id: p.data.messageId, p_reason: p.data.reason ?? null });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}

export async function markProjectNotificationsRead(ids?: string[]): Promise<void> {
  const clean = ids?.filter((i) => uuid.safeParse(i).success);
  const supabase = await createClient();
  await supabase.rpc("proj_mark_notifications_read", { p_ids: clean && clean.length > 0 ? clean : null });
  refreshProjects();
}
