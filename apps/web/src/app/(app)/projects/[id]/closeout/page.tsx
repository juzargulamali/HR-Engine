import { notFound } from "next/navigation";
import { CloseoutWorkspace } from "@/components/projects/closeout/closeout-workspace";
import { Muted, PageHeader } from "@/components/projects/parts";
import { Alert } from "@/components/ui/alert";
import { LoadError } from "@/components/workspace/states";
import { evidenceItems } from "@/lib/projects/closeout/evidence";
import { keyFacts, validateEdits, type ReportView } from "@/lib/projects/closeout/report";
import { loadEvidence, loadReports, providerAvailability, type CloseoutReportRow } from "@/lib/projects/closeout/service";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Closeout report" };
/** Writing a draft makes one provider call that can take most of a minute. */
export const maxDuration = 60;

/**
 * The Project Closeout Report: an INTERNAL report the Project Manager drafts from the project's own records, edits and approves as a version. It can be drafted before the
 * project is closed or written for a completed one. Only whoever manages the project sees this screen's content (the database refuses everyone else). Generating,
 * editing and approving never complete the project, approve work, send a message or change stock.
 */
export default async function CloseoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) notFound();
  const header = <PageHeader title="Closeout report" description="An internal report for the company, written from this project's records. You review what is used, edit the draft and approve a version before it can be downloaded." />;
  if (!view.canManage) {
    return <div className="space-y-5">{header}<Alert role="status" data-testid="closeout-denied">The closeout report is prepared by the Project Manager, someone holding temporary project leadership, or a founder. The Project Manager is {view.pmName}.</Alert></div>;
  }
  const db = await createClient();
  const [ev, reports] = await Promise.all([loadEvidence(db, id), loadReports(db, id)]);
  if (ev.state === "not_installed") return <div className="space-y-5">{header}<Alert role="status">The closeout report is not installed in this environment yet. Nothing else about this project is affected.</Alert></div>;
  if (ev.state === "denied") return <div className="space-y-5">{header}<Alert role="status" data-testid="closeout-denied">The closeout report is prepared by whoever manages this project. The Project Manager is {view.pmName}.</Alert></div>;
  if (ev.state === "error" || reports === null) return <div className="space-y-5">{header}<LoadError what="the closeout report" retryHref={`/projects/${id}/closeout`} /></div>;

  const items = evidenceItems(ev.snapshot);
  const toView = (r: CloseoutReportRow): ReportView => ({
    id: r.id, versionNo: r.version_no, status: r.status, version: r.version, generation: r.generation, snapshotAt: r.snapshot_at, approvedAt: r.approved_at,
    approvedBy: r.approved_by ? view.nameOf(r.approved_by) : null, facts: keyFacts(r.snapshot), missing: r.snapshot.missing ?? [],
    // A draft's marks are computed here from its text and its stored snapshot, never read from what was saved, so a saved copy cannot hide one.
    sections: r.status === "draft" ? validateEdits(r.sections, r.source_refs, r.snapshot, r.sections) ?? r.sections : r.sections, refs: r.source_refs,
    include: Array.isArray(r.selection?.include) ? r.selection.include : [],
  });
  const draft = reports.find((r) => r.status === "draft");
  return (
    <div className="space-y-5">
      {header}
      <Muted>{view.project.name} ({view.project.reference}). Status: {view.project.status.replace(/_/g, " ")}. The report is internal: sending anything to the client is a separate step that this screen does not do.</Muted>
      <CloseoutWorkspace projectId={id} items={items} team={ev.snapshot.team.map((m) => ({ name: m.name }))} missing={ev.snapshot.missing ?? []}
        defaultInclude={items.filter((x) => x.optional?.defaultOn).map((x) => x.optional!.key)}
        draft={draft ? toView(draft) : null} approved={reports.filter((r) => r.status === "approved").map(toView)} provider={providerAvailability()} />
    </div>
  );
}
