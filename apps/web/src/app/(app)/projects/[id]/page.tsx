import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageProject, isFinishedProject, milestoneProgress, projectStatusLabel, COMPLETION_EVIDENCE_TYPES } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { SummaryPanel } from "@/components/projects/summary-panel";
import { LoadError } from "@/components/workspace/states";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { dateRangeText, dateText, todayIso, formatDate, formatDateTime } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
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
      <Panel title="Summary" description="All that is shown about a project you are not working on.">
        <SummaryPanel
          facts={{ reference: project.reference, companyName: view.companyName, kind: project.kind, isOngoing: project.is_ongoing, status: project.status, pmName: view.pmName, startDate: project.start_date, endDate: project.end_date }}
          handover={handover}
        />
      </Panel>
    );
  }

  // ---------------------------------------------------------------- Details level: members and founders
  const today = todayIso();
  const nowIso = new Date().toISOString();
  const manager = canManageProject(view.standing);
  const [tasksR, milestonesR, deliverablesR, feedbackR, bookingsR, progressR, completionsR, outdatedR] = await Promise.all([
    supabase.from("proj_tasks").select("id, title, status, due_date, blocked_at, blocked_reason, assignee_id, unblock_owner_id, unblock_action").eq("project_id", id),
    supabase.from("proj_milestones").select("id, title, status, due_date, is_required").eq("project_id", id),
    supabase.from("proj_deliverables").select("id, title, status, due_date").eq("project_id", id),
    supabase.from("proj_feedback").select("status").eq("project_id", id),
    supabase.from("proj_site_bookings").select("state, ends_at").eq("project_id", id),
    supabase.rpc("proj_milestone_progress", { p_project_id: id }),
    supabase.from("proj_completions").select("*").eq("project_id", id).order("completed_at", { ascending: false }),
    manager && project.kind === "client" ? supabase.rpc("proj_plan_outdated", { p_project_id: id }) : Promise.resolve({ data: null, error: null }),
  ]);
  // A failed read is shown as a failure, never as an empty project.
  if (tasksR.error || milestonesR.error || deliverablesR.error || completionsR.error) return <LoadError what="this project's overview" retryHref={`/projects/${id}`} />;
  const tasks = tasksR.data ?? [];
  const milestones = milestonesR.data ?? [];
  const counts = workCounts({ tasks, milestones, feedback: feedbackR.data ?? [], bookings: bookingsR.data ?? [], today, nowIso });
  const upcoming = nextUp(milestones, deliverablesR.data ?? [], today, 6);
  const nextMilestone = upcoming.find((u) => u.kind === "Milestone") ?? null;
  const alsoUpcoming = upcoming.filter((u) => u !== nextMilestone).slice(0, 4);
  const blocked = blockers(tasks);
  const prog = milestoneProgress(progressR.data?.[0]?.accepted_required ?? 0, progressR.data?.[0]?.total_required ?? 0);
  const completions = completionsR.data ?? [];
  const current = completions.find((c) => !c.reopened_at) ?? null;
  const reopenedEarlier = completions.filter((c) => c.reopened_at);
  const outdated = outdatedR.data === true;
  const holdState = holdReviewState(details.hold_review_date, today);
  const isInternal = project.kind === "internal";
  const base = `/projects/${id}`;
  const unblocker = (t: (typeof blocked)[number]) =>
    [t.unblock_owner_id ? `${view.nameOf(t.unblock_owner_id)} can unblock it` : null, t.unblock_action].filter(Boolean).join(" · ");
  const acting = view.people.filter((p) => p.role === "acting_pm" && p.acting_until && p.acting_until >= today);
  const team = view.teams.map((t) => `${t.name}${t.head_user_id ? ` (head: ${view.nameOf(t.head_user_id)})` : ""}`);
  const countLinks = [
    { n: counts.openTasks, label: counts.openTasks === 1 ? "open task" : "open tasks", extra: counts.overdueTasks > 0 ? `${counts.overdueTasks} overdue` : null, href: `${base}/work`, warn: counts.overdueTasks > 0 },
    { n: counts.blockedTasks, label: "blocked", extra: null, href: `${base}/work`, warn: counts.blockedTasks > 0 },
    { n: counts.unacceptedMilestones, label: "milestones not yet accepted", extra: null, href: `${base}/work`, warn: false },
    { n: counts.openFeedback, label: "open client feedback", extra: null, href: `${base}/changes`, warn: false },
    { n: counts.upcomingBookings, label: "upcoming site bookings", extra: null, href: `${base}/plan?plan=site`, warn: false },
  ];

  return (
    <div className="space-y-5">
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
          The issued client timeline is out of date: the client-facing plan has changed since it was issued. Issue a new version from{" "}
          <Link href={`${base}/documents`} className="font-medium underline">Files &amp; client plan</Link>.
        </Alert>
      ) : null}
      {reopenedEarlier.length > 0 && !current ? (
        <Alert role="status">This project was completed and then reopened. The earlier completion record is kept on the <Link href={`${base}/history`} className="font-medium underline">History</Link> page.</Alert>
      ) : null}

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm" aria-label="Where things stand">
        {countLinks.map((c) => (
          <li key={c.label}>
            <Link href={c.href} className="group inline-flex items-baseline gap-1.5 hover:underline">
              <span className={`font-heading text-base font-semibold tabular-nums ${c.warn ? "text-destructive" : ""}`}>{c.n}</span>
              <span className="text-muted-foreground group-hover:text-foreground">{c.label}{c.extra ? ` (${c.extra})` : ""}</span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <Panel title="Progress" description="Counted from milestones the Project Manager has accepted, never estimated from elapsed time.">
            {prog ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{prog.basis}</p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" role="img" aria-label={prog.basis}>
                  <div className="h-full bg-primary" style={{ width: `${prog.percent}%` }} />
                </div>
                <Muted>{prog.percent}% of required milestones accepted.</Muted>
              </div>
            ) : (
              <Muted>No required milestones yet. Add them under Work and progress will be counted from the ones accepted.</Muted>
            )}
          </Panel>

          <Panel title="Next milestone">
            {nextMilestone ? (
              <div className="space-y-3">
                <p className="text-sm">
                  <span className="font-medium">{nextMilestone.title}</span>{" "}
                  <span className={nextMilestone.overdue ? "font-medium text-destructive" : "text-muted-foreground"}>{nextMilestone.overdue ? "Overdue, was due " : "Due "}{formatDate(nextMilestone.due)}</span>
                </p>
                {alsoUpcoming.length > 0 ? (
                  <ul className="divide-y divide-border border-t border-border">
                    {alsoUpcoming.map((u) => (
                      <li key={`${u.kind}-${u.id}`} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 text-sm">
                        <span className="min-w-0"><span className="text-muted-foreground">{u.kind}: </span>{u.title}</span>
                        <span className={u.overdue ? "font-medium text-destructive" : "text-muted-foreground"}>{u.overdue ? "Overdue, was due " : "Due "}{formatDate(u.due)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <EmptyState dense title="No dated milestone is waiting" description="Milestones with a due date appear here until they are accepted." />
            )}
          </Panel>

          <Panel title="Current blockers">
            {blocked.length === 0 ? (
              <Muted>No blocked tasks.</Muted>
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

        <div className="space-y-5">
          <Panel title="Team and dates">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Fact label="Project Manager">{view.pmName}{acting.length > 0 ? <span className="block text-muted-foreground">Temporary leader: {acting.map((a) => view.nameOf(a.user_id)).join(", ")}</span> : null}</Fact>
              <Fact label="Team">{team.length > 0 ? team.join("; ") : "No department team yet"}<span className="block text-muted-foreground">{view.people.length} {view.people.length === 1 ? "person" : "people"} on the project</span></Fact>
              <Fact label="Project dates">{dateRangeText(project.start_date, project.end_date)}</Fact>
              <Fact label="Installation starts">{dateText(details.install_start)}</Fact>
              <Fact label="Event">{dateRangeText(details.event_start, details.event_end)}</Fact>
              {!isInternal ? <Fact label="Client">{details.client_name ?? "Not recorded"}</Fact> : null}
              <Fact label="Location">{details.location ?? "Not recorded"}<span className="block text-muted-foreground">Site time zone {details.site_timezone}</span></Fact>
            </dl>
          </Panel>

          <Panel title={isInternal ? "Scope" : "Agreed scope"} description={isInternal ? undefined : "As handed over from Sales. It changes only through a recorded scope change (Manage project, Feedback & changes), which keeps the original."}>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium">Scope of work</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{details.scope ?? <span className="text-muted-foreground">Not recorded.</span>}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium">Exclusions</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm">{details.exclusions ?? <span className="text-muted-foreground">None recorded.</span>}</p>
              </div>
              {details.technologies.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium">Technologies</h3>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {details.technologies.map((t, i) => <li key={`${t.name}-${i}`} className="rounded-full border border-border px-2.5 py-0.5 text-sm">{t.name} × {t.qty}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>

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
