import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { isFinishedProject, type IssuedPlanPayload } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Fact, Muted, Panel } from "@/components/projects/parts";
import { formatFileSize } from "@/components/sales/format";
import { getProjectsContext } from "@/lib/projects/context";
import { loadProjectView } from "@/lib/projects/data";
import { formatDate, formatDateTime, todayIso } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AddFileForms, FILE_PURPOSES, OpenFileButton, RemoveFileButton } from "./file-forms";
import { IssueTimelineForm, RecordAcceptedForm, RecordSentForm } from "./plan-forms";
import { PlanTable } from "./plan-table";

export const metadata = { title: "Documents" };

const purposeLabel = (id: string) => FILE_PURPOSES.find((p) => p.id === id)?.label.replace(" (Project Manager)", "") ?? id;

function Fact3({ label, recorded, children }: { label: string; recorded: boolean; children?: React.ReactNode }) {
  return (
    <Fact label={label}>
      {recorded ? <><Badge variant="outline" className="border-[hsl(var(--os-green)/0.4)] text-[hsl(var(--os-green))]">Recorded</Badge> <span className="ml-1">{children}</span></> : <span className="text-muted-foreground">Not recorded</span>}
    </Fact>
  );
}

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const view = await loadProjectView(ctx, id);
  if (!view) return null;
  if (view.level !== "details") redirect(`/projects/${id}`);
  const { project } = view;
  const supabase = await createClient();
  const finished = isFinishedProject(project.status);
  const isClient = project.kind === "client";

  const [filesRes, plansRes, outdatedRes, previewRes] = await Promise.all([
    supabase.from("proj_files").select("*").eq("project_id", id).is("deleted_at", null).order("created_at", { ascending: false }),
    isClient ? supabase.from("proj_issued_plans").select("*").eq("project_id", id).order("version", { ascending: false }) : Promise.resolve({ data: [] }),
    isClient ? supabase.rpc("proj_plan_outdated", { p_project_id: id }) : Promise.resolve({ data: null }),
    isClient && view.canManage ? supabase.rpc("proj_current_plan_payload", { p_project_id: id }) : Promise.resolve({ data: null }),
  ]);
  const files = filesRes.data ?? [];
  const plans = plansRes.data ?? [];
  const outdated = outdatedRes.data === true;
  const preview = (previewRes.data ?? null) as IssuedPlanPayload | null;
  const today = todayIso();
  const latest = plans.find((p) => !p.superseded_at) ?? null;

  return (
    <div className="space-y-6">
      <Panel title="Files and links" description="Private to this project's members and founders. Files are checked before they become available, and every download re-checks that you still have access.">
        {files.length === 0 ? (
          <EmptyState dense title="No files or links yet" description="Add the documents the team needs: briefs, drawings, confirmations. Commercial documents belong in Sales & CRM, not here." />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead>Added</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
              {files.map((f) => {
                const name = f.label || f.original_name || f.url || "Untitled";
                const mayRemove = !finished && (f.uploaded_by === ctx.userId || view.canManage);
                return (
                  <TableRow key={f.id}>
                    <TableCell className="min-w-48">
                      <p className="break-words font-medium">{name}</p>
                      <p className="text-[13px] text-muted-foreground">{f.kind === "link" ? "Link" : [f.original_name, formatFileSize(f.size_bytes)].filter(Boolean).join(" · ")}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="whitespace-nowrap">{purposeLabel(f.purpose)}</Badge>
                        {f.restricted ? <Badge variant="outline" className="whitespace-nowrap border-[hsl(var(--os-amber)/0.4)] text-[hsl(var(--os-amber))]">Restricted</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{view.nameOf(f.uploaded_by)}<br />{formatDateTime(f.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-start justify-end gap-1">
                        <OpenFileButton fileId={f.id} />
                        {mayRemove ? <RemoveFileButton fileId={f.id} label={name} /> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!finished ? (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-semibold">Add a file or a link</h3>
            <AddFileForms projectId={id} isManager={view.canManage} />
          </div>
        ) : <Muted className="mt-3">This project is completed, so files can no longer be added or removed.</Muted>}
      </Panel>

      <Panel
        title="Client timeline"
        description="The timeline the client sees: only the milestones, activities and dependencies the Project Manager marked client-facing. Issued versions are frozen."
        actions={isClient && view.canManage && !finished ? <IssueTimelineForm projectId={id} reference={project.reference} hasIssued={plans.length > 0} /> : null}
      >
        {!isClient ? (
          <Muted>Client timelines are for client projects. This is an internal project, so there is nothing to issue.</Muted>
        ) : (
          <div className="space-y-5">
            <Alert role="note">
              Downloading or generating a PDF sends nothing to anyone. “Issued”, “sent to the client” and “client accepted” are three separate facts, each recorded by a person. The timeline never contains internal tasks, discussions, staff notes, commercial figures or confidential attachments.
            </Alert>

            {view.canManage ? (
              <div>
                <h3 className="mb-2 text-sm font-semibold">What would be issued now</h3>
                {preview ? <PlanTable payload={preview} /> : <Muted>The preview is not available.</Muted>}
                <Muted className="mt-2">To change it, mark milestones, timeline activities and dependencies as client-facing on their own pages. Nothing is client-facing by default.</Muted>
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold">Issued versions</h3>
              {plans.length === 0 ? (
                <EmptyState dense title="No version has been issued" description={view.canManage ? "When the client-facing items are right, issue the timeline to freeze it as version 1." : "The Project Manager issues the client timeline when it is ready."} />
              ) : (
                <ul className="space-y-4">
                  {plans.map((p) => {
                    const isLatest = latest?.id === p.id;
                    return (
                      <li key={p.id} className="rounded-md border border-border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold">Version {p.version}</h4>
                          <Badge variant="outline" className="whitespace-nowrap">{p.client_reference}</Badge>
                          {p.superseded_at ? <Badge variant="outline" className="text-muted-foreground">Replaced by a newer version</Badge> : <Badge variant="outline" className="border-[hsl(var(--os-green)/0.4)] text-[hsl(var(--os-green))]">Latest</Badge>}
                          {isLatest && outdated ? <Badge variant="outline" className="border-[hsl(var(--os-amber)/0.4)] text-[hsl(var(--os-amber))]">Outdated: the plan has changed since</Badge> : null}
                          <a className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto")} href={`/projects/${id}/documents/plans/${p.id}/pdf`} target="_blank" rel="noopener noreferrer">
                            <Download className="h-3.5 w-3.5" aria-hidden /> Download PDF
                          </a>
                        </div>
                        {isLatest && outdated ? <Alert variant="warning" role="status" className="mt-3">The client-facing plan has changed since this version was issued, so the client may be looking at an outdated timeline. {view.canManage && !finished ? "Issue a new version when the changes are final." : "The Project Manager can issue a new version."}</Alert> : null}
                        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
                          <Fact3 label="Issued" recorded>{formatDateTime(p.issued_at)} by {view.nameOf(p.issued_by)}</Fact3>
                          <Fact3 label="Sent to the client" recorded={Boolean(p.sent_at)}>{p.sent_at ? `${formatDateTime(p.sent_at)}: ${p.sent_note ?? ""}` : null}</Fact3>
                          <Fact3 label="Accepted by the client" recorded={Boolean(p.accepted_on)}>{p.accepted_on ? `${formatDate(p.accepted_on)} by ${p.accepted_contact ?? "unnamed contact"}${p.accepted_note ? ` (${p.accepted_note})` : ""}` : null}</Fact3>
                        </dl>
                        {p.note ? <Muted className="mt-2">Note: {p.note}</Muted> : null}
                        {view.canManage && !finished ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {!p.sent_at ? <RecordSentForm projectId={id} planId={p.id} version={p.version} /> : null}
                            {!p.accepted_on && !p.superseded_at ? <RecordAcceptedForm projectId={id} planId={p.id} version={p.version} today={today} /> : null}
                          </div>
                        ) : null}
                        <details className="mt-3">
                          <summary className="cursor-pointer text-sm font-medium">Show this version as a table</summary>
                          <div className="mt-3"><PlanTable payload={p.payload as unknown as IssuedPlanPayload} /></div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
