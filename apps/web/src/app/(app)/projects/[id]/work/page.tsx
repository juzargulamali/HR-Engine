import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CalendarCheck, ListChecks } from "lucide-react";
import { isFinishedProject, isOpenTask, milestoneProgress, TASK_STATUS_LABELS, TASK_STATUSES } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BlockedBadge, DeliverableStatusBadge, MilestoneStatusBadge, PriorityBadge, TaskStatusBadge } from "@/components/projects/badges";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView, memberOptions } from "@/lib/projects/data";
import { dateText, formatDateTime, todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { AddDeliverableButton, DeliverableStatusButton, EditDeliverableButton } from "./deliverable-forms";
import {
  deliverableMoves, dueWords, filterTasks, groupDeliverables, hasActiveFilters, milestoneMoves, newTaskOptions, parseTaskFilters, reviewQueue, sortTasks,
  taskCountsByDeliverable, taskRowFields, type TaskRowFields,
} from "./helpers";
import { AddMilestoneButton, EditMilestoneButton, MilestoneStatusButton } from "./milestone-forms";
import { NewTaskButton } from "./new-task-form";

export const metadata = { title: "Milestones & tasks" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WorkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  if (view.level !== "details") redirect(`/projects/${id}`);

  const filters = parseTaskFilters(await searchParams);
  const today = todayIso();
  const supabase = await createClient();
  const [{ data: milestones }, { data: deliverables }, { data: tasks }, { data: progressRows }] = await Promise.all([
    supabase.from("proj_milestones").select("*").eq("project_id", id).order("sort_order").order("due_date", { nullsFirst: false }),
    supabase.from("proj_deliverables").select("*").eq("project_id", id).order("due_date", { nullsFirst: false }),
    supabase.from("proj_tasks").select("*").eq("project_id", id),
    supabase.rpc("proj_milestone_progress", { p_project_id: id }),
  ]);
  const ms = milestones ?? [];
  const dls = deliverables ?? [];
  const allTasks = tasks ?? [];
  const progress = progressRows?.[0] ? milestoneProgress(progressRows[0].accepted_required, progressRows[0].total_required) : null;
  const readOnly = isFinishedProject(view.project.status);
  const canManage = view.canManage && !readOnly;
  const teamOptions = view.teams.map((t) => ({ id: t.id, name: t.name }));
  const milestoneOptions = ms.filter((m) => m.status !== "cancelled").map((m) => ({ id: m.id, name: m.title }));
  const members = memberOptions(view);
  const counts = taskCountsByDeliverable(allTasks);
  const fmt = (d: string) => dateText(d);

  const visible = sortTasks(filterTasks(allTasks, filters, ctx.userId, today));
  const rows = visible.map((t) => taskRowFields(t, { nameOf: view.nameOf, teams: view.teams, deliverables: dls, today, format: fmt }));
  const queue = readOnly ? [] : reviewQueue(allTasks, view.standing, ctx.userId);
  const options = newTaskOptions({ standing: view.standing, userId: ctx.userId, myTeamId: view.myTeamId, people: view.people, teams: view.teams, deliverables: dls, manager: view.canManage });
  const canCreateTask = !readOnly && (options.assigneesByTeam[""]?.length ?? 0) + Object.values(options.assigneesByTeam).flat().length > 0;
  const groups = groupDeliverables(ms, dls);
  const openTaskCount = allTasks.filter((t) => isOpenTask(t.status)).length;

  return (
    <div className="space-y-6">
      <nav aria-label="On this page" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href="#milestones">Milestones ({ms.length})</a>
        <a className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href="#deliverables">Deliverables ({dls.length})</a>
        <a className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href="#tasks">Tasks ({openTaskCount} open)</a>
      </nav>
      {readOnly ? <Muted>This project is {view.project.status}. Its plan is read-only; a founder can reopen it from History.</Muted> : null}

      {queue.length > 0 ? (
        <Panel title={`Waiting for your review (${queue.length})`} description="Tasks sent for review that you may accept or send back. You never review your own work.">
          <ul className="divide-y divide-border">
            {queue.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link href={`/projects/${id}/work/tasks/${t.id}`} className="font-medium underline-offset-4 hover:underline">{t.title}</Link>
                  <p className="text-sm text-muted-foreground">Done by {view.nameOf(t.assignee_id)} · {dueWords(t.due_date, true, today, fmt).text}</p>
                </div>
                <Link href={`/projects/${id}/work/tasks/${t.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Review</Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ---- Milestones ---- */}
      <Panel
        id="milestones"
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

      {/* ---- Deliverables ---- */}
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
            {groups.map((g) => (
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

      {/* ---- Tasks ---- */}
      <Panel
        id="tasks"
        title="Tasks"
        description={`${visible.length} shown of ${allTasks.length}. Dates are never moved automatically: changing one records history and lists the work it touches, for a person to decide.`}
        actions={
          canCreateTask ? (
            <NewTaskButton
              projectId={id}
              options={options}
              milestones={milestoneOptions}
              tasks={sortTasks(allTasks.filter((t) => isOpenTask(t.status))).map((t) => ({ id: t.id, name: t.title }))}
              collaborators={members}
              defaultAssignee={ctx.userId}
            />
          ) : undefined
        }
      >
        <form method="get" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter tasks">
          <label className="space-y-1 text-sm"><span className="font-medium">Status</span>
            <Select name="status" defaultValue={filters.status}>
              <option value="open">Open (default)</option><option value="all">All</option>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
            </Select>
          </label>
          <label className="space-y-1 text-sm"><span className="font-medium">Assigned to</span>
            <Select name="assignee" defaultValue={filters.assignee ?? ""}><option value="">Anyone</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
          </label>
          <label className="space-y-1 text-sm"><span className="font-medium">Team</span>
            <Select name="team" defaultValue={filters.team ?? ""}><option value="">Any team</option>{teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </label>
          <label className="space-y-1 text-sm"><span className="font-medium">Deliverable</span>
            <Select name="deliverable" defaultValue={filters.deliverable ?? ""}><option value="">Any deliverable</option>{dls.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</Select>
          </label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:col-span-2 lg:col-span-3">
            <label className="flex items-center gap-2"><input type="checkbox" name="mine" value="1" defaultChecked={filters.mine} className="h-4 w-4" /> Mine only</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue} className="h-4 w-4" /> Overdue</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="blocked" value="1" defaultChecked={filters.blocked} className="h-4 w-4" /> Blocked</label>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="secondary" size="sm">Apply filters</Button>
            {hasActiveFilters(filters) ? <Link href={`/projects/${id}/work#tasks`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Clear</Link> : null}
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            dense
            title={allTasks.length === 0 ? "No tasks yet" : "No tasks match these filters"}
            description={allTasks.length === 0 ? "Department heads distribute deliverables into tasks; any member can add a task for themself." : "Clear the filters, or choose All to include finished tasks."}
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader><TableRow><TableHead>Task</TableHead><TableHead>Assigned to</TableHead><TableHead>Team</TableHead><TableHead>Deliverable</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="min-w-[14rem]">
                        <Link href={`/projects/${id}/work/tasks/${r.id}`} className="font-medium underline-offset-4 hover:underline">{r.title}</Link>
                        <TaskFlags r={r} />
                      </TableCell>
                      <TableCell>{r.assignee}</TableCell>
                      <TableCell>{r.team ?? <span className="text-muted-foreground">None</span>}</TableCell>
                      <TableCell>{r.deliverable ?? <span className="text-muted-foreground">None</span>}</TableCell>
                      <TableCell className={r.due.overdue ? "font-medium text-destructive" : undefined}>{r.due.text}</TableCell>
                      <TableCell><TaskStatusBadge status={r.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/projects/${id}/work/tasks/${r.id}`} className="min-w-0 font-medium underline-offset-4 hover:underline">{r.title}</Link>
                    <TaskStatusBadge status={r.status} />
                  </div>
                  <TaskFlags r={r} />
                  <dl className="mt-2 grid grid-cols-2 gap-2">
                    <Fact label="Assigned to">{r.assignee}</Fact>
                    <Fact label="Team">{r.team ?? "None"}</Fact>
                    <Fact label="Deliverable">{r.deliverable ?? "None"}</Fact>
                    <Fact label="Due"><span className={r.due.overdue ? "font-medium text-destructive" : undefined}>{r.due.text}</span></Fact>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

/** Priority, review and blocked flags, in words. */
function TaskFlags({ r }: { r: TaskRowFields }) {
  if (!r.blocked && !r.needsReview && r.priority === "normal") return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {r.blocked ? <BlockedBadge /> : null}
      <PriorityBadge priority={r.priority} />
      {r.needsReview ? <Badge variant="outline" className="text-muted-foreground">Needs review</Badge> : null}
    </div>
  );
}
