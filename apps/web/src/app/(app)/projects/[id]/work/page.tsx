import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarCheck, ListChecks } from "lucide-react";
import { isFinishedProject, isOpenTask, milestoneProgress, TASK_STATUS_LABELS, TASK_STATUSES } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DeliverableStatusBadge, MilestoneStatusBadge } from "@/components/projects/badges";
import { Muted, Panel } from "@/components/projects/parts";
import { QuickAddTask } from "@/components/projects/tasks/quick-add-task";
import { TaskBoard } from "@/components/projects/tasks/task-board";
import { TaskPanel } from "@/components/projects/tasks/task-panel";
import { TaskTable } from "@/components/projects/tasks/task-table";
import {
  buildTaskRow, DEFAULT_TASK_COLUMNS, GROUP_LABELS, groupTaskRows, parseGroupBy, parseTaskSort, sortTaskRows, TASK_COLUMNS, TASK_COLUMN_IDS,
  type TaskGroup, type TaskRowData,
} from "@/components/projects/tasks/task-logic";
import { ColumnsMenu } from "@/components/workspace/columns-menu";
import { ListToolbar } from "@/components/workspace/list-toolbar";
import { LoadError } from "@/components/workspace/states";
import { PanelLink } from "@/components/workspace/panel-link";
import { firstParam, paramsToRecord, parseColumns, parseView, withParams } from "@/components/workspace/url-state";
import { ViewSwitch } from "@/components/workspace/view-switch";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView, memberOptions } from "@/lib/projects/data";
import { dateText, formatDateTime, todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { AddDeliverableButton, DeliverableStatusButton, EditDeliverableButton } from "./deliverable-forms";
import {
  deliverableMoves, dueWords, filterTasks, groupDeliverables, hasActiveFilters, milestoneMoves, newTaskOptions, parseTaskFilters, quickAssigneeChoices, reviewQueue, showChoiceOf,
  sortTasks, taskCountsByDeliverable,
} from "./helpers";
import { AddMilestoneButton, EditMilestoneButton, MilestoneStatusButton } from "./milestone-forms";
import { PlanAddMenu } from "./plan-add-menu";

export const metadata = { title: "Work" };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The Work section of one project: ONE task list (Table by default, Board as the other view of the same tasks), with optional grouping
 * by department, milestone, status or assignee. A task opens in a panel beside the list (?task=ID); the main button adds a task with
 * three fields. Milestones and deliverables stay fully manageable, one section below, and the review queue stays at the top for
 * reviewers.
 */
export default async function WorkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details") redirect(`/projects/${id}`);

  const filters = parseTaskFilters(sp);
  const current = paramsToRecord(sp);
  const basePath = `/projects/${id}/work`;
  const mode = parseView(firstParam(sp, "view"));
  const group = parseGroupBy(firstParam(sp, "group"));
  const sort = parseTaskSort(firstParam(sp, "sort"));
  const columns = parseColumns(firstParam(sp, "cols"), TASK_COLUMN_IDS, DEFAULT_TASK_COLUMNS);
  const today = todayIso();

  const supabase = await createClient();
  const [msRes, dlRes, taskRes, progressRes] = await Promise.all([
    supabase.from("proj_milestones").select("*").eq("project_id", id).order("sort_order").order("due_date", { nullsFirst: false }),
    supabase.from("proj_deliverables").select("*").eq("project_id", id).order("due_date", { nullsFirst: false }),
    supabase.from("proj_tasks").select("*").eq("project_id", id),
    supabase.rpc("proj_milestone_progress", { p_project_id: id }),
  ]);
  if (msRes.error || dlRes.error || taskRes.error) {
    return <LoadError what="this project's work" retryHref={withParams(basePath, current)} />;
  }
  const ms = msRes.data ?? [];
  const dls = dlRes.data ?? [];
  const allTasks = taskRes.data ?? [];
  const progressRows = progressRes.data;
  const progress = progressRows?.[0] ? milestoneProgress(progressRows[0].accepted_required, progressRows[0].total_required) : null;
  const readOnly = isFinishedProject(view.project.status);
  const canManage = view.canManage && !readOnly;
  const teamOptions = view.teams.map((t) => ({ id: t.id, name: t.name }));
  const milestoneOptions = ms.filter((m) => m.status !== "cancelled").map((m) => ({ id: m.id, name: m.title }));
  const members = memberOptions(view);
  const counts = taskCountsByDeliverable(allTasks);
  const fmt = (d: string) => dateText(d);

  const lookup = {
    project: { id, reference: view.project.reference, name: view.project.name, status: view.project.status },
    standing: view.standing,
    teams: view.teams,
    deliverables: dls.map((d) => ({ id: d.id, title: d.title, milestone_id: d.milestone_id })),
    milestones: ms.map((m) => ({ id: m.id, title: m.title })),
    people: view.people,
  };
  const rc = { userId: ctx.userId, today, nameOf: view.nameOf, formatDate: fmt };
  const visible = filterTasks(allTasks, filters, ctx.userId, today);
  const rows = sortTaskRows(visible.map((t) => buildTaskRow(t, lookup, rc)), sort);
  const queue = readOnly ? [] : reviewQueue(allTasks, view.standing, ctx.userId);
  const options = newTaskOptions({ standing: view.standing, userId: ctx.userId, myTeamId: view.myTeamId, people: view.people, teams: view.teams, deliverables: dls, manager: view.canManage });
  const choices = quickAssigneeChoices(options, view.canManage);
  const canCreateTask = !readOnly && choices.length > 0;
  const openTaskCount = allTasks.filter((t) => isOpenTask(t.status)).length;
  const groups = groupTaskRows(rows, mode === "table" ? group : "none", { milestones: ms.map((m) => m.id) });
  const clearHref = withParams(basePath, current, {}, ["q", "status", "assignee", "team", "deliverable", "show", "mine", "overdue", "blocked"]);
  const filtered = hasActiveFilters(filters);

  const toolbarFilters = [
    { name: "status", label: "Show", value: filters.status === "open" ? "" : filters.status, options: [{ value: "", label: "Open tasks" }, { value: "all", label: "All tasks" }, ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))] },
    { name: "assignee", label: "Assignee", value: filters.assignee ?? "", options: [{ value: "", label: "Anyone" }, ...members.map((m) => ({ value: m.id, label: m.name }))] },
    ...(view.teams.length > 0 ? [{ name: "team", label: "Department", value: filters.team ?? "", options: [{ value: "", label: "Any department" }, ...teamOptions.map((t) => ({ value: t.id, label: t.name }))] }] : []),
    ...(dls.length > 0 ? [{ name: "deliverable", label: "Deliverable", value: filters.deliverable ?? "", options: [{ value: "", label: "Any deliverable" }, ...dls.map((d) => ({ value: d.id, label: d.title }))] }] : []),
    { name: "show", label: "Narrow to", value: showChoiceOf(filters), options: [{ value: "", label: "Everything" }, { value: "mine", label: "My tasks" }, { value: "overdue", label: "Overdue" }, { value: "blocked", label: "Blocked" }] },
    ...(mode === "table" ? [{ name: "group", label: "Group by", value: group === "none" ? "" : group, options: (["none", "team", "milestone", "status", "assignee"] as const).map((g) => ({ value: g === "none" ? "" : g, label: GROUP_LABELS[g] })) }] : []),
  ];

  const openMilestones = current.ms === "1" || ms.length === 0;

  return (
    <div className="space-y-5">
      {readOnly ? <Muted>This project is {view.project.status}. Its plan is read-only; a founder can reopen it from History.</Muted> : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {rows.length} shown of {allTasks.length} task{allTasks.length === 1 ? "" : "s"} · {openTaskCount} open. Dates are never moved automatically: changing one records history and lists the work it touches.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {mode === "table" ? <ColumnsMenu columns={TASK_COLUMNS.map((c) => ({ id: c.id, label: c.label }))} selected={columns} defaults={DEFAULT_TASK_COLUMNS} /> : null}
            <ViewSwitch current={mode} tableHref={withParams(basePath, current, { view: null })} boardHref={withParams(basePath, current, { view: "board" })} />
            {canManage ? <PlanAddMenu projectId={id} teams={teamOptions} milestones={milestoneOptions} /> : null}
            {canCreateTask ? (
              <QuickAddTask projectId={id} options={options} choices={choices} milestones={milestoneOptions} tasks={sortTasks(allTasks.filter((t) => isOpenTask(t.status))).map((t) => ({ id: t.id, name: t.title }))} collaborators={members} defaultAssignee={ctx.userId} />
            ) : null}
          </div>
        </div>
        <ListToolbar search={{ value: filters.q, placeholder: "Search tasks" }} filters={toolbarFilters} clearHref={filtered ? clearHref : undefined} />
      </div>

      {queue.length > 0 ? (
        <Panel title={`Waiting for your review (${queue.length})`} description="Tasks sent for review that you may accept or send back. You never review your own work.">
          <ul className="divide-y divide-border">
            {queue.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <PanelLink href={withParams(basePath, current, { task: t.id })} className="font-medium underline-offset-4 hover:underline">{t.title}</PanelLink>
                  <p className="text-sm text-muted-foreground">Done by {view.nameOf(t.assignee_id)} · {dueWords(t.due_date, true, today, fmt).text}</p>
                </div>
                <PanelLink href={withParams(basePath, current, { task: t.id })} className={buttonVariants({ variant: "outline", size: "sm" })}>Review</PanelLink>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ---- The task list ---- */}
      {rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={allTasks.length === 0 ? "No tasks yet" : "No tasks match"}
          description={allTasks.length === 0 ? (canCreateTask ? "Use Add task above. Department heads distribute deliverables into tasks; any member can add a task for themself." : "Department heads distribute deliverables into tasks; any member can add a task for themself.") : "Clear the filters, or choose All tasks to include finished ones."}
          action={filtered ? <Link href={clearHref} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link> : undefined}
        />
      ) : mode === "board" ? (
        <TaskBoard rows={rows} basePath={basePath} current={current} showProject={false} />
      ) : group === "none" ? (
        <TaskTable rows={rows} columns={columns} sort={sort} basePath={basePath} current={current} showProject={false} caption="Tasks of this project" />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <GroupBlock
              key={g.key}
              group={g}
              by={group}
              milestone={group === "milestone" && !g.none ? ms.find((m) => m.id === g.key) : undefined}
              deliverables={group === "milestone" ? dls.filter((d) => (g.none ? !d.milestone_id || !ms.some((m) => m.id === d.milestone_id) : d.milestone_id === g.key)) : []}
              counts={counts}
              teams={view.teams}
            >
              <TaskTable rows={g.rows} columns={columns} sort={sort} basePath={basePath} current={current} showProject={false} caption={`Tasks: ${g.label}`} />
            </GroupBlock>
          ))}
        </div>
      )}

      {/* ---- Milestones and deliverables ---- */}
      <details id="milestones" open={openMilestones} className="group rounded-lg border border-border bg-card">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="text-sm font-semibold">Milestones &amp; deliverables <span className="font-normal text-muted-foreground">({ms.length} milestone{ms.length === 1 ? "" : "s"}, {dls.length} deliverable{dls.length === 1 ? "" : "s"})</span></span>
          <span className="text-sm text-muted-foreground">{progress ? progress.basis : "No required milestone set yet"}</span>
        </summary>
        <div className="space-y-5 border-t border-border p-4">
          <Panel
            id="milestone-list"
            title="Milestones"
            description={progress ? `Progress: ${progress.basis}. Optional milestones and cancelled or deferred ones are not counted.` : "Progress is shown only from accepted required milestones. No required milestone is set yet."}
            actions={canManage ? <AddMilestoneButton projectId={id} /> : undefined}
          >
            {progress ? (
              <div className="mb-4">
                <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label={progress.basis}>
                  <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{progress.basis}</p>
              </div>
            ) : null}
            {ms.length === 0 ? (
              <EmptyState icon={CalendarCheck} dense title="No milestones yet" description={view.canManage ? "Add the points the Project Manager accepts as the project moves: first draft, final render, installation done." : "The Project Manager adds the milestones the project is accepted against."} />
            ) : (
              <ul className="divide-y divide-border">
                {ms.map((m) => {
                  const due = dueWords(m.due_date, !["accepted", "cancelled", "deferred"].includes(m.status), today, fmt);
                  const editable = canManage && m.status !== "accepted" && m.status !== "cancelled";
                  return (
                    <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{m.title}</span>
                          <MilestoneStatusBadge status={m.status} />
                          <Badge variant="outline" className="text-muted-foreground">{m.is_required ? "Required" : "Optional"}</Badge>
                          {m.client_facing ? <Badge variant="outline" className="text-muted-foreground">Can appear on client timeline</Badge> : null}
                        </div>
                        {m.description ? <p className="text-sm text-muted-foreground">{m.description}</p> : null}
                        <p className={due.overdue ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>
                          {due.text}
                          {m.accepted_at ? ` · accepted ${formatDateTime(m.accepted_at)}${m.accepted_by ? ` by ${view.nameOf(m.accepted_by)}` : ""}` : ""}
                        </p>
                      </div>
                      {canManage ? (
                        <div className="flex flex-wrap gap-2">
                          {editable ? <EditMilestoneButton projectId={id} milestone={{ id: m.id, title: m.title, description: m.description, due_date: m.due_date, is_required: m.is_required, client_facing: m.client_facing, version: m.version }} /> : null}
                          <MilestoneStatusButton projectId={id} milestoneId={m.id} title={m.title} moves={milestoneMoves(m.status)} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel
            id="deliverables"
            title="Deliverables"
            description="Pieces of work the PM gives to a department. The department head distributes the tasks and accepts the deliverable."
            actions={canManage ? <AddDeliverableButton projectId={id} teams={teamOptions} milestones={milestoneOptions} /> : undefined}
          >
            {dls.length === 0 ? (
              <EmptyState icon={ListChecks} dense title="No deliverables yet" description={view.canManage ? (view.teams.length === 0 ? "Add a department team on the People page first, then give it a deliverable." : "Add a deliverable and choose the department team responsible for it.") : "The Project Manager assigns deliverables to departments."} />
            ) : (
              <div className="space-y-5">
                {groupDeliverables(ms, dls).map((g) => (
                  <section key={g.milestone?.id ?? "none"} aria-label={g.milestone ? `Deliverables for ${g.milestone.title}` : "Deliverables not linked to a milestone"}>
                    <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{g.milestone ? g.milestone.title : "Not linked to a milestone"}</h3>
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {g.deliverables.map((d) => {
                        const team = view.teams.find((t) => t.id === d.team_id) ?? null;
                        const isHead = !!d.team_id && view.headOfTeamIds.includes(d.team_id);
                        const c = counts.get(d.id) ?? { open: 0, total: 0 };
                        const due = dueWords(d.due_date, !["accepted", "cancelled", "deferred"].includes(d.status), today, fmt);
                        const canEdit = !readOnly && (canManage || isHead) && d.status !== "accepted" && d.status !== "cancelled";
                        const canStatus = !readOnly && (canManage || isHead);
                        return (
                          <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{d.title}</span><DeliverableStatusBadge status={d.status} /></div>
                              {d.description ? <p className="text-sm text-muted-foreground">{d.description}</p> : null}
                              <p className="text-sm text-muted-foreground">
                                {team ? `${team.name} (head: ${view.nameOf(team.head_user_id)})` : "No department assigned"} · <span className={due.overdue ? "font-medium text-destructive" : undefined}>{due.text}</span> ·{" "}
                                {c.total === 0 ? "No tasks yet" : `${c.open} open of ${c.total} task${c.total === 1 ? "" : "s"}`}
                              </p>
                            </div>
                            {canEdit || canStatus ? (
                              <div className="flex flex-wrap gap-2">
                                {canEdit ? <EditDeliverableButton projectId={id} isManager={canManage} teams={teamOptions} milestones={milestoneOptions} deliverable={{ id: d.id, title: d.title, description: d.description, due_date: d.due_date, team_id: d.team_id, milestone_id: d.milestone_id, version: d.version }} /> : null}
                                {canStatus ? <DeliverableStatusButton projectId={id} deliverableId={d.id} title={d.title} moves={deliverableMoves(d.status)} /> : null}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </details>

      {firstParam(sp, "task") ? <TaskPanel rawTaskId={firstParam(sp, "task")} projectId={id} basePath={basePath} current={current} /> : null}
    </div>
  );
}

/**
 * One group of the task list. It opens by default and collapses with a click. A milestone group also shows the milestone's status and
 * the deliverables that belong to it (the real links only: tasks and deliverables that belong to no milestone are under "Unlinked").
 */
function GroupBlock({ group, by, milestone, deliverables, counts, teams, children }: {
  group: TaskGroup<TaskRowData>;
  by: string;
  milestone?: { title: string; status: string; due_date: string | null; is_required: boolean };
  deliverables: { id: string; title: string; status: string; team_id: string | null }[];
  counts: Map<string, { open: number; total: number }>;
  teams: { id: string; name: string }[];
  children: React.ReactNode;
}) {
  return (
    <details open className="rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-4 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-semibold">{group.label}</span>
        <span className="text-muted-foreground">{group.rows.length} task{group.rows.length === 1 ? "" : "s"}</span>
        {milestone ? (
          <>
            <MilestoneStatusBadge status={milestone.status} />
            {milestone.due_date ? <span className="text-muted-foreground">due {dateText(milestone.due_date)}</span> : null}
            {!milestone.is_required ? <Badge variant="outline" className="text-muted-foreground">Optional</Badge> : null}
          </>
        ) : null}
        {by === "milestone" && group.none ? <span className="text-muted-foreground">Not linked to any milestone</span> : null}
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        {by === "milestone" && deliverables.length > 0 ? (
          <div>
            <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Deliverables</h3>
            <ul className="space-y-1 text-sm">
              {deliverables.map((d) => {
                const c = counts.get(d.id) ?? { open: 0, total: 0 };
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.title}</span>
                    <DeliverableStatusBadge status={d.status} />
                    <span className="text-muted-foreground">{teams.find((t) => t.id === d.team_id)?.name ?? "No department"} · {c.total === 0 ? "no tasks yet" : `${c.open} open of ${c.total}`}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {children}
      </div>
    </details>
  );
}
