import "server-only";
import { cache } from "react";
import { hasProjCapability, isProjFounder } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { ProjectsContext } from "./context";
import { todayIso } from "./format";
import { groupTasksByDue, handoverWaitsOnMe, isWaitingOnMyReview, type ReviewContext } from "./work-logic";
import type { ProjHandoverRow, ProjTaskRow } from "@/types/projects";

export interface WorkTask extends ProjTaskRow {
  projectReference: string;
  projectName: string;
  projectStatus: string;
}

export interface MyWork {
  open: WorkTask[];
  reviews: WorkTask[];
  today: string;
}

const OPEN = ["todo", "in_progress", "ready_for_review"];

/**
 * My open tasks (assignee or collaborator) and the tasks waiting on my review, each with its project's reference and name. Everything
 * is read through the person's own session, so RLS decides what is visible (a project they can no longer see is simply absent).
 * Errors (including the tables not existing yet) read as "nothing".
 */
export const loadMyWork = cache(async (ctx: ProjectsContext): Promise<MyWork> => {
  const today = todayIso();
  if (ctx.grants.length === 0) return { open: [], reviews: [], today };
  const supabase = await createClient();
  const [{ data: collab }, { data: teams }, { data: acting }] = await Promise.all([
    supabase.from("proj_task_collaborators").select("task_id").eq("user_id", ctx.userId),
    supabase.from("proj_teams").select("id, project_id").eq("head_user_id", ctx.userId).is("removed_at", null),
    supabase.from("proj_project_members").select("project_id, acting_until").eq("user_id", ctx.userId).eq("role", "acting_pm").is("removed_at", null),
  ]);
  const collabIds = (collab ?? []).map((c) => c.task_id);
  const [mine, collabTasks, reviewCandidates] = await Promise.all([
    supabase.from("proj_tasks").select("*").eq("assignee_id", ctx.userId).in("status", OPEN),
    collabIds.length > 0 ? supabase.from("proj_tasks").select("*").in("id", collabIds).in("status", OPEN) : Promise.resolve({ data: [] as ProjTaskRow[] }),
    supabase.from("proj_tasks").select("*").eq("status", "ready_for_review").neq("assignee_id", ctx.userId),
  ]);
  const byId = new Map<string, ProjTaskRow>();
  for (const t of [...(mine.data ?? []), ...(collabTasks.data ?? [])]) byId.set(t.id, t);
  const open = [...byId.values()];
  const candidates = reviewCandidates.data ?? [];

  const projectIds = [...new Set([...open.map((t) => t.project_id), ...candidates.map((t) => t.project_id)])];
  const { data: projects } = projectIds.length > 0 ? await supabase.from("proj_projects").select("id, reference, name, status, company_id, pm_user_id").in("id", projectIds) : { data: [] };
  const projectBy = new Map((projects ?? []).map((p) => [p.id, p]));
  const headBy = new Map<string, string[]>();
  for (const t of teams ?? []) headBy.set(t.project_id, [...(headBy.get(t.project_id) ?? []), t.id]);
  const actingSet = new Set((acting ?? []).filter((a) => a.acting_until && a.acting_until >= today).map((a) => a.project_id));

  const decorate = (t: ProjTaskRow): WorkTask | null => {
    const p = projectBy.get(t.project_id);
    return p ? { ...t, projectReference: p.reference, projectName: p.name, projectStatus: p.status } : null;
  };
  const reviews = candidates
    .filter((t) => {
      const p = projectBy.get(t.project_id);
      if (!p) return false;
      const rc: ReviewContext = { userId: ctx.userId, isFounder: isProjFounder(ctx.grants, p.company_id), isPm: p.pm_user_id === ctx.userId, isActingPm: actingSet.has(p.id), headOfTeamIds: headBy.get(p.id) ?? [] };
      return isWaitingOnMyReview(t, rc);
    })
    .map(decorate)
    .filter((t): t is WorkTask => t !== null);
  return { open: open.map(decorate).filter((t): t is WorkTask => t !== null), reviews, today };
});

export interface ProjectsAttention {
  overdueTasks: number;
  dueSoonTasks: number;
  reviewsWaiting: number;
  handoversWaiting: number;
  unreadMessages: number;
  unreadProjects: number;
}

/** The "needs you" numbers shared by the Projects overview and My Day: real counts from the same queries, never estimates. */
export const loadProjectsAttention = cache(async (ctx: ProjectsContext): Promise<ProjectsAttention> => {
  const empty: ProjectsAttention = { overdueTasks: 0, dueSoonTasks: 0, reviewsWaiting: 0, handoversWaiting: 0, unreadMessages: 0, unreadProjects: 0 };
  if (ctx.grants.length === 0) return empty;
  try {
    const supabase = await createClient();
    const [work, handovers, unread] = await Promise.all([
      loadMyWork(ctx),
      supabase.from("proj_handovers").select("company_id, status, pm_user_id").in("status", ["submitted", "pm_assigned"]).limit(100),
      supabase.rpc("proj_unread_counts"),
    ]);
    const groups = groupTasksByDue(work.open, work.today);
    const unreadRows = (unread.data ?? []).filter((r) => r.unread > 0);
    return {
      overdueTasks: groups.overdue.length,
      dueSoonTasks: groups.soon.length,
      reviewsWaiting: work.reviews.length,
      handoversWaiting: (handovers.data ?? []).filter((h) => handoverWaitsOnMe(h, ctx.userId, (c) => hasProjCapability(ctx.grants, c, "assign_pm"))).length,
      unreadMessages: unreadRows.reduce((n, r) => n + r.unread, 0),
      unreadProjects: unreadRows.length,
    };
  } catch {
    return empty;
  }
});

export type HandoverWithNames = ProjHandoverRow & { pmName: string | null; salesName: string | null; companyName: string };
