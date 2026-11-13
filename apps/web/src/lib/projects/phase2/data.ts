import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";
import type { Register, SiteSchedule, WorkOverview } from "./model";

/** Four separate answers, as everywhere in Projects: the data, the migration is not applied here, the database refused this person, or the read failed. */
export type Phase2Result<T> = { state: "ok"; data: T } | { state: "not_installed" } | { state: "denied" } | { state: "error" };

async function read<T>(fn: string, args: Record<string, unknown>): Promise<Phase2Result<T>> {
  const { data, error } = await (await createClient()).rpc(fn as never, args as never);
  if (error) {
    if (isNotInstalled(error)) return { state: "not_installed" };
    if (error.code === "P0002" || error.code === "42501") return { state: "denied" };
    console.error(`[projects] ${fn} failed`, error.message);
    return { state: "error" };
  }
  return data && typeof data === "object" ? { state: "ok", data: data as T } : { state: "error" };
}

/** The deliverables register (every task with an expected output, grouped by the caller), or one task's row. One call, scoped to the reader by the database. */
export const loadRegister = (projectId: string, taskId?: string) => read<Register>("proj_deliverables_register", { p_project_id: projectId, p_task_id: taskId ?? null });
export const loadSiteSchedule = (projectId: string) => read<SiteSchedule>("proj_site_schedule", { p_project_id: projectId });
export const loadWorkOverview = (projectId: string) => read<WorkOverview>("proj_work_overview", { p_project_id: projectId });

/** The project's files the reader may open (the files' own row security decides: a restricted file is not returned to anyone but the manager), for "choose an existing file". */
export async function loadProjectFileChoices(projectId: string): Promise<{ id: string; name: string; kind: "file" | "link" }[] | null> {
  const { data, error } = await (await createClient()).from("proj_files").select("id, kind, label, original_name, url").eq("project_id", projectId).is("deleted_at", null).order("created_at", { ascending: false }).limit(200);
  if (error) return null;
  return (data ?? []).map((f) => ({ id: f.id, kind: f.kind as "file" | "link", name: f.label ?? f.original_name ?? f.url ?? "File" }));
}
