import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { KindBadge, PriorityBadge, ProjectStatusBadge } from "@/components/projects/badges";
import { ProjectTabs, type ProjectTab } from "@/components/projects/project-tabs";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { createClient } from "@/lib/supabase/server";

/**
 * One project. Members and founders get every section; a person who can only see the summary (a Projects-access holder who is not a
 * member, or a linked Sales person) gets the summary page and no tabs: the details, discussion, plans and files are not theirs.
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  const { project } = view;

  let unread: string | null = null;
  if (view.level === "details") {
    const supabase = await createClient();
    const { data } = await supabase.rpc("proj_unread_counts");
    const row = (data ?? []).find((r) => r.project_id === id);
    if (row && row.unread > 0) unread = row.unread > 99 ? "99+" : String(row.unread);
  }
  const base = `/projects/${id}`;
  const tabs: ProjectTab[] =
    view.level === "details"
      ? [
          { href: base, label: "Overview" },
          { href: `${base}/work`, label: "Milestones & tasks" },
          { href: `${base}/timeline`, label: "Timelines & site" },
          { href: `${base}/calendar`, label: "Calendar" },
          { href: `${base}/people`, label: "People" },
          { href: `${base}/discussion`, label: "Discussion", badge: unread },
          { href: `${base}/changes`, label: "Feedback & changes" },
          { href: `${base}/documents`, label: "Documents" },
          { href: `${base}/history`, label: "History" },
        ]
      : [];

  return (
    <div className="space-y-5">
      <div>
        <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All projects
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <ProjectStatusBadge status={project.status} />
          <PriorityBadge priority={project.priority} />
          <KindBadge kind={project.kind} ongoing={project.is_ongoing} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {project.reference} · {view.companyName} · Project Manager {view.pmName}
        </p>
      </div>
      {view.level === "summary" ? (
        <Alert role="status">
          You can see this project&apos;s summary only. Its details, tasks, discussion and files are for the people working on it
          {view.standing.isSalesLinked ? ": the Project Manager can add you to it if you should take part" : ": the Project Manager can add you if you should take part"}.
        </Alert>
      ) : (
        <ProjectTabs tabs={tabs} />
      )}
      {children}
    </div>
  );
}
