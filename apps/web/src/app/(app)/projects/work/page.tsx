import Link from "next/link";
import { AlertTriangle, ClipboardCheck, ListChecks, ShieldAlert, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OsHero } from "@/components/os/hero";
import { OsStatCard } from "@/components/os/stat-card";
import { MyProjects, type MyProjectItem } from "@/components/projects/my-projects";
import { Muted, PageHeader, Panel } from "@/components/projects/parts";
import { TaskBoard } from "@/components/projects/tasks/task-board";
import { TaskPanel } from "@/components/projects/tasks/task-panel";
import { TaskTable } from "@/components/projects/tasks/task-table";
import { DEFAULT_TASK_COLUMNS, parseTaskSort, sortTaskRows, TASK_COLUMNS, TASK_COLUMN_IDS } from "@/components/projects/tasks/task-logic";
import { ColumnsMenu } from "@/components/workspace/columns-menu";
import { ListToolbar } from "@/components/workspace/list-toolbar";
import { LoadError } from "@/components/workspace/states";
import { firstParam, paramsToRecord, parseColumns, parseRecordId, parseView, withParams } from "@/components/workspace/url-state";
import { ViewSwitch } from "@/components/workspace/view-switch";
import { getProjectsContext } from "@/lib/projects/context";
import { loadDirectoryResult } from "@/lib/projects/data";
import { canSeeProjectDetails, milestoneProjectIds, nextMilestones } from "@/lib/projects/directory";
import { describeNotification } from "@/lib/projects/notification-text";
import { loadProjectsAttention, loadWorkRows, type WorkRows } from "@/lib/projects/my-work";
import { MY_WORK_LABELS, MY_WORK_SHOWS, narrowMyWork, parseMyWorkShow, selectMyWorkRows, type MyWorkShow } from "@/lib/projects/work-logic";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/components/sales/format";
import { MarkAllRead } from "./mark-read-button";

export const metadata = { title: "My Work" };

type SearchParams = Record<string, string | string[] | undefined>;
const BASE = "/projects/work";

const EMPTY: Record<MyWorkShow, { title: string; description: string }> = {
  mine: { title: "No open tasks", description: "Tasks assigned to you, or shared with you as a collaborator, appear here. You can add your own task inside a project you are part of." },
  team: { title: "No open tasks in your team", description: "Open tasks of the projects you manage and the departments you head appear here." },
  overdue: { title: "Nothing is overdue", description: "Open tasks of yours whose due date has passed appear here." },
  review: { title: "Nothing is waiting for your review", description: "Tasks sent for review that you lead as Project Manager, temporary leader, founder or department head appear here. You never review your own work." },
};

/**
 * One place for tasks. A table by default (Board is the other view of the same tasks), filtered to My tasks, My team (only for people who
 * lead something), Overdue or Waiting for review. A task opens in a panel beside the list without losing the list; status, due date and
 * assignee are edited in place only where the person may. Handovers waiting for them are in the same place, and project notices stay below.
 */
export default async function MyWorkPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
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

  let work: WorkRows;
  try {
    work = await loadWorkRows(ctx);
  } catch (e) {
    console.error("[projects] my work load failed", e);
    return (
      <div className="space-y-4">
        <PageHeader title="My Work" />
        <LoadError what="your tasks" retryHref={BASE} />
      </div>
    );
  }
  const attention = await loadProjectsAttention(ctx);

  const current = paramsToRecord(sp);
  const show = parseMyWorkShow(firstParam(sp, "show"), work.canSeeTeam);
  const mode = parseView(firstParam(sp, "view"));
  const sort = parseTaskSort(firstParam(sp, "sort"));
  const columns = parseColumns(firstParam(sp, "cols"), TASK_COLUMN_IDS, DEFAULT_TASK_COLUMNS);
  const q = firstParam(sp, "q").trim().slice(0, 100);
  const base = selectMyWorkRows({ mine: work.mine, team: work.team, reviews: work.reviews }, show, work.today);
  const projects = [...new Map(base.map((r) => [r.projectId, `${r.projectName}`])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const projectId = projects.some(([id]) => id === firstParam(sp, "project")) ? firstParam(sp, "project") : "";
  const rows = sortTaskRows(narrowMyWork(base, q, projectId), sort);
  const showProject = true; // My Work is the one place that spans projects: the project is always shown
  const filtered = q !== "" || projectId !== "";
  const taskParam = parseRecordId(firstParam(sp, "task"));

  const supabase = await createClient();
  const { data: notices, error: noticeError } = await supabase.rpc("proj_my_notifications", { p_limit: 40 });
  const notifications = notices ?? [];
  const unread = notifications.filter((n) => !n.read_at).length;

  // The projects this person is a member of, with the next milestone (members only) and unread discussion, for one-click access.
  const myProjects: MyProjectItem[] = await (async () => {
    const { rows: directory } = await loadDirectoryResult();
    const mine = directory.filter((d) => d.is_member && d.status !== "completed" && d.status !== "archived");
    if (mine.length === 0) return [];
    const ids = milestoneProjectIds(mine, ctx.grants);
    const [{ data: ms }, { data: unreadRows }] = await Promise.all([
      ids.length > 0 ? supabase.from("proj_milestones").select("project_id, title, due_date, status").in("project_id", ids).in("status", ["planned", "in_progress", "ready_for_acceptance"]).not("due_date", "is", null) : Promise.resolve({ data: [] as { project_id: string; title: string; due_date: string | null; status: string }[] }),
      supabase.rpc("proj_unread_counts"),
    ]);
    const next = nextMilestones(ms ?? []);
    const unreadBy = new Map((unreadRows ?? []).map((r) => [r.project_id, r.unread]));
    return mine.map((p) => ({ id: p.id, name: p.name, reference: p.reference, nextMilestone: canSeeProjectDetails(p, ctx.grants) ? (next.get(p.id) ?? null) : null, unread: unreadBy.get(p.id) ?? 0 }));
  })();

  const counts: Record<MyWorkShow, number> = {
    mine: work.mine.length,
    team: work.team.length,
    overdue: selectMyWorkRows({ mine: work.mine, team: [], reviews: [] }, "overdue", work.today).length,
    review: work.reviews.length,
  };
  const showOptions = MY_WORK_SHOWS.filter((s) => s !== "team" || work.canSeeTeam).map((s) => ({ value: s === "mine" ? "" : s, label: `${MY_WORK_LABELS[s]} (${counts[s]})` }));

  return (
    <div className="space-y-5">
      <OsHero title="My Work" eyebrow="Projects" sub="Tasks assigned to you and work waiting for your review. Having several tasks on one day is normal and is never flagged." />

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Your work at a glance">
        <li><OsStatCard href={withParams(BASE, current, { show: null })} label="My open tasks" value={counts.mine} icon={ListChecks} edge="cyan" active={show === "mine"} /></li>
        <li><OsStatCard href={withParams(BASE, current, { show: "overdue" })} label="Overdue" value={counts.overdue} icon={AlertTriangle} edge="amber" active={show === "overdue"} /></li>
        <li><OsStatCard href={withParams(BASE, current, { show: "review" })} label="Waiting for my review" value={counts.review} icon={ShieldAlert} edge="blue" active={show === "review"} /></li>
        {work.canSeeTeam ? <li><OsStatCard href={withParams(BASE, current, { show: "team" })} label="My team's open tasks" value={counts.team} icon={Users} edge="muted" active={show === "team"} /></li> : null}
      </ul>

      {attention.handoversWaiting > 0 ? (
        <Alert role="status" className="flex flex-wrap items-center justify-between gap-2">
          <span><strong>{attention.handoversWaiting} handover{attention.handoversWaiting === 1 ? "" : "s"} waiting on you.</strong> A Sales handover needs a Project Manager or your acceptance.</span>
          <Link href="/projects/handovers" className={buttonVariants({ variant: "outline", size: "sm" })}>Open handovers</Link>
        </Alert>
      ) : null}

      <MyProjects items={myProjects} />

      <div className="space-y-3">
        <ListToolbar
          search={{ value: q, placeholder: "Search tasks or projects" }}
          filters={[
            { name: "show", label: "Show", value: show === "mine" ? "" : show, options: showOptions },
            ...(projects.length > 1 ? [{ name: "project", label: "Project", value: projectId, options: [{ value: "", label: "All projects" }, ...projects.map(([id, name]) => ({ value: id, label: name }))] }] : []),
          ]}
          clearHref={filtered ? withParams(BASE, current, {}, ["q", "project"]) : undefined}
        >
          {mode === "table" ? <ColumnsMenu columns={TASK_COLUMNS.map((c) => ({ id: c.id, label: c.label }))} selected={columns} defaults={DEFAULT_TASK_COLUMNS} /> : null}
          <ViewSwitch current={mode} tableHref={withParams(BASE, current, { view: null })} boardHref={withParams(BASE, current, { view: "board" })} />
        </ListToolbar>

        {rows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={filtered ? "No task matches" : EMPTY[show].title}
            description={filtered ? "Clear the search or the project filter." : EMPTY[show].description}
            action={filtered ? <Link href={withParams(BASE, current, {}, ["q", "project"])} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear</Link> : <Link href="/projects" className={buttonVariants({ variant: "outline", size: "sm" })}>Open Projects</Link>}
          />
        ) : mode === "board" ? (
          <TaskBoard rows={rows} basePath={BASE} current={current} showProject={showProject} />
        ) : (
          <TaskTable rows={rows} columns={columns} sort={sort} basePath={BASE} current={current} showProject={showProject} caption={MY_WORK_LABELS[show]} />
        )}
        {work.team.length >= 1000 && show === "team" ? <Muted>Showing the first 1,000 open tasks of your teams. Narrow the list with the search or the project filter.</Muted> : null}
      </div>

      <Panel title="Project notices" description="Assignments, review requests, mentions and changes that need your attention. No message text is ever copied into a notice." actions={<MarkAllRead unread={unread} />}>
        {noticeError ? (
          <LoadError what="your notices" retryHref={BASE} />
        ) : notifications.length === 0 ? (
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

      {taskParam ? <TaskPanel rawTaskId={taskParam} basePath={BASE} current={current} /> : null}
    </div>
  );
}
