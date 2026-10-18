import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { BlockedBadge, PriorityBadge, TaskStatusBadge } from "@/components/projects/badges";
import { Muted, PageHeader, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { dateText } from "@/lib/projects/format";
import { describeNotification } from "@/lib/projects/notification-text";
import { loadMyWork, type WorkTask } from "@/lib/projects/my-work";
import { groupTasksByDue } from "@/lib/projects/work-logic";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/components/sales/format";
import { MarkAllRead } from "./mark-read-button";

export const metadata = { title: "My Work" };

function TaskRow({ t, showStatus = true }: { t: WorkTask; showStatus?: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
      <div className="min-w-0">
        <Link href={`/projects/${t.project_id}/work/tasks/${t.id}`} className="break-words text-sm font-medium underline-offset-2 hover:underline">{t.title}</Link>
        <p className="text-sm text-muted-foreground">{t.projectReference} · {t.projectName}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {t.blocked_at ? <BlockedBadge /> : null}
        <PriorityBadge priority={t.priority} />
        {showStatus ? <TaskStatusBadge status={t.status} /> : null}
        <span className="whitespace-nowrap text-muted-foreground">{t.due_date ? `Due ${dateText(t.due_date)}` : "No due date"}</span>
      </div>
    </li>
  );
}

function Group({ title, tasks, tone }: { title: string; tasks: WorkTask[]; tone?: "warn" }) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <h3 className={`text-[13px] font-semibold uppercase tracking-wide ${tone === "warn" ? "text-destructive" : "text-muted-foreground"}`}>{title} · {tasks.length}</h3>
      <ul className="divide-y divide-border">{tasks.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
    </div>
  );
}

export default async function MyWorkPage() {
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  if (ctx.grants.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="My Work" />
        <Alert role="status">My Work lists the tasks assigned to you in projects you are part of. Your access here is to your own Sales projects, which have no tasks for you. <Link href="/projects" className="underline underline-offset-2">Open Projects</Link>.</Alert>
      </div>
    );
  }
  const work = await loadMyWork(ctx);
  const groups = groupTasksByDue(work.open, work.today);
  const supabase = await createClient();
  const { data: notices } = await supabase.rpc("proj_my_notifications", { p_limit: 40 });
  const notifications = notices ?? [];
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-6">
      <PageHeader title="My Work" description="Tasks assigned to you, work waiting for your review, and the project notices addressed to you. Having several tasks on one day is normal and is never flagged." />

      <Panel title="My open tasks" description={work.open.length === 0 ? undefined : `${work.open.length} open, ordered by due date. Due dates are plain dates; "next 7 days" counts from today.`}>
        {work.open.length === 0 ? (
          <EmptyState dense icon={ClipboardCheck} title="No open tasks" description="Tasks assigned to you, or shared with you as a collaborator, appear here. You can also add your own task inside a project you are part of." />
        ) : (
          <div className="space-y-5">
            <Group title="Overdue" tasks={groups.overdue} tone="warn" />
            <Group title="Due in the next 7 days" tasks={groups.soon} />
            <Group title="Later" tasks={groups.later} />
            <Group title="No due date" tasks={groups.undated} />
          </div>
        )}
      </Panel>

      <Panel id="reviews" title="Waiting for my review" description="Tasks ready for review that you lead as Project Manager, temporary leader, founder or department head. You never review your own work.">
        {work.reviews.length === 0 ? <Muted>Nothing is waiting for your review.</Muted> : <ul className="divide-y divide-border">{work.reviews.map((t) => <TaskRow key={t.id} t={t} showStatus={false} />)}</ul>}
      </Panel>

      <Panel title="Project notices" description="Assignments, review requests, mentions and changes that need your attention. No message text is ever copied into a notice." actions={<MarkAllRead unread={unread} />}>
        {notifications.length === 0 ? (
          <Muted>No notices yet. You are told when you are added to a project, assigned a task, asked to review, mentioned, or when a deadline you depend on moves.</Muted>
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((n) => {
              const v = describeNotification(n.type, n.payload);
              return (
                <li key={n.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
                  <div className="min-w-0">
                    {v.href ? <Link href={v.href} className="break-words underline-offset-2 hover:underline">{v.text}</Link> : <span className="break-words">{v.text}</span>}
                    {!n.read_at ? <span className="ml-2 rounded-full bg-accent px-1.5 text-[13px] font-semibold text-accent-foreground">New</span> : null}
                  </div>
                  <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(n.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
