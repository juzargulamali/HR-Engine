import { notFound, redirect } from "next/navigation";
import { Panel } from "@/components/projects/parts";
import { SummaryPanel } from "@/components/projects/summary-panel";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Project" };

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  const { project, details } = view;

  // ---------------------------------------------------------------- Summary level: directory users and linked Sales
  if (view.level === "summary" || !details) {
    const supabase = await createClient();
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

  // Details level (members and founders): the old overview now lives in Work, next to the tasks. The address keeps working.
  redirect(`/projects/${id}/work`);
}
