import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { OsPill } from "@/components/os/pills";
import { BlockedBadge, PriorityBadge, TaskStatusBadge } from "@/components/projects/badges";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { PanelLink } from "@/components/workspace/panel-link";
import { dateText, formatDateTime } from "@/lib/projects/format";
import type { ProjectView } from "@/lib/projects/data";
import { describeTaskEvent } from "@/app/(app)/projects/[id]/work/helpers";
import { TaskActionsMenu } from "./task-actions-menu";
import { TaskAssigneeControl, TaskDueControl, TaskStatusControl } from "./task-controls";
import { CommentForm } from "./task-forms";
import type { TaskDetailData } from "./task-detail-data";
import { toControlRow } from "./task-table";

/**
 * One task, shown the same way in the side panel and on its own page: the status, who and when at a glance (each editable only by
 * the people who may), the rarer actions under "More", then details, dependencies, history and comments. `taskHref` says how a
 * related task is opened (in the panel, or as its own page).
 */
export function TaskDetailBody({ data, view, taskHref }: { data: TaskDetailData; view: ProjectView; taskHref: (taskId: string) => string }) {
  const { task, row } = data;
  const fmtDay = (d: string | null) => (d ? dateText(d) : "no date");
  const control = toControlRow(row);
  const asLink = (id: string, children: React.ReactNode) =>
    taskHref(id).includes("?") ? <PanelLink href={taskHref(id)} className="underline-offset-4 hover:underline">{children}</PanelLink> : <Link href={taskHref(id)} className="underline-offset-4 hover:underline">{children}</Link>;
  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusBadge status={task.status} />
          {task.blocked_at ? <BlockedBadge /> : null}
          <PriorityBadge priority={task.priority} />
          {task.requires_review ? <OsPill tone="blue">Needs review</OsPill> : null}
        </div>
        {task.description ? <p className="mt-2 whitespace-pre-wrap text-sm">{task.description}</p> : <Muted className="mt-2">No description.</Muted>}
      </div>

      {task.blocked_at ? (
        <Alert variant="destructive" role="status">
          <p className="font-medium">Blocked since {formatDateTime(task.blocked_at)}: {task.blocked_reason}</p>
          <p className="mt-1">To unblock: {[task.unblock_owner_id ? view.nameOf(task.unblock_owner_id) : null, task.unblock_action].filter(Boolean).join(" · ") || "not stated"}.</p>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3">
        <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="min-w-0"><dt className="mb-1 text-sm text-muted-foreground">Status</dt><dd><TaskStatusControl row={control} /></dd></div>
          <div className="min-w-0"><dt className="mb-1 text-sm text-muted-foreground">Assignee</dt><dd className="text-sm"><TaskAssigneeControl row={control} /></dd></div>
          <div className="min-w-0"><dt className="mb-1 text-sm text-muted-foreground">Due</dt><dd className="text-sm"><TaskDueControl row={control} /></dd></div>
        </dl>
        <TaskActionsMenu
          projectId={view.project.id}
          task={{
            id: task.id, version: task.version, title: task.title, description: task.description, priority: task.priority, start_date: task.start_date, due_date: task.due_date,
            requires_review: task.requires_review, team_id: task.team_id, deliverable_id: task.deliverable_id, milestone_id: task.milestone_id, dependsOn: data.dependsOn,
            collaborators: data.collaboratorIds, assignee_id: task.assignee_id,
          }}
          leader={data.leader}
          canEdit={data.canEdit}
          canReassign={row.canReassign}
          canBlock={data.role !== null && row.open && !task.blocked_at}
          canUnblock={data.canUnblock}
          members={data.members}
          reassignOptions={data.reassignOptions}
          otherTasks={data.otherTasks}
          teams={data.teams}
          deliverables={data.deliverables}
          milestones={data.milestones}
        />
      </div>
      {data.role === null ? (
        <Muted>{data.readOnly ? "This project is completed, so its tasks are read-only. A founder can reopen it." : "Only the assignee, the department head or the Project Manager can change this task. You can comment."}</Muted>
      ) : task.requires_review && task.status === "ready_for_review" && task.assignee_id === data.viewerId ? (
        <Muted>This task needs review. A department head or the Project Manager accepts it; you cannot complete your own reviewed work.</Muted>
      ) : task.blocked_at && row.open && !task.requires_review ? (
        <Muted>Clear the blocker before marking it done.</Muted>
      ) : null}

      <Panel title="Details">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="Collaborators">{data.collaboratorIds.length > 0 ? data.collaboratorIds.map((c) => view.nameOf(c)).join(", ") : "None"}</Fact>
          <Fact label="Department team">{data.team ? `${data.team.name} (head: ${data.team.head})` : "None"}</Fact>
          <Fact label="Deliverable">{data.deliverable ?? "None"}</Fact>
          <Fact label="Milestone">{data.milestone ?? "None"}</Fact>
          <Fact label="Start date">{task.start_date ? dateText(task.start_date) : "Not set"}</Fact>
          <Fact label="Completion">{task.completed_at ? `${formatDateTime(task.completed_at)}${task.completed_by ? ` by ${view.nameOf(task.completed_by)}` : ""}` : "Not completed"}</Fact>
        </dl>
        <p className="mt-3 text-sm"><Link href={`/projects/${view.project.id}/documents`} className="underline underline-offset-4">Project files and client documents</Link></p>
      </Panel>

      <Panel title="Dependencies" description="Information, never automation: a changed date does not move anyone else's work.">
        <div className="grid gap-4 sm:grid-cols-2">
          <DependencyList heading="Depends on" ids={data.dependsOn} tasksById={data.tasksById} empty="Does not depend on another task." link={asLink} />
          <DependencyList heading="Waiting on this one" ids={data.blocks} tasksById={data.tasksById} empty="No task depends on this one." link={asLink} />
        </div>
      </Panel>

      <Panel title={`Comments (${data.comments.length})`}>
        {data.comments.length === 0 ? (
          <Muted className="mb-4">No comments yet.</Muted>
        ) : (
          <ul className="mb-4 space-y-3">
            {data.comments.map((c) => (
              <li key={c.id} className="rounded-md border border-border p-3">
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{view.nameOf(c.author_id)} · {formatDateTime(c.created_at)}{c.edited_at ? " · edited" : ""}</p>
              </li>
            ))}
          </ul>
        )}
        {data.readOnly ? <Muted>This project is read-only.</Muted> : <CommentForm projectId={view.project.id} taskId={task.id} />}
      </Panel>

      <Panel title="History" description="Reassignments, date changes with their reasons, status changes and blockers. Nothing here can be edited.">
        {data.events.length === 0 ? (
          <Muted>No history yet.</Muted>
        ) : (
          <ol className="space-y-3">
            {data.events.map((e) => (
              <li key={e.id} className="border-l-2 border-border pl-3">
                <p className="text-sm">{describeTaskEvent(e, fmtDay)}</p>
                <p className="text-[13px] text-muted-foreground">{formatDateTime(e.created_at)} · {e.actor_id ? view.nameOf(e.actor_id) : "System"}</p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

function DependencyList({ heading, ids, tasksById, empty, link }: {
  heading: string; ids: string[]; tasksById: TaskDetailData["tasksById"]; empty: string; link: (id: string, children: React.ReactNode) => React.ReactNode;
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
                {link(tid, t.title)}
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
