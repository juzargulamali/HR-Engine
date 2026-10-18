import Link from "next/link";
import { redirect } from "next/navigation";
import { isFinishedProject } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Muted, PageHeader, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { CompleteClient } from "./complete-client";

export const metadata = { title: "Complete project" };

export default async function CompletePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) return null;
  if (view.level !== "details") redirect(`/projects/${id}`);
  const { project } = view;
  const kindWord = project.kind === "client" ? "client project" : "internal project";

  if (isFinishedProject(project.status)) {
    return (
      <div className="space-y-4">
        <PageHeader title="Complete project" />
        <Alert role="status">This {kindWord} is already {project.status}. Its completion record is on the <Link className="underline" href={`/projects/${id}/history`}>History</Link> tab. A founder can reopen it there if it was closed too early.</Alert>
      </div>
    );
  }
  if (!view.canManage) {
    return (
      <div className="space-y-4">
        <PageHeader title="Complete project" />
        <Alert role="status">Only the Project Manager, someone holding temporary project leadership, or a founder can complete a project. The Project Manager is {view.pmName}.</Alert>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: review }, { data: evidence }] = await Promise.all([
    supabase.rpc("proj_completion_review", { p_project_id: id }),
    supabase.from("proj_files").select("id, label, original_name, created_at").eq("project_id", id).eq("purpose", "completion_evidence").is("deleted_at", null).order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Complete project"
        description={project.kind === "client" ? "Completing a client project needs the client's confirmation and a decision on everything still open." : "Completing an internal project needs a decision on everything still open and the owner's note."}
      />
      <Panel title={`${project.name} (${project.reference})`} description="This is recorded in the project's history. A founder can reopen a completed project with a reason; the completion record stays.">
        <CompleteClient
          projectId={id}
          projectKind={project.kind}
          items={review ?? []}
          evidenceFiles={(evidence ?? []).map((f) => ({ id: f.id, label: f.label || f.original_name || "Untitled file" }))}
          today={todayIso()}
        />
      </Panel>
      <Muted>The database checks all of this again when you complete the project, and tells you in words if anything is missing.</Muted>
    </div>
  );
}
