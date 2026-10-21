import "server-only";
import { isFinishedProject, isOpenTask, taskActorRole, type TaskActorRole } from "@enginious-hr/domain";
import { memberOptions, type ProjectView } from "@/lib/projects/data";
import { dateText, todayIso } from "@/lib/projects/format";
import type { ProjectsContext } from "@/lib/projects/context";
import { createClient } from "@/lib/supabase/server";
import type { ProjTaskCommentRow, ProjTaskEventRow, ProjTaskRow } from "@/types/projects";
import { buildTaskRow, type PickOption, type TaskRowData } from "./task-logic";

export interface TaskDetailData {
  task: ProjTaskRow;
  row: TaskRowData;
  readOnly: boolean;
  viewerId: string;
  role: TaskActorRole;
  /** Task-level role of the viewer (null: may read and comment only). */
  leader: boolean;
  canEdit: boolean;
  canUnblock: boolean;
  members: PickOption[];
  reassignOptions: PickOption[];
  collaboratorIds: string[];
  dependsOn: string[];
  blocks: string[];
  tasksById: Map<string, { id: string; title: string; status: string; due_date: string | null }>;
  otherTasks: PickOption[];
  teams: PickOption[];
  deliverables: PickOption[];
  milestones: PickOption[];
  events: ProjTaskEventRow[];
  comments: ProjTaskCommentRow[];
  team: { name: string; head: string } | null;
  deliverable: string | null;
  milestone: string | null;
}

/**
 * Everything the task details need, read through the person's own session (RLS decides). Used by both the side panel and the full page,
 * so the two can never differ. Returns null when the task is not in this project or not visible.
 */
export async function loadTaskDetail(view: ProjectView, ctx: ProjectsContext, taskId: string): Promise<TaskDetailData | null> {
  const supabase = await createClient();
  const id = view.project.id;
  const { data: task } = await supabase.from("proj_tasks").select("*").eq("id", taskId).eq("project_id", id).maybeSingle();
  if (!task) return null;
  const [{ data: allTasks }, { data: deliverables }, { data: milestones }, { data: collaborators }, { data: depRows }, { data: events }, { data: comments }] = await Promise.all([
    supabase.from("proj_tasks").select("id, title, status, due_date").eq("project_id", id),
    supabase.from("proj_deliverables").select("id, title, team_id, status, milestone_id").eq("project_id", id),
    supabase.from("proj_milestones").select("id, title, status").eq("project_id", id),
    supabase.from("proj_task_collaborators").select("user_id").eq("task_id", taskId),
    supabase.from("proj_task_dependencies").select("task_id, depends_on_task_id").eq("project_id", id),
    supabase.from("proj_task_events").select("*").eq("task_id", taskId).order("id", { ascending: false }),
    supabase.from("proj_task_comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
  ]);
  const readOnly = isFinishedProject(view.project.status);
  const role = readOnly ? null : taskActorRole(view.standing, ctx.userId, { assigneeId: task.assignee_id, teamId: task.team_id, requiresReview: task.requires_review, status: task.status, blocked: !!task.blocked_at });
  const members = memberOptions(view);
  const row = buildTaskRow(
    task,
    {
      project: { id, reference: view.project.reference, name: view.project.name, status: view.project.status },
      standing: view.standing,
      teams: view.teams,
      deliverables: (deliverables ?? []).map((d) => ({ id: d.id, title: d.title, milestone_id: d.milestone_id })),
      milestones: (milestones ?? []).map((m) => ({ id: m.id, title: m.title })),
      people: view.people,
    },
    { userId: ctx.userId, today: todayIso(), nameOf: view.nameOf, formatDate: (d) => dateText(d) },
  );
  const team = view.teams.find((t) => t.id === task.team_id) ?? null;
  return {
    task, row, readOnly, viewerId: ctx.userId, role,
    leader: role === "manager" || role === "head",
    canEdit: role !== null && isOpenTask(task.status),
    canUnblock: !readOnly && !!task.blocked_at && (role !== null || task.unblock_owner_id === ctx.userId),
    members,
    // A head reassigns within their team; the PM / founder to anyone on the project (the same rule as before, now in task-logic).
    reassignOptions: row.reassignOptions,
    collaboratorIds: (collaborators ?? []).map((c) => c.user_id),
    dependsOn: (depRows ?? []).filter((d) => d.task_id === taskId).map((d) => d.depends_on_task_id),
    blocks: (depRows ?? []).filter((d) => d.depends_on_task_id === taskId).map((d) => d.task_id),
    tasksById: new Map((allTasks ?? []).map((t) => [t.id, t])),
    otherTasks: (allTasks ?? []).filter((t) => t.id !== taskId).map((t) => ({ id: t.id, name: t.title })),
    teams: view.teams.map((t) => ({ id: t.id, name: t.name })),
    deliverables: (deliverables ?? []).map((d) => ({ id: d.id, name: d.title })),
    milestones: (milestones ?? []).map((m) => ({ id: m.id, name: m.title })),
    events: events ?? [],
    comments: comments ?? [],
    team: team ? { name: team.name, head: view.nameOf(team.head_user_id) } : null,
    deliverable: (deliverables ?? []).find((d) => d.id === task.deliverable_id)?.title ?? null,
    milestone: (milestones ?? []).find((m) => m.id === task.milestone_id)?.title ?? null,
  };
}
