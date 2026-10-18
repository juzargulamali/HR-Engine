import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { allowedTaskMoves, isFinishedProject, isOpenTask, taskActorRole } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { BlockedBadge, PriorityBadge, TaskStatusBadge } from "@/components/projects/badges";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView, memberOptions } from "@/lib/projects/data";
import { dateText, formatDateTime, todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { describeTaskEvent, dueWords } from "../../helpers";
import { BlockButton, CommentForm, EditTaskButton, ReassignButton, StatusMoveButton, UnblockButton } from "./task-actions";

export const metadata = { title: "Task" };

export default async function TaskPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details") redirect(`/projects/${id}`);

  const supabase = await createClient();
  const { data: task } = await supabase.from("proj_tasks").select("*").eq("id", taskId).eq("project_id", id).maybeSingle();
  if (!task) notFound();

  const [{ data: allTasks }, { data: deliverables }, { data: milestones }, { data: collaborators }, { data: depRows }, { data: events }, { data: comments }] = await Promise.all([
    supabase.from("proj_tasks").select("id, title, status, due_date").eq("project_id", id),
    supabase.from("proj_deliverables").select("id, title, team_id, status").eq("project_id", id),
    supabase.from("proj_milestones").select("id, title, status").eq("project_id", id),
    supabase.from("proj_task_collaborators").select("user_id").eq("task_id", taskId),
    supabase.from("proj_task_dependencies").select("task_id, depends_on_task_id").eq("project_id", id),
    supabase.from("proj_task_events").select("*").eq("task_id", taskId).order("id", { ascending: false }),
    supabase.from("proj_task_comments").select("*").eq("task_id", taskId).order("created_at", { ascending: true }),
  ]);
  const tasksById = new Map((allTasks ?? []).map((t) => [t.id, t]));
  const dependsOn = (depRows ?? []).filter((d) => d.task_id === taskId).map((d) => d.depends_on_task_id);
  const blocks = (depRows ?? []).filter((d) => d.depends_on_task_id === taskId).map((d) => d.task_id);
  const collaboratorIds = (collaborators ?? []).map((c) => c.user_id);

  const readOnly = isFinishedProject(view.project.status);
  const role = readOnly ? null : taskActorRole(view.standing, ctx.userId, { assigneeId: task.assignee_id, teamId: task.team_id, requiresReview: task.requires_review, status: task.status, blocked: !!task.blocked_at });
  const leader = role === "manager" || role === "head";
  const open = isOpenTask(task.status);
  const moves = readOnly ? [] : allowedTaskMoves(role, ctx.userId, { assigneeId: task.assignee_id, teamId: task.team_id, requiresReview: task.requires_review, status: task.status, blocked: !!task.blocked_at });
  const members = memberOptions(view);
  const canUnblock = !readOnly && !!task.blocked_at && (role !== null || task.unblock_owner_id === ctx.userId);
  const team = view.teams.find((t) => t.id === task.team_id) ?? null;
  const deliverable = (deliverables ?? []).find((d) => d.id === task.deliverable_id) ?? null;
  const milestone = (milestones ?? []).find((m) => m.id === task.milestone_id) ?? null;
  const due = dueWords(task.due_date, open, todayIso(), (d) => dateText(d));
  const fmtDay = (d: string | null) => (d ? dateText(d) : "no date");
  // A head reassigns within their team; the PM / founder to anyone on the project.
  const reassignOptions = view.canManage ? members : members.filter((m) => view.people.find((p) => p.user_id === m.id)?.team_id === task.team_id || m.id === ctx.userId);
  const canEdit = role !== null && open;

  return (
    <div className="space-y-6">
      <Link href={`/projects/${id}/work#tasks`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to milestones &amp; tasks
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{task.title}</h2>
          <TaskStatusBadge status={task.status} />
          {task.blocked_at ? <BlockedBadge /> : null}
          <PriorityBadge priority={task.priority} />
          {task.requires_review ? <Badge variant="outline" className="text-muted-foreground">Needs review</Badge> : null}
        </div>
        {task.description ? <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm">{task.description}</p> : <Muted className="mt-2">No description.</Muted>}
      </div>

      {task.blocked_at ? (
        <Alert variant="destructive" role="status">
          <p className="font-medium">Blocked since {formatDateTime(task.blocked_at)}: {task.blocked_reason}</p>
          <p className="mt-1">To unblock: {[task.unblock_owner_id ? view.nameOf(task.unblock_owner_id) : null, task.unblock_action].filter(Boolean).join(" · ") || "not stated"}.</p>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Details">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label="Accountable (assigned to)">{view.nameOf(task.assignee_id)}</Fact>
              <Fact label="Collaborators">{collaboratorIds.length > 0 ? collaboratorIds.map((c) => view.nameOf(c)).join(", ") : "None"}</Fact>
              <Fact label="Department team">{team ? `${team.name} (head: ${view.nameOf(team.head_user_id)})` : "None"}</Fact>
              <Fact label="Deliverable">{deliverable ? deliverable.title : "None"}</Fact>
              <Fact label="Milestone">{milestone ? milestone.title : "None"}</Fact>
              <Fact label="Start date">{task.start_date ? dateText(task.start_date) : "Not set"}</Fact>
              <Fact label="Due date"><span className={due.overdue ? "font-medium text-destructive" : undefined}>{due.text}</span></Fact>
              <Fact label="Completion">{task.completed_at ? `${formatDateTime(task.completed_at)}${task.completed_by ? ` by ${view.nameOf(task.completed_by)}` : ""}` : "Not completed"}</Fact>
            </dl>
          </Panel>

          <Panel title="Dependencies" description="Dependencies are information, never automation: a changed date does not move anyone else's work.">
            <div className="grid gap-4 sm:grid-cols-2">
              <DependencyList projectId={id} heading="Depends on" ids={dependsOn} tasksById={tasksById} empty="Does not depend on another task." />
              <DependencyList projectId={id} heading="Other tasks waiting on this one" ids={blocks} tasksById={tasksById} empty="No task depends on this one." />
            </div>
          </Panel>

          <Panel title="History" description="Reassignments, date changes with their reasons, status changes and blockers. Nothing here can be edited.">
            {(events ?? []).length === 0 ? (
              <Muted>No history yet.</Muted>
            ) : (
              <ol className="space-y-3">
                {(events ?? []).map((e) => (
                  <li key={e.id} className="border-l-2 border-border pl-3">
                    <p className="text-sm">{describeTaskEvent(e, fmtDay)}</p>
                    <p className="text-[13px] text-muted-foreground">{formatDateTime(e.created_at)} · {e.actor_id ? view.nameOf(e.actor_id) : "System"}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title={`Comments (${(comments ?? []).length})`}>
            {(comments ?? []).length === 0 ? (
              <Muted className="mb-4">No comments yet.</Muted>
            ) : (
              <ul className="mb-4 space-y-3">
                {(comments ?? []).map((c) => (
                  <li key={c.id} className="rounded-md border border-border p-3">
                    <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">{view.nameOf(c.author_id)} · {formatDateTime(c.created_at)}{c.edited_at ? " · edited" : ""}</p>
                  </li>
                ))}
              </ul>
            )}
            {readOnly ? <Muted>This project is read-only.</Muted> : <CommentForm projectId={id} taskId={taskId} />}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Actions" description={role ? undefined : readOnly ? "This project is read-only." : "Only the assignee, the department head or the Project Manager can change this task. You can comment."}>
            {role === null ? (
              <Muted>{readOnly ? "A completed project cannot be changed. A founder can reopen it." : "You can read this task and add comments."}</Muted>
            ) : (
              <div className="space-y-4">
                {moves.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Move it on</h3>
                    <div className="flex flex-wrap items-start gap-2">
                      {moves.map((m) => <StatusMoveButton key={m.to + m.label} projectId={id} taskId={taskId} version={task.version} to={m.to} label={m.label} needsNote={m.needsNote} />)}
                    </div>
                    {task.requires_review && task.status === "ready_for_review" && task.assignee_id === ctx.userId ? (
                      <Muted className="mt-2">This task needs review. A department head or the Project Manager accepts it; you cannot complete your own reviewed work.</Muted>
                    ) : null}
                    {task.blocked_at && open && !task.requires_review ? <Muted className="mt-2">Clear the blocker before marking it done.</Muted> : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-start gap-2 border-t border-border pt-3">
                  {canEdit ? (
                    <EditTaskButton
                      projectId={id}
                      leader={leader}
                      task={{ id: task.id, version: task.version, title: task.title, description: task.description, priority: task.priority, start_date: task.start_date, due_date: task.due_date, requires_review: task.requires_review, team_id: task.team_id, deliverable_id: task.deliverable_id, milestone_id: task.milestone_id, dependsOn, collaborators: collaboratorIds }}
                      otherTasks={(allTasks ?? []).filter((t) => t.id !== taskId).map((t) => ({ id: t.id, name: t.title }))}
                      collaboratorOptions={members.filter((m) => m.id !== task.assignee_id)}
                      teams={view.teams.map((t) => ({ id: t.id, name: t.name }))}
                      deliverables={(deliverables ?? []).map((d) => ({ id: d.id, name: d.title }))}
                      milestones={(milestones ?? []).map((m) => ({ id: m.id, name: m.title }))}
                    />
                  ) : null}
                  {leader && open ? <ReassignButton projectId={id} taskId={taskId} currentAssignee={task.assignee_id} options={reassignOptions} /> : null}
                  {open && !task.blocked_at ? <BlockButton projectId={id} taskId={taskId} members={members} /> : null}
                  {canUnblock ? <UnblockButton projectId={id} taskId={taskId} /> : null}
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function DependencyList({ projectId, heading, ids, tasksById, empty }: {
  projectId: string; heading: string; ids: string[]; tasksById: Map<string, { id: string; title: string; status: string; due_date: string | null }>; empty: string;
}) {
  return (
    <div>
      <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</h3>
      {ids.length === 0 ? <Muted>{empty}</Muted> : (
        <ul className="space-y-1.5">
          {ids.map((tid) => {
            const t = tasksById.get(tid);
            if (!t) return null;
            return (
              <li key={tid} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/projects/${projectId}/work/tasks/${tid}`} className="underline-offset-4 hover:underline">{t.title}</Link>
                <TaskStatusBadge status={t.status} />
                {t.due_date ? <span className="text-muted-foreground">due {dateText(t.due_date)}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
