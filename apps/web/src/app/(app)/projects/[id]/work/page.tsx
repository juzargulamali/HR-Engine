import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CalendarCheck, CheckCircle2, Clock, ListChecks, ShieldAlert } from "lucide-react";
import { canManageProject, COMPLETION_EVIDENCE_TYPES, isFinishedProject, isOpenTask, milestoneProgress, TASK_STATUS_LABELS, TASK_STATUSES } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DeliverableStatusBadge, MilestoneStatusBadge } from "@/components/projects/badges";
import { OsFilterBar } from "@/components/os/filter-bar";
import { OsStatCard } from "@/components/os/stat-card";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { MilestoneStrip, NextActionCard, NextOnSiteCard, type ActionItem } from "@/components/projects/work-parts";
import { QuickAddTask } from "@/components/projects/tasks/quick-add-task";
import { TaskBoard } from "@/components/projects/tasks/task-board";
import { TaskPanel } from "@/components/projects/tasks/task-panel";
import { TaskTable } from "@/components/projects/tasks/task-table";
import {
  buildTaskRow, DEFAULT_TASK_COLUMNS, GROUP_LABELS, groupTaskRows, parseGroupBy, parseTaskSort, sortTaskRows, TASK_COLUMNS, TASK_COLUMN_IDS,
  type TaskGroup, type TaskRowData,
} from "@/components/projects/tasks/task-logic";
import { ColumnsMenu } from "@/components/workspace/columns-menu";
import { LoadError } from "@/components/workspace/states";
import { PanelLink } from "@/components/workspace/panel-link";
import { firstParam, paramsToRecord, parseColumns, parseView, withParams } from "@/components/workspace/url-state";
import { ViewSwitch } from "@/components/workspace/view-switch";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView, memberOptions } from "@/lib/projects/data";
import { dateText, formatDate, formatDateTime, todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { ProjectDetailsCard } from "./details-card";
import { AddDeliverableButton, DeliverableStatusButton, EditDeliverableButton } from "./deliverable-forms";
import {
  deliverableMoves, dueWords, filterTasks, groupDeliverables, hasActiveFilters, isDueThisWeekOrOverdue, milestoneMoves, needsAttention, newTaskOptions, parseTaskFilters, quickAssigneeChoices,
  reviewQueue, showChoiceOf, sortTasks, taskCountsByDeliverable, weekWindow,
} from "./helpers";
import { AddMilestoneButton, EditMilestoneButton, MilestoneStatusButton } from "./milestone-forms";
import { PlanAddMenu } from "./plan-add-menu";
import { blockers, holdReviewState, resolutionSummary } from "../overview-helpers";

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
  const manager = canManageProject(view.standing);
  const [msRes, dlRes, taskRes, progressRes, feedbackRes, bookingRes, completionRes, outdatedRes] = await Promise.all([
    supabase.from("proj_milestones").select("*").eq("project_id", id).order("sort_order").order("due_date", { nullsFirst: false }),
    supabase.from("proj_deliverables").select("*").eq("project_id", id).order("due_date", { nullsFirst: false }),
    supabase.from("proj_tasks").select("*").eq("project_id", id),
    supabase.rpc("proj_milestone_progress", { p_project_id: id }),
    supabase.from("proj_feedback").select("status").eq("project_id", id),
    supabase.from("proj_site_bookings").select("id, user_id, location, starts_at, ends_at, tz, state").eq("project_id", id).order("starts_at"),
    supabase.from("proj_completions").select("*").eq("project_id", id).order("completed_at", { ascending: false }),
    manager && view.project.kind === "client" ? supabase.rpc("proj_plan_outdated", { p_project_id: id }) : Promise.resolve({ data: null, error: null }),
  ]);
  if (msRes.error || dlRes.error || taskRes.error || completionRes.error) {
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

  // ---- The summary cards and the "This week" list: every number is counted from this project's tasks, in the same way as the filter behind it.
  const week = weekWindow(today);
  const openTasks = allTasks.filter((t) => isOpenTask(t.status));
  const dueThisWeek = openTasks.filter((t) => t.due_date && t.due_date >= week.start && t.due_date <= week.end).length;
  const attentionCount = allTasks.filter((t) => needsAttention(t, today)).length;
  const inReviewCount = allTasks.filter((t) => t.status === "ready_for_review").length;
  const showAll = firstParam(sp, "tasks") === "all";
  const weekMode = !showAll && !filtered && mode === "table" && group === "none";
  const focusRows = rows.filter((r) => { const t = allTasks.find((x) => x.id === r.id); return !!t && (isDueThisWeekOrOverdue(t, today) || needsAttention(t, today)); });
  const WEEK_CAP = 6;
  const listRows = weekMode ? focusRows.slice(0, WEEK_CAP) : rows;
  const taskAt = (taskId: string) => withParams(basePath, current, { task: taskId });
  const allHref = withParams(basePath, current, { tasks: "all" }, ["status", "show", "mine", "overdue", "blocked", "q", "assignee", "team", "deliverable"]);
  const weekHref = withParams(basePath, current, {}, ["tasks", "status", "show", "mine", "overdue", "blocked", "q", "assignee", "team", "deliverable", "view", "group"]);

  // ---- Right rail: what needs action, the next site visit, the project's details.
  const milestoneStrip = ms.map((m) => ({ id: m.id, title: m.title, status: m.status, dueDate: m.due_date, isRequired: m.is_required }));
  const lateMilestones = ms.filter((m) => m.due_date && m.due_date < today && ["planned", "in_progress", "ready_for_acceptance"].includes(m.status));
  const blocked = blockers(allTasks);
  const actionAll: ActionItem[] = [
    ...blocked.map((t) => ({
      key: `b-${t.id}`, href: taskAt(t.id), tone: "red" as const, title: `Blocked: ${t.title}`,
      detail: [t.blocked_reason, t.unblock_owner_id ? `${view.nameOf(t.unblock_owner_id)} can unblock it` : null, t.unblock_action].filter(Boolean).join(" · "),
    })),
    ...queue.map((t) => ({ key: `r-${t.id}`, href: taskAt(t.id), tone: "blue" as const, title: `Review: ${t.title}`, detail: `Done by ${view.nameOf(t.assignee_id)}. You can accept it or send it back.` })),
    ...lateMilestones.map((m) => ({ key: `m-${m.id}`, href: `${basePath}?ms=1#milestone-list`, tone: "amber" as const, title: `Overdue milestone: ${m.title}`, detail: `Was due ${formatDate(m.due_date as string)}` })),
  ];
  const nowIso = new Date().toISOString();
  const upcomingBookings = (bookingRes.data ?? []).filter((b) => (b.state === "tentative" || b.state === "confirmed") && b.ends_at > nowIso);
  const nextBooking = upcomingBookings[0] ?? null;
  const bookingWhen = nextBooking
    ? `${new Intl.DateTimeFormat("en-GB", { timeZone: nextBooking.tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(nextBooking.starts_at))} (${nextBooking.tz})`
    : "";
  const feedbackOpen = (feedbackRes.data ?? []).filter((f) => f.status === "open" || f.status === "in_progress").length;
  const completions = completionRes.data ?? [];
  const completion = completions.find((c) => !c.reopened_at) ?? null;
  const reopenedEarlier = completions.some((c) => c.reopened_at);
  const details = view.details;
  const holdState = holdReviewState(details?.hold_review_date ?? null, today);
  const acting = view.people.filter((p) => p.role === "acting_pm" && p.acting_until && p.acting_until >= today).map((p) => view.nameOf(p.user_id));
  const teamNames = view.teams.map((t) => `${t.name}${t.head_user_id ? ` (head: ${view.nameOf(t.head_user_id)})` : ""}`);

  const toolbarFilters = [
    { name: "status", label: "Show", value: filters.status === "open" ? "" : filters.status, options: [{ value: "", label: "Open tasks" }, { value: "all", label: "All tasks" }, ...TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))] },
    { name: "assignee", label: "Assignee", value: filters.assignee ?? "", options: [{ value: "", label: "Anyone" }, ...members.map((m) => ({ value: m.id, label: m.name }))] },
    ...(view.teams.length > 0 ? [{ name: "team", secondary: true, label: "Department", value: filters.team ?? "", options: [{ value: "", label: "Any department" }, ...teamOptions.map((t) => ({ value: t.id, label: t.name }))] }] : []),
    ...(dls.length > 0 ? [{ name: "deliverable", secondary: true, label: "Deliverable", value: filters.deliverable ?? "", options: [{ value: "", label: "Any deliverable" }, ...dls.map((d) => ({ value: d.id, label: d.title }))] }] : []),
    { name: "show", secondary: true, label: "Narrow to", value: showChoiceOf(filters), options: [{ value: "", label: "Everything" }, { value: "mine", label: "My tasks" }, { value: "overdue", label: "Overdue" }, { value: "blocked", label: "Blocked" }] },
    ...(mode === "table" ? [{ name: "group", label: "Group by", value: group === "none" ? "" : group, options: (["none", "team", "milestone", "status", "assignee"] as const).map((g) => ({ value: g === "none" ? "" : g, label: GROUP_LABELS[g] })) }] : []),
  ];

  const openMilestones = current.ms === "1" || ms.length === 0;
  const taskCountWords = `${allTasks.length} task${allTasks.length === 1 ? "" : "s"}`;
  const viewAll = (
    <Link href={allHref} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>View all tasks ({allTasks.length})</Link>
  );
  const addControls = (
    <>
      {canManage ? <PlanAddMenu projectId={id} teams={teamOptions} milestones={milestoneOptions} /> : null}
      {canCreateTask ? (
        <QuickAddTask projectId={id} options={options} choices={choices} milestones={milestoneOptions} tasks={sortTasks(allTasks.filter((t) => isOpenTask(t.status))).map((t) => ({ id: t.id, name: t.title }))} collaborators={members} defaultAssignee={ctx.userId} />
      ) : null}
    </>
  );
  const listTitle = weekMode ? "This week" : "Tasks";

  /** A compact empty state inside the task card: one line of words and the two ways forward. */
  const emptyList = (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-border bg-[hsl(var(--field))] px-4 py-4">
      <div className="flex min-w-0 flex-1 basis-60 items-start gap-3">
        <ListChecks className="mt-0.5 h-5 w-5 flex-none text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium">{allTasks.length === 0 ? "No tasks yet" : weekMode ? "Nothing due this week" : "No tasks match"}</p>
          <p className="text-sm text-muted-foreground">
            {allTasks.length === 0
              ? canCreateTask ? "Add the first task. Department heads give deliverables out as tasks; any member can add one for themself." : "Department heads give deliverables out as tasks; any member can add one for themself."
              : weekMode ? "No open task is due this week, overdue or blocked." : "Clear the filters, or open all tasks to include finished ones."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filtered ? <Link href={clearHref} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link> : null}
        {allTasks.length === 0 ? addControls : null}
        {!filtered ? viewAll : null}
      </div>
    </div>
  );

  const taskList =
    listRows.length === 0 ? emptyList : mode === "board" ? (
      <div><TaskBoard rows={rows} basePath={basePath} current={current} showProject={false} /></div>
    ) : group === "none" ? (
      <TaskTable rows={listRows} columns={columns} sort={sort} basePath={basePath} current={current} showProject={false} caption={weekMode ? "Tasks due this week, overdue or blocked" : "Tasks of this project"} />
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
    );

  return (
    <div className="space-y-4">
      {readOnly ? <Muted>This project is {view.project.status}. Its plan is read-only; a founder can reopen it from History.</Muted> : null}
      {view.project.status === "on_hold" ? (
        <Alert variant="warning" role="status">
          <p className="font-medium">On hold{details?.hold_reason ? `: ${details.hold_reason}` : ""}</p>
          <p className="mt-0.5">
            Review date {dateText(details?.hold_review_date)}
            {holdState === "overdue" ? ", which has passed: decide whether to resume it." : holdState === "today" ? ", which is today." : "."}
          </p>
        </Alert>
      ) : null}
      {outdatedRes.data === true ? (
        <Alert variant="warning" role="status">
          The issued client timeline is out of date: the client-facing plan has changed since it was issued. Issue a new version from{" "}
          <Link href={`/projects/${id}/documents`} className="font-medium underline">Files &amp; client plan</Link>.
        </Alert>
      ) : null}
      {reopenedEarlier && !completion ? (
        <Alert role="status">This project was completed and then reopened. The earlier completion record is kept on the <Link href={`/projects/${id}/history`} className="font-medium underline">History</Link> page.</Alert>
      ) : null}

      {/* Main column (about 72%) and a narrower right rail (about 28%); the rail's first card starts level with the summary cards. */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,72fr)_minmax(0,28fr)]">
        <div className="min-w-0 space-y-4">
          <ul className="grid grid-cols-3 gap-2.5 sm:gap-3" aria-label="Where the work stands">
            <li><OsStatCard href={allHref} label={openTaskCount === 1 ? "Open task" : "Open tasks"} value={openTaskCount} icon={ListChecks} edge="cyan" active={showAll && !filtered} /></li>
            <li><OsStatCard href={withParams(basePath, current, { show: "attention" }, ["status", "tasks", "mine", "overdue", "blocked"])} label="Need attention" value={attentionCount} icon={AlertTriangle} edge="amber" active={filters.attention} /></li>
            <li><OsStatCard href={withParams(basePath, current, { status: "ready_for_review" }, ["tasks", "show", "mine", "overdue", "blocked"])} label="In review" value={inReviewCount} icon={ShieldAlert} edge="blue" active={filters.status === "ready_for_review"} /></li>
          </ul>

          <section aria-label="Tasks" className="os-card os-task-card">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pb-2.5 pt-3.5 sm:px-5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="font-heading text-lg font-semibold">{listTitle}</h2>
                <Link href={weekHref} scroll={false} aria-current={weekMode ? "true" : undefined} className="os-badge" data-tone="blue">
                  <Clock className="h-3.5 w-3.5" aria-hidden /> {dueThisWeek} due this week
                </Link>
                {!weekMode && (showAll || filtered || mode === "board" || group !== "none") ? <Link href={weekHref} scroll={false} className="text-sm font-medium text-accent underline-offset-4 hover:underline">Back to this week</Link> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">{allTasks.length === 0 ? null : addControls}</div>
            </div>
            <div className="px-4 pb-3 sm:px-5">
              <OsFilterBar search={{ value: filters.q, placeholder: "Search tasks" }} filters={toolbarFilters} clearHref={filtered ? clearHref : undefined}>
                <ViewSwitch current={mode} tableHref={withParams(basePath, current, { view: null })} boardHref={withParams(basePath, current, { view: "board" })} />
              </OsFilterBar>
            </div>
            <div className="px-3 pb-3 sm:px-4">{taskList}</div>
            {listRows.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-2.5 sm:px-5">
                <p className="text-sm text-muted-foreground">
                  {weekMode ? `Showing ${listRows.length} of ${focusRows.length} due this week, overdue or blocked` : `${rows.length} shown of ${taskCountWords}`} · {openTaskCount} open
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {mode === "table" ? <ColumnsMenu columns={TASK_COLUMNS.map((c) => ({ id: c.id, label: c.label }))} selected={columns} defaults={DEFAULT_TASK_COLUMNS} /> : null}
                  {weekMode && allTasks.length > listRows.length ? viewAll : null}
                </div>
              </div>
            ) : null}
          </section>

          {queue.length > 0 ? (
            <Panel title={`Waiting for your review (${queue.length})`} description="Tasks sent for review that you may accept or send back. You never review your own work.">
              <ul className="divide-y divide-border">
                {queue.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <PanelLink href={taskAt(t.id)} className="font-medium underline-offset-4 hover:underline">{t.title}</PanelLink>
                      <p className="text-sm text-muted-foreground">Done by {view.nameOf(t.assignee_id)} · {dueWords(t.due_date, true, today, fmt).text}</p>
                    </div>
                    <PanelLink href={taskAt(t.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>Review</PanelLink>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <MilestoneStrip milestones={milestoneStrip} today={today} basis={progress?.basis ?? null} percent={progress?.percent ?? null} manageHref={`${basePath}?ms=1#milestone-list`} />
        </div>

        <aside aria-label="Project support" className="min-w-0 space-y-4">
          <NextActionCard items={actionAll.slice(0, 4)} total={actionAll.length} />
          <NextOnSiteCard
            booking={nextBooking ? { id: nextBooking.id, location: nextBooking.location, startsAt: nextBooking.starts_at, endsAt: nextBooking.ends_at, state: nextBooking.state, who: view.nameOf(nextBooking.user_id) } : null}
            count={upcomingBookings.length}
            href={`/projects/${id}/plan?plan=site`}
            when={bookingWhen}
          />
          {details ? (
            <ProjectDetailsCard
              pmName={view.pmName} acting={acting} team={teamNames} peopleCount={view.people.length} start={view.project.start_date} end={view.project.end_date}
              details={details} internal={view.project.kind === "internal"} feedbackOpen={feedbackOpen} feedbackHref={`/projects/${id}/changes`}
            />
          ) : null}
        </aside>
      </div>

      {/* ---- Milestones and deliverables ---- */}
      <details id="milestones" open={openMilestones} className="os-card group">
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-[14px] px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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

      {completion ? (
        <Panel title="Completion" description="Recorded when the project was completed. Read-only.">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Completed">{formatDateTime(completion.completed_at)} by {view.nameOf(completion.completed_by)}</Fact>
            <Fact label="Evidence">{COMPLETION_EVIDENCE_TYPES.find((e) => e.id === completion.evidence_type)?.label ?? "Internal completion note"}</Fact>
            {completion.evidence_reference ? <Fact label="Reference">{completion.evidence_reference}</Fact> : null}
            {completion.confirmed_on ? <Fact label="Client confirmed on">{formatDate(completion.confirmed_on)}</Fact> : null}
            {completion.client_contact ? <Fact label="Confirmed by">{completion.client_contact}</Fact> : null}
            <Fact label="Left unfinished">{resolutionSummary(completion.resolutions)}</Fact>
          </dl>
          <p className="mt-3 whitespace-pre-wrap text-sm">{completion.completion_note}</p>
        </Panel>
      ) : null}

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
    <details open className="os-card">
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
