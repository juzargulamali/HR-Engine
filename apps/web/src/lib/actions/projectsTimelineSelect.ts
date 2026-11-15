"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, ok, patchOf, refreshProjects, staleMessage, uuid, type ProjectActionState } from "@/lib/projects/action-utils";

/**
 * Choose, in one place, which existing milestones and timeline activities the client sees. It only flips `client_facing` through the same database functions
 * the item pages use (patch fields + the optimistic version), so permissions, history and the guard on issued versions are unchanged: versions already issued
 * are frozen copies and are never touched. Only items whose box was actually changed are written. Individual tasks are chosen separately (saveClientTimelineTasks
 * below): a task is on a timeline only by explicit choice, with the title the client will read.
 */
type S = ProjectActionState;
const MAX_ITEMS = 300;

export async function saveClientTimelineSelection(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const changes: { kind: "milestone" | "plan_item"; id: string; to: boolean; version: number | undefined }[] = [];
  for (const [key] of fd.entries()) {
    const m = /^(mile|item)was_([0-9a-f-]{36})$/.exec(key);
    if (!m) continue;
    const kind = m[1] === "mile" ? "milestone" : "plan_item";
    const id = m[2] ?? "";
    const was = fd.get(key) === "1";
    const now = fd.get(`${m[1]}_${id}`) === "on";
    if (was === now) continue;
    const v = Number(fd.get(`${m[1]}ver_${id}`));
    changes.push({ kind, id, to: now, version: Number.isInteger(v) ? v : undefined });
  }
  if (changes.length === 0) return { error: "Nothing changed. Tick the items the client should see, or untick the ones they should not." };
  if (changes.length > MAX_ITEMS) return { error: `Change at most ${MAX_ITEMS} items at a time.` };
  const supabase = await createClient();
  let done = 0;
  for (const c of changes) {
    const stale = await staleMessage(supabase, c.kind, c.id, c.version);
    if (stale) { refreshProjects(p.data.projectId); return { error: `${done} saved. ${stale}` }; }
    const fields = patchOf({ client_facing: c.to, expected_version: c.version });
    const { error } = c.kind === "milestone"
      ? await supabase.rpc("proj_save_milestone", { p_project_id: p.data.projectId, p_milestone_id: c.id, p_fields: fields })
      : await supabase.rpc("proj_save_plan_item", { p_project_id: p.data.projectId, p_item_id: c.id, p_fields: fields });
    if (error) { refreshProjects(p.data.projectId); return fail(done > 0 ? `${done} saved, then: ${error.message}` : error.message); }
    done += 1;
  }
  refreshProjects(p.data.projectId);
  return ok();
}

const MAX_TASKS = 100;
/**
 * The individual tasks on the next client timeline, as one explicit choice: only the ticked tasks, each with the title the client will read. The whole choice is sent
 * (the database sets it as a list, so saving twice changes nothing), and the database decides who may choose (the rule for issuing) and what a client can ever see of a
 * task. Nothing is ticked by default and there is no "all tasks".
 */
export async function saveClientTimelineTasks(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const rows: { task_id: string; client_title: string }[] = [];
  for (const [key, value] of fd.entries()) {
    const m = /^task_([0-9a-f-]{36})$/.exec(key);
    if (!m || value !== "on") continue;
    const id = m[1] ?? "";
    if (!uuid.safeParse(id).success) continue;
    const title = String(fd.get(`tasktitle_${id}`) ?? "").trim();
    if (title === "") return { error: "Give every ticked task the title the client will see." };
    if (title.length > 200) return { error: "A client title can be at most 200 characters." };
    rows.push({ task_id: id, client_title: title });
  }
  if (rows.length > MAX_TASKS) return { error: `Choose at most ${MAX_TASKS} tasks for a client timeline.` };
  const supabase = await createClient();
  const { error } = await supabase.rpc("proj_set_client_timeline_tasks", { p_project_id: p.data.projectId, p_rows: rows });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return ok();
}
