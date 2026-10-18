import { CRM_ALLOWED_FILE_SUMMARY, canRemoveFile } from "@enginious-hr/domain";
import { FileText, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatFileSize } from "@/components/sales/format";
import { AddFileForms } from "./file-forms";
import { fileDisplayName, filePurposeLabel, filePurposeNote, isHttpsUrl } from "./helpers";
import { Muted, Panel } from "./parts";
import { OpenFileButton, RemoveFileButton } from "./quick-actions";
import type { OppView } from "./view";

/** Files and links on this opportunity. Files are private: opening one asks for a short-lived link each time. */
export function FilesPanel({ view }: { view: OppView }) {
  const { detail, ctx, opp, isLost } = view;
  const ref = { companyId: opp.company_id, ownerId: opp.owner_id };
  const proposalFileIds = new Map(detail.proposals.filter((p) => p.file_id).map((p) => [p.file_id as string, p.version]));
  return (
    <Panel title="Files and links" description="Proposals, purchase orders, authorised emails and the client's brief.">
      {detail.files.length === 0 ? (
        <Muted>No files or links yet.</Muted>
      ) : (
        <ul className="divide-y divide-border/70">
          {detail.files.map((f) => {
            const name = fileDisplayName(f);
            const note = filePurposeNote(f.purpose);
            const version = proposalFileIds.get(f.id);
            return (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-1 gap-2.5">
                  {f.kind === "file" ? <FileText className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden /> : <Link2 className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden />}
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{f.kind === "link" ? "Link" : "File"}</Badge>
                      <Badge variant="secondary">{filePurposeLabel(f.purpose)}</Badge>
                      {version ? <Badge variant="outline">Proposal version {version}</Badge> : null}
                    </div>
                    {note ? <p className="mt-1 text-xs text-muted-foreground">{note}{f.purpose !== "proposal" ? ". Adding it does not by itself make the opportunity Won." : "."}</p> : null}
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {f.kind === "file" && f.original_name && f.label ? `${f.original_name} · ` : ""}
                      {formatFileSize(f.size_bytes)}{f.size_bytes != null ? " · " : ""}added by {ctx.personName(f.uploaded_by)} on {formatDate(f.created_at)}
                    </p>
                    {f.kind === "link" && f.url ? <p className="mt-0.5 break-all text-xs text-muted-foreground">{f.url}</p> : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-1.5">
                  {f.kind === "file" ? <OpenFileButton fileId={f.id} name={name} /> : isHttpsUrl(f.url) ? (
                    <a href={f.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name} (opens in a new tab)`} className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:border-accent/60 hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open link</a>
                  ) : null}
                  {canRemoveFile(ctx.grants, { uploadedBy: f.uploaded_by }, ref, ctx.userId) && !isLost ? <RemoveFileButton fileId={f.id} name={name} isLink={f.kind === "link"} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {isLost ? (
        <Muted className="mt-4">A lost opportunity can no longer be updated, so nothing can be added.</Muted>
      ) : (
        <div className="mt-5 border-t border-border/70 pt-4">
          <h3 className="mb-2 text-sm font-semibold">Add a file or link</h3>
          <p className="mb-3 text-xs text-muted-foreground">Allowed: {CRM_ALLOWED_FILE_SUMMARY}. Executables and macro-enabled files are refused. Choose what it is so the history can tell a proposal from a purchase order.</p>
          <AddFileForms opportunityId={opp.id} />
        </div>
      )}
    </Panel>
  );
}
