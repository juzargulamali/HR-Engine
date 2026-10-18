import "server-only";
import { cache } from "react";
import { canManageProject, isProjFounder, projectViewLevel, type ProjectStanding, type ProjectViewLevel } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { ProjectsContext } from "./context";
import type { ProjDirectoryRow, ProjProjectDetailsRow, ProjProjectPersonRow, ProjProjectRow, ProjTeamRow } from "@/types/projects";

/** Everything every project page needs to know about the project and the signed-in person's standing in it. */
export interface ProjectView {
  ctx: ProjectsContext;
  project: ProjProjectRow;
  /** Member-only details; null for a summary-only viewer (directory user, linked Sales). */
  details: ProjProjectDetailsRow | null;
  level: Exclude<ProjectViewLevel, "none">;
  standing: ProjectStanding;
  isFounder: boolean;
  canManage: boolean;
  people: ProjProjectPersonRow[];
  /** Active department teams only. */
  teams: ProjTeamRow[];
  myTeamId: string | null;
  headOfTeamIds: string[];
  pmName: string;
  companyName: string;
  nameOf: (id: string | null | undefined) => string;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * One read of the directory per request (it already carries the PM's name, which a summary-only viewer cannot get elsewhere). A failed
 * read is reported as an error, so the directory page can say so instead of presenting it as "no projects".
 */
export const loadDirectoryResult = cache(async (): Promise<{ rows: ProjDirectoryRow[]; error: string | null }> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_directory");
  return { rows: data ?? [], error: error ? error.message : null };
});

export const loadDirectory = cache(async (): Promise<ProjDirectoryRow[]> => (await loadDirectoryResult()).rows);

/**
 * Loads a project the person can see. Returns null when it does not exist or they may not see it (the two are not told apart).
 * RLS decides what comes back; `level` is derived from what did, and mirrors the database's own helpers.
 */
export const loadProjectView = cache(async (ctx: ProjectsContext, projectId: string): Promise<ProjectView | null> => {
  const supabase = await createClient();
  const { data: project } = await supabase.from("proj_projects").select("*").eq("id", projectId).maybeSingle();
  if (!project) return null;
  const [{ data: details }, { data: people }, { data: teamRows }, directory] = await Promise.all([
    supabase.from("proj_project_details").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.rpc("proj_project_people", { p_project_id: projectId }),
    supabase.from("proj_teams").select("*").eq("project_id", projectId).is("removed_at", null).order("name"),
    loadDirectory(),
  ]);
  const peopleList = people ?? [];
  const teams = teamRows ?? [];
  const me = peopleList.find((p) => p.user_id === ctx.userId) ?? null;
  const headOfTeamIds = teams.filter((t) => t.head_user_id === ctx.userId).map((t) => t.id);
  const standing: ProjectStanding = {
    companyId: project.company_id,
    grants: ctx.grants,
    isPm: project.pm_user_id === ctx.userId,
    isMember: me !== null,
    isActingPm: me?.role === "acting_pm" && !!me.acting_until && me.acting_until >= todayUtc(),
    headOfTeamIds,
    isSalesLinked: ctx.salesLinkedProjectIds.includes(project.id),
    status: project.status,
  };
  const level = projectViewLevel(standing);
  if (level === "none") return null;
  const dirRow = directory.find((d) => d.id === project.id);
  const names = new Map(peopleList.map((p) => [p.user_id, p.full_name ?? "Unnamed"]));
  const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? ctx.personName(id)) : "Nobody");
  return {
    ctx, project, details: details ?? null, level, standing, isFounder: isProjFounder(ctx.grants, project.company_id), canManage: canManageProject(standing),
    people: peopleList, teams, myTeamId: me?.team_id ?? null, headOfTeamIds,
    pmName: dirRow?.pm_name ?? nameOf(project.pm_user_id), companyName: ctx.companyName(project.company_id), nameOf,
  };
});

/** Plain-text name list for pickers: active members of the project. */
export const memberOptions = (v: ProjectView) => v.people.map((p) => ({ id: p.user_id, name: p.full_name ?? "Unnamed" }));
