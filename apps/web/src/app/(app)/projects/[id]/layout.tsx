import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { allowedStatusMoves, canReopenProject, isFinishedProject, projectStatusLabel } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { OsHero, OsTeamStack } from "@/components/os/hero";
import { KindBadge, PriorityBadge, ProjectStatusBadge } from "@/components/projects/badges";
import { ManageMenu } from "@/components/projects/manage-menu";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { dateRangeText, dateText } from "@/lib/projects/format";
import { manageItems, projectTabs } from "@/lib/projects/workspace-nav";
import { createClient } from "@/lib/supabase/server";

/**
 * One project. Members and founders get a compact banner, four sections (Work, Timeline, Discussion, Equipment) and one "Manage project"
 * menu for the rest; a person who can only see the summary (a Projects-access holder who is not a member, or a linked Sales person) gets
 * the summary page and neither: the details, discussion, plans and files are not theirs.
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  const { project, details } = view;

  let unread: string | null = null;
  if (view.level === "details") {
    const supabase = await createClient();
    const { data } = await supabase.rpc("proj_unread_counts");
    const row = (data ?? []).find((r) => r.project_id === id);
    if (row && row.unread > 0) unread = row.unread > 99 ? "99+" : String(row.unread);
  }
  const base = `/projects/${id}`;
  const live = !isFinishedProject(project.status);
  const moves = view.canManage ? allowedStatusMoves(project.kind, project.status) : [];
  const items = manageItems({ base, manager: view.canManage, live, canReopen: canReopenProject(ctx.grants, project.company_id) && !live, hasStatusMoves: moves.length > 0 });
  const editable =
    view.canManage && live && details
      ? {
          id, version: project.version, kind: project.kind, name: project.name, priority: project.priority, isOngoing: project.is_ongoing, startDate: project.start_date,
          endDate: project.end_date, clientName: details.client_name, location: details.location, siteTimezone: details.site_timezone, installStart: details.install_start,
          eventStart: details.event_start, eventEnd: details.event_end, scope: details.scope, exclusions: details.exclusions,
        }
      : null;
  const team = view.level === "details" ? [...new Set([project.pm_user_id, ...view.people.map((p) => p.user_id)].filter((x): x is string => !!x))].map((u) => view.nameOf(u)).filter((n) => n && n !== "—") : [];

  return (
    <div className="space-y-4">
      <Link href="/projects" className="inline-flex items-center gap-1 rounded-md py-0.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All projects
      </Link>
      <OsHero
        eyebrow={project.reference}
        title={project.name}
        sub={<><span className="hidden sm:inline">{project.reference} · </span>{view.companyName}</>}
        meta={
          <>
            <ProjectStatusBadge status={project.status} />
            <PriorityBadge priority={project.priority} />
            <KindBadge kind={project.kind} ongoing={project.is_ongoing} />
            <span>Project Manager: <span className="font-medium text-white">{view.pmName}</span></span>
            {details?.install_start ? <span>Installation: <span className="font-medium text-white">{dateText(details.install_start)}</span></span> : null}
            {details?.event_start ? <span>Event: <span className="font-medium text-white">{dateRangeText(details.event_start, details.event_end)}</span></span> : null}
          </>
        }
      >
        {team.length > 0 ? <OsTeamStack names={team} /> : null}
        {view.level === "details" ? (
          <ManageMenu projectId={id} projectName={project.name} items={items} editable={editable} moves={moves} currentStatusLabel={projectStatusLabel(project.status)} />
        ) : null}
      </OsHero>
      {view.level === "summary" ? (
        <Alert role="status">
          Summary only. Details, tasks, discussion and files are for the people working on this project; the Project Manager can add you if you should take part.
        </Alert>
      ) : (
        <ProjectTabs tabs={projectTabs(base, unread)} base={base} />
      )}
      {children}
    </div>
  );
}
