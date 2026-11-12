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
import { completionReadState } from "./complete-helpers";

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
  const [reviewRes, evidenceRes] = await Promise.all([
    supabase.rpc("proj_completion_review", { p_project_id: id }),
    supabase.from("proj_files").select("id, label, original_name, created_at").eq("project_id", id).eq("purpose", "completion_evidence").is("deleted_at", null).order("created_at", { ascending: false }),
  ]);
  // Three different answers, never folded together: the read worked (possibly with nothing in it), the database refused this person, or the read failed.
  const reviewState = completionReadState(reviewRes.error);
  if (reviewState === "denied") {
    return (
      <div className="space-y-4">
        <PageHeader title="Complete project" />
        <Alert role="status" data-testid="completion-denied">You do not have access to this project&apos;s completion review, so it cannot be completed from your account. The Project Manager is {view.pmName}. This is an access decision, not a loading problem: reloading will not change it.</Alert>
      </div>
    );
  }
  if (reviewRes.error) console.error("[projects] completion review load failed", reviewRes.error.message);
  if (evidenceRes.error) console.error("[projects] completion evidence load failed", evidenceRes.error.message);

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
          items={reviewRes.data ?? []}
          evidenceFiles={(evidenceRes.data ?? []).map((f) => ({ id: f.id, label: f.label || f.original_name || "Untitled file" }))}
          reviewFailed={reviewState === "failed"}
          evidenceFailed={!!evidenceRes.error}
          today={todayIso()}
        />
      </Panel>
      <Muted>The database checks all of this again when you complete the project, and tells you in words if anything is missing.</Muted>
      <Muted>
        Preparing the internal closeout report is separate from completing the project and can be done before or after: <Link href={`/projects/${id}/closeout`} className="text-accent underline-offset-4 hover:underline" data-testid="closeout-entry">Generate closeout report</Link>.
      </Muted>
    </div>
  );
}
