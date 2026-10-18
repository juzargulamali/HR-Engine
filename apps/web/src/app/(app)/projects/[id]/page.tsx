import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ListChecks, MessageSquareWarning, ShieldAlert, Truck, Flag } from "lucide-react";
import { allowedStatusMoves, canManageProject, canReopenProject, isFinishedProject, milestoneProgress, projectStatusLabel, COMPLETION_EVIDENCE_TYPES } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { HandoverStatusBadge } from "@/components/projects/badges";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { dateRangeText, dateText, todayIso, formatDate, formatDateTime } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { EditDetailsButton, ReopenButton, StatusControls } from "./overview-controls";
import { blockers, holdReviewState, nextUp, resolutionSummary, workCounts } from "./overview-helpers";

export const metadata = { title: "Project overview" };

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  const { project, details } = view;
  const supabase = await createClient();

  // ---------------------------------------------------------------- Summary level: directory users and linked Sales
  if (view.level === "summary" || !details) {
    let handover: { status: string; crm_reference: string; accepted_at: string | null } | null = null;
    if (view.standing.isSalesLinked && project.kind === "client") {
      const { data } = await supabase.from("proj_handovers").select("status, crm_reference, accepted_at").eq("project_id", id).maybeSingle();
      handover = data ?? null;
    }
    return (
      <div className="space-y-5">
        <Panel title="Summary" description="This is all the project directory shows about a project you are not working on.">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Reference">{project.reference}</Fact>
            <Fact label="Company">{view.companyName}</Fact>
            <Fact label="Type">{project.kind === "client" ? "Client project" : project.is_ongoing ? "Internal project, ongoing" : "Internal project"}</Fact>
            <Fact label="Status">{projectStatusLabel(project.status)}</Fact>
            <Fact label="Project Manager">{view.pmName}</Fact>
            <Fact label="Dates">{dateRangeText(project.start_date, project.end_date)}</Fact>
          </dl>
        </Panel>
        {handover ? (
          <Panel title="Sales handover" description="The handover you prepared in Sales & CRM for this project.">
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="Sales reference">{handover.crm_reference}</Fact>
              <Fact label="Handover status"><HandoverStatusBadge status={handover.status} /></Fact>
              <Fact label="Accepted by the Project Manager">{handover.accepted_at ? formatDateTime(handover.accepted_at) : "Not yet"}</Fact>
            </dl>
          </Panel>
        ) : null}
      </div>
    );
  }

  // ---------------------------------------------------------------- Details level: members and founders
  const today = todayIso();
  const nowIso = new Date().toISOString();
  const manager = canManageProject(view.standing);
  const live = !isFinishedProject(project.status);
  const [tasksR, milestonesR, deliverablesR, feedbackR, bookingsR, progressR, completionsR, outdatedR] = await Promise.all([
    supabase.from("proj_tasks").select("id, title, status, due_date, blocked_at, blocked_reason, assignee_id, unblock_owner_id, unblock_action").eq("project_id", id),
    supabase.from("proj_milestones").select("id, title, status, due_date, is_required").eq("project_id", id),
    supabase.from("proj_deliverables").select("id, title, status, due_date").eq("project_id", id),
    supabase.from("proj_feedback").select("status").eq("project_id", id),
    supabase.from("proj_site_bookings").select("state, ends_at").eq("project_id", id),
    supabase.rpc("proj_milestone_progress", { p_project_id: id }),
    supabase.from("proj_completions").select("*").eq("project_id", id).order("completed_at", { ascending: false }),
    manager && project.kind === "client" ? supabase.rpc("proj_plan_outdated", { p_project_id: id }) : Promise.resolve({ data: null }),
  ]);
  const tasks = tasksR.data ?? [];
  const milestones = milestonesR.data ?? [];
  const counts = workCounts({ tasks, milestones, feedback: feedbackR.data ?? [], bookings: bookingsR.data ?? [], today, nowIso });
  const upcoming = nextUp(milestones, deliverablesR.data ?? [], today, 5);
  const blocked = blockers(tasks);
  const prog = milestoneProgress(progressR.data?.[0]?.accepted_required ?? 0, progressR.data?.[0]?.total_required ?? 0);
  const completions = completionsR.data ?? [];
  const current = completions.find((c) => !c.reopened_at) ?? null;
  const reopenedEarlier = completions.filter((c) => c.reopened_at);
  const outdated = outdatedR.data === true;
  const holdState = holdReviewState(details.hold_review_date, today);
  const moves = manager ? allowedStatusMoves(project.kind, project.status) : [];
  const canReopen = canReopenProject(view.ctx.grants, project.company_id) && isFinishedProject(project.status);
  const isInternal = project.kind === "internal";
  const base = `/projects/${id}`;
  const unblocker = (t: (typeof blocked)[number]) =>
    [t.unblock_owner_id ? `${view.nameOf(t.unblock_owner_id)} can unblock it` : null, t.unblock_action].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      {manager || canReopen ? (
        <div className="flex flex-wrap items-center gap-2">
          {manager ? <StatusControls projectId={id} moves={moves} currentLabel={projectStatusLabel(project.status)} /> : null}
          {manager && live ? (
            <EditDetailsButton
              p={{
                id, version: project.version, kind: project.kind, name: project.name, priority: project.priority, isOngoing: project.is_ongoing, startDate: project.start_date,
                endDate: project.end_date, clientName: details.client_name, location: details.location, siteTimezone: details.site_timezone, installStart: details.install_start,
                eventStart: details.event_start, eventEnd: details.event_end, scope: details.scope, exclusions: details.exclusions,
              }}
            />
          ) : null}
          {manager && live ? <Link href={`${base}/complete`}><Button type="button">Complete project</Button></Link> : null}
          {canReopen ? <ReopenButton projectId={id} /> : null}
        </div>
      ) : null}

      {project.status === "on_hold" ? (
        <Alert variant="warning" role="status">
          <p className="font-medium">On hold{details.hold_reason ? `: ${details.hold_reason}` : ""}</p>
          <p className="mt-0.5">
            Review date {dateText(details.hold_review_date)}
            {holdState === "overdue" ? ", which has passed: decide whether to resume it." : holdState === "today" ? ", which is today." : "."}
          </p>
        </Alert>
      ) : null}
      {outdated ? (
        <Alert variant="warning" role="status">
          The issued client timeline is out of date: the client-facing plan has changed since it was issued. Issue a new version from the{" "}
          <Link href={`${base}/documents`} className="font-medium underline">Documents tab</Link>.
        </Alert>
      ) : null}
      {reopenedEarlier.length > 0 && !current ? (
        <Alert role="status">This project was completed and then reopened. The earlier completion record is kept on the <Link href={`${base}/history`} className="font-medium underline">History tab</Link>.</Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Open tasks" value={counts.openTasks} href={`${base}/work`} icon={ListChecks} hint={counts.overdueTasks > 0 ? `${counts.overdueTasks} overdue` : "None overdue"} tone={counts.overdueTasks > 0 ? "warning" : "default"} />
        <MetricCard label="Blocked tasks" value={counts.blockedTasks} href={`${base}/work`} icon={ShieldAlert} tone={counts.blockedTasks > 0 ? "destructive" : "default"} />
        <MetricCard label="Milestones not yet accepted" value={counts.unacceptedMilestones} href={`${base}/work`} icon={Flag} />
        <MetricCard label="Open client feedback" value={counts.openFeedback} href={`${base}/changes`} icon={MessageSquareWarning} />
        <MetricCard label="Upcoming site bookings" value={counts.upcomingBookings} href={`${base}/timeline`} icon={Truck} />
        <MetricCard label="Dates" value={dateRangeText(project.start_date, project.end_date)} icon={CalendarClock} className="[&_div.font-heading]:text-base" />
      </div>

      <Panel title="Progress" description="Counted from milestones the Project Manager has accepted. It is never estimated from elapsed time.">
        {prog ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{prog.basis}</p>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" role="img" aria-label={prog.basis}>
              <div className="h-full bg-primary" style={{ width: `${prog.percent}%` }} />
            </div>
            <Muted>{prog.percent}% of required milestones accepted.</Muted>
          </div>
        ) : (
          <Muted>No required milestones yet. Add them on the Milestones &amp; tasks tab and progress will be counted from the ones accepted.</Muted>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Next up" description="The next unfinished milestones and deliverables by due date.">
          {upcoming.length === 0 ? (
            <EmptyState dense title="Nothing dated is waiting" description="Milestones and deliverables with a due date appear here until they are accepted." />
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((u) => (
                <li key={`${u.kind}-${u.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0"><span className="text-muted-foreground">{u.kind}: </span><span className="font-medium">{u.title}</span></span>
                  <span className={u.overdue ? "font-medium text-destructive" : "text-muted-foreground"}>{u.overdue ? "Overdue, was due " : "Due "}{formatDate(u.due)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Blockers" description="Open tasks that cannot move until someone acts.">
          {blocked.length === 0 ? (
            <EmptyState dense title="No blocked tasks" description="A task is marked blocked with a reason and who or what will unblock it." />
          ) : (
            <ul className="space-y-3">
              {blocked.map((t) => (
                <li key={t.id} className="text-sm">
                  <Link href={`${base}/work/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>
                  <p className="text-muted-foreground">{t.blocked_reason}</p>
                  {unblocker(t) ? <p className="text-muted-foreground">{unblocker(t)}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Key facts">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!isInternal ? <Fact label="Client">{details.client_name ?? "Not recorded"}</Fact> : null}
          <Fact label="Location">{details.location ?? "Not recorded"}</Fact>
          <Fact label="Site time zone">{details.site_timezone}</Fact>
          <Fact label="Project dates">{dateRangeText(project.start_date, project.end_date)}</Fact>
          <Fact label="Installation starts">{dateText(details.install_start)}</Fact>
          <Fact label="Event">{dateRangeText(details.event_start, details.event_end)}</Fact>
          <Fact label="Project Manager">{view.pmName}</Fact>
          <Fact label="Reference">{project.reference}</Fact>
          <Fact label="Company">{view.companyName}</Fact>
        </dl>
      </Panel>

      <Panel
        title={isInternal ? "Scope" : "Agreed scope"}
        description={isInternal ? undefined : "As handed over from Sales. It changes only through a recorded scope change on the Feedback & changes tab, which keeps the original."}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Scope of work</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm">{details.scope ?? <span className="text-muted-foreground">Not recorded.</span>}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium">Exclusions</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm">{details.exclusions ?? <span className="text-muted-foreground">None recorded.</span>}</p>
          </div>
        </div>
        {details.technologies.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-medium">Technologies</h3>
            <ul className="mt-1 flex flex-wrap gap-2">
              {details.technologies.map((t, i) => <li key={`${t.name}-${i}`} className="rounded-full border border-border px-2.5 py-0.5 text-sm">{t.name} × {t.qty}</li>)}
            </ul>
          </div>
        ) : null}
      </Panel>

      {current ? (
        <Panel title="Completion" description="Recorded when the project was completed. Read-only.">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Completed">{formatDateTime(current.completed_at)} by {view.nameOf(current.completed_by)}</Fact>
            <Fact label="Evidence">{COMPLETION_EVIDENCE_TYPES.find((e) => e.id === current.evidence_type)?.label ?? "Internal completion note"}</Fact>
            {current.evidence_reference ? <Fact label="Reference">{current.evidence_reference}</Fact> : null}
            {current.confirmed_on ? <Fact label="Client confirmed on">{formatDate(current.confirmed_on)}</Fact> : null}
            {current.client_contact ? <Fact label="Confirmed by">{current.client_contact}</Fact> : null}
            <Fact label="Left unfinished">{resolutionSummary(current.resolutions)}</Fact>
          </dl>
          <p className="mt-3 whitespace-pre-wrap text-sm">{current.completion_note}</p>
        </Panel>
      ) : null}
    </div>
  );
}
