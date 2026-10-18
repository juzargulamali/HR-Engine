import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { allowedStatusMoves, canReopenProject, isFinishedProject, projectStatusLabel } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { KindBadge, PriorityBadge, ProjectStatusBadge } from "@/components/projects/badges";
import { ManageMenu } from "@/components/projects/manage-menu";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { manageItems, projectTabs } from "@/lib/projects/workspace-nav";
import { createClient } from "@/lib/supabase/server";

/**
 * One project. Members and founders get four sections (Overview, Work, Plan, Discussion) and one "Manage project" menu for the rest;
 * a person who can only see the summary (a Projects-access holder who is not a member, or a linked Sales person) gets the summary
 * page and neither: the details, discussion, plans and files are not theirs.
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

  return (
    <div className="space-y-5">
      <div>
        <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All projects
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="break-words text-2xl font-semibold">{project.name}</h1>
              <ProjectStatusBadge status={project.status} />
              <PriorityBadge priority={project.priority} />
              <KindBadge kind={project.kind} ongoing={project.is_ongoing} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {project.reference} · {view.companyName} · Project Manager {view.pmName}
            </p>
          </div>
          {view.level === "details" ? (
            <ManageMenu projectId={id} projectName={project.name} items={items} editable={editable} moves={moves} currentStatusLabel={projectStatusLabel(project.status)} />
          ) : null}
        </div>
      </div>
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
