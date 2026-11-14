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
import { loadProjectBudgetAccess } from "@/lib/budget/data";
import { loadProjectView } from "@/lib/projects/data";
import { loadProjectChat, loadProjectUnread } from "@/lib/chat/data";
import { holdsOperationsRight } from "@/lib/chat/model";
import { ProjectChatButton } from "@/components/chat/project-chat-button";
import { dateRangeText, dateText } from "@/lib/projects/format";
import { handoverHref } from "@/lib/projects/handover-list";
import { manageItems, projectTabs } from "@/lib/projects/workspace-nav";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/workspace/list-memory";
import { LoadError } from "@/components/workspace/states";

/**
 * One project. Members and founders get a compact banner, three sections (Work, Timeline, Equipment), a fourth (Budget) for the people who may open it, a Chat button that opens the
 * project's group in the app-wide Chat panel (enrolled members only), and one "Manage project" menu for the rest; a person who can only see the summary (a Projects-access holder who is not a member, or a linked Sales person) gets
 * the summary page and neither: the details, discussion, plans and files are not theirs.
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  // A failed read is "could not load", never "not found" (that is only for a project that is absent or not visible).
  let view: Awaited<ReturnType<typeof loadProjectView>>;
  try {
    view = await loadProjectView(ctx, id);
  } catch (e) {
    console.error("[projects] project could not be loaded", e);
    return (
      <div className="space-y-4">
        <BackLink section="projects" fallback="/projects">All projects</BackLink>
        <LoadError what="this project" retryHref={`/projects/${id}`} />
      </div>
    );
  }
  if (!view) notFound();
  const { project, details } = view;

  // The project's conversation is its group in Chat. Only an enrolled member gets it (the database decides). On a database without project groups yet the old Discussion tab stays.
  // The database is asked only for someone it could let in (on the project's team, or Operations Manager of its company): for anyone else it would only refuse.
  const chat = view.level === "details" ? await loadProjectChat(id, view.standing.isMember || holdsOperationsRight(ctx.grants, project.company_id)) : { state: "not_member" as const };
  let discussion: { unread: string | null } | null = null;
  if (chat.state === "not_installed") {
    const supabase = await createClient();
    const { data } = await supabase.rpc("proj_unread_counts");
    const row = (data ?? []).find((r) => r.project_id === id);
    discussion = { unread: row && row.unread > 0 ? (row.unread > 99 ? "99+" : String(row.unread)) : null };
  }
  const chatUnread = chat.state === "ready" ? ((await loadProjectUnread())?.get(id) ?? 0) : 0;
  // The Budget tab: only where the module's own access rules let this person in (the Project Manager, or Finance / view access in the owning company).
  const budgetAccess = view.level === "details" ? await loadProjectBudgetAccess(id) : { can_open: false };
  // The accepted brief stays reachable from the project it created (one small read; row-level security decides whether this person may open it, and a failed or empty read just hides the link).
  let briefId: string | null = null;
  if (view.level === "details" && project.kind === "client") {
    try {
      const { data: hb } = await (await createClient()).from("proj_handovers").select("id").eq("project_id", id).eq("status", "accepted").limit(1);
      briefId = hb?.[0]?.id ?? null;
    } catch { briefId = null; }
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
      <BackLink section="projects" fallback="/projects">All projects</BackLink>
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
            {briefId ? <Link href={handoverHref(briefId)} className="font-medium text-white underline underline-offset-4" data-testid="project-accepted-brief">Accepted brief</Link> : null}
          </>
        }
      >
        {team.length > 0 ? <OsTeamStack names={team} /> : null}
        {chat.state === "ready" ? <ProjectChatButton groupId={chat.groupId} unread={chatUnread} className="border-white/30 text-white hover:bg-white/10" /> : null}
        {view.level === "details" ? (
          <ManageMenu projectId={id} projectName={project.name} items={items} editable={editable} moves={moves} currentStatusLabel={projectStatusLabel(project.status)} />
        ) : null}
      </OsHero>
      {view.level === "summary" ? (
        <Alert role="status">
          Summary only. Details, tasks, chat and files are for the people working on this project; the Project Manager can add you if you should take part.
        </Alert>
      ) : (
        <>
          <ProjectTabs tabs={projectTabs(base, discussion, budgetAccess.can_open)} base={base} />
          {chat.state === "not_member" && view.level === "details" ? <p className="text-[13px] text-muted-foreground" data-testid="project-chat-no-access">Project chat is open to the people on this project and to the company&apos;s Operations Managers. You can open this project but are not on its team, so its chat is not shown to you.</p> : null}
          {chat.state === "error" ? <Alert variant="warning" role="status">Could not check this project&apos;s chat, so its Chat button is missing here. The Chat button at the corner of the page still lists your groups. Reload to try again.</Alert> : null}
          {"loadFailed" in budgetAccess && budgetAccess.loadFailed ? <Alert variant="warning" role="status">Could not check budget access, so the Budget tab may be missing. Reload to try again.</Alert> : null}
        </>
      )}
      {children}
    </div>
  );
}
