import "server-only";
import { cache } from "react";
import { hasProjCapability, isProjFounder } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { ProjectsContext } from "./context";
import { dateText, todayIso } from "./format";
import { groupTasksByDue, handoverWaitsOnMe, isWaitingOnMyReview, type ReviewContext } from "./work-logic";
import type { ProjHandoverRow, ProjProjectPersonRow, ProjTaskRow } from "@/types/projects";
import type { ProjectStanding } from "@enginious-hr/domain";
import { buildTaskRow, type ProjectLookup, type TaskRowData } from "@/components/projects/tasks/task-logic";

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

// ---- Rows for the My Work table and board -----------------------------------------------------------------------

export interface WorkRows {
  today: string;
  /** Open tasks assigned to me or shared with me as a collaborator. */
  mine: TaskRowData[];
  /** Tasks waiting for a review I may give (never my own work). */
  reviews: TaskRowData[];
  /** Open tasks of the projects and teams I lead: every task of a project I manage (PM, temporary leader, founder), my team's tasks where I head a department. */
  team: TaskRowData[];
  /** Whether "My team" means anything for this person (they lead at least one project or team). */
  canSeeTeam: boolean;
}

const FINISHED = "(completed,archived)";
const ok = (...results: { error?: { message: string } | null }[]) => {
  for (const r of results) if (r.error) throw new Error(`Work could not be loaded: ${r.error.message}`);
};

/**
 * Everything the My Work table and board show, as rows that already say what this person may change on each task (the same rules as the
 * task page). Read through the person's own session, so RLS decides what exists for them. Unlike loadMyWork, a failed read throws, so
 * the page can say "could not load" instead of showing an empty list.
 */
export const loadWorkRows = cache(async (ctx: ProjectsContext): Promise<WorkRows> => {
  const today = todayIso();
  const none: WorkRows = { today, mine: [], reviews: [], team: [], canSeeTeam: false };
  if (ctx.grants.length === 0) return none;
  const supabase = await createClient();
  const founderCompanies = ctx.grants.map((g) => g.companyId).filter((c) => isProjFounder(ctx.grants, c));
  const [collabRes, headRes, memberRes, pmRes, founderRes] = await Promise.all([
    supabase.from("proj_task_collaborators").select("task_id").eq("user_id", ctx.userId),
    supabase.from("proj_teams").select("id, project_id").eq("head_user_id", ctx.userId).is("removed_at", null),
    supabase.from("proj_project_members").select("project_id, role, team_id, acting_until").eq("user_id", ctx.userId).is("removed_at", null),
    supabase.from("proj_projects").select("id").eq("pm_user_id", ctx.userId).not("status", "in", FINISHED),
    founderCompanies.length > 0 ? supabase.from("proj_projects").select("id").in("company_id", founderCompanies).not("status", "in", FINISHED) : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ]);
  ok(collabRes, headRes, memberRes, pmRes, founderRes);

  const memberBy = new Map((memberRes.data ?? []).map((m) => [m.project_id, m]));
  const headTeams = new Map<string, string[]>();
  for (const t of headRes.data ?? []) headTeams.set(t.project_id, [...(headTeams.get(t.project_id) ?? []), t.id]);
  const wholeProject = new Set<string>([
    ...(pmRes.data ?? []).map((p) => p.id),
    ...(founderRes.data ?? []).map((p) => p.id),
    ...(memberRes.data ?? []).filter((m) => m.role === "acting_pm" && !!m.acting_until && m.acting_until >= today).map((m) => m.project_id),
  ]);
  const leadIds = [...new Set([...wholeProject, ...headTeams.keys()])];
  const collabIds = (collabRes.data ?? []).map((c) => c.task_id);

  const [mineRes, collabTasksRes, reviewRes, teamRes] = await Promise.all([
    supabase.from("proj_tasks").select("*").eq("assignee_id", ctx.userId).in("status", OPEN),
    collabIds.length > 0 ? supabase.from("proj_tasks").select("*").in("id", collabIds).in("status", OPEN) : Promise.resolve({ data: [] as ProjTaskRow[], error: null }),
    supabase.from("proj_tasks").select("*").eq("status", "ready_for_review").neq("assignee_id", ctx.userId),
    leadIds.length > 0 ? supabase.from("proj_tasks").select("*").in("project_id", leadIds).in("status", OPEN).limit(1000) : Promise.resolve({ data: [] as ProjTaskRow[], error: null }),
  ]);
  ok(mineRes, collabTasksRes, reviewRes, teamRes);

  const mineById = new Map<string, ProjTaskRow>();
  for (const t of [...(mineRes.data ?? []), ...(collabTasksRes.data ?? [])]) mineById.set(t.id, t);
  const teamTasks = (teamRes.data ?? []).filter((t) => wholeProject.has(t.project_id) || (!!t.team_id && (headTeams.get(t.project_id) ?? []).includes(t.team_id)));
  const projectIds = [...new Set([...mineById.values(), ...(reviewRes.data ?? []), ...teamTasks].map((t) => t.project_id))];
  if (projectIds.length === 0) return { ...none, canSeeTeam: leadIds.length > 0 };

  const [projRes, teamsRes, delRes, msRes] = await Promise.all([
    supabase.from("proj_projects").select("id, reference, name, status, company_id, pm_user_id").in("id", projectIds),
    supabase.from("proj_teams").select("id, project_id, name").in("project_id", projectIds).is("removed_at", null),
    supabase.from("proj_deliverables").select("id, project_id, title, milestone_id").in("project_id", projectIds),
    supabase.from("proj_milestones").select("id, project_id, title").in("project_id", projectIds),
  ]);
  ok(projRes, teamsRes, delRes, msRes);
  const projectBy = new Map((projRes.data ?? []).map((p) => [p.id, p]));

  const standingOf = (pid: string): ProjectStanding | null => {
    const p = projectBy.get(pid);
    if (!p) return null;
    const m = memberBy.get(pid);
    return {
      companyId: p.company_id, grants: ctx.grants, isPm: p.pm_user_id === ctx.userId, isMember: !!m, isActingPm: m?.role === "acting_pm" && !!m.acting_until && m.acting_until >= today,
      headOfTeamIds: headTeams.get(pid) ?? [], isSalesLinked: false, status: p.status,
    };
  };
  // People are only needed where this person can reassign (manage the project or head a team in it).
  const leaderProjects = projectIds.filter((pid) => wholeProject.has(pid) || (headTeams.get(pid)?.length ?? 0) > 0);
  const peopleResults = await Promise.all(leaderProjects.map(async (pid) => [pid, await supabase.rpc("proj_project_people", { p_project_id: pid })] as const));
  const peopleBy = new Map<string, ProjProjectPersonRow[]>();
  for (const [pid, r] of peopleResults) {
    ok(r);
    peopleBy.set(pid, r.data ?? []);
  }

  const lookups = new Map<string, ProjectLookup>();
  for (const pid of projectIds) {
    const p = projectBy.get(pid);
    const standing = standingOf(pid);
    if (!p || !standing) continue;
    lookups.set(pid, {
      project: { id: p.id, reference: p.reference, name: p.name, status: p.status },
      standing,
      teams: (teamsRes.data ?? []).filter((t) => t.project_id === pid),
      deliverables: (delRes.data ?? []).filter((d) => d.project_id === pid),
      milestones: (msRes.data ?? []).filter((m) => m.project_id === pid),
      people: peopleBy.get(pid) ?? [],
    });
  }
  const rc = { userId: ctx.userId, today, nameOf: (id: string) => ctx.personName(id), formatDate: (d: string) => dateText(d) };
  const toRows = (tasks: readonly ProjTaskRow[]): TaskRowData[] =>
    tasks.flatMap((t) => {
      const look = lookups.get(t.project_id);
      return look ? [buildTaskRow(t, look, rc)] : [];
    });

  // A task waits on my review when it is ready, is not mine, and I lead the project or the task's team (the same rule as the review queue).
  const reviews = (reviewRes.data ?? []).filter((t) => {
    const p = projectBy.get(t.project_id);
    if (!p) return false;
    const rctx: ReviewContext = {
      userId: ctx.userId, isFounder: isProjFounder(ctx.grants, p.company_id), isPm: p.pm_user_id === ctx.userId,
      isActingPm: standingOf(t.project_id)?.isActingPm ?? false, headOfTeamIds: headTeams.get(t.project_id) ?? [],
    };
    return isWaitingOnMyReview(t, rctx);
  });
  return { today, mine: toRows([...mineById.values()]), reviews: toRows(reviews), team: toRows(teamTasks), canSeeTeam: leadIds.length > 0 };
});
