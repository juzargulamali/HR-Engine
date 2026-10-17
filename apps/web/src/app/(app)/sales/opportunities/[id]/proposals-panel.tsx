import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/components/sales/format";
import { fileDisplayName, PROPOSAL_STATUS_LABELS, proposalActions } from "./helpers";
import { Muted, Panel } from "./parts";
import { AddProposalForm, ProposalStatusButton } from "./proposal-forms";
import type { OppView } from "./view";

/**
 * Proposal versions: built elsewhere (Canva, Word…) and kept here as a recorded file or link. "Sent" is a dated fact
 * entered by the owner, never an approval; "accepted" is the client's acceptance, never the win itself.
 */
export function ProposalsPanel({ view }: { view: OppView }) {
  const { detail, ctx, opp, canEdit, isOpen, policy } = view;
  const filesById = new Map(detail.files.map((f) => [f.id, f]));
  const latestApproval = detail.approvals[0] ?? null;
  const nextVersion = (detail.proposals[0]?.version ?? 0) + 1; // newest first
  const linkedIds = new Set(detail.proposals.map((p) => p.file_id).filter((x): x is string => !!x));
  const fileOptions = detail.files.filter((f) => !linkedIds.has(f.id)).sort((a, b) => Number(b.purpose === "proposal") - Number(a.purpose === "proposal")).map((f) => ({ id: f.id, label: `${fileDisplayName(f)}${f.purpose === "proposal" ? "" : ` (${f.purpose.replace("_", " ")})`}` }));
  const sentOrAccepted = (s: string) => s === "sent" || s === "accepted";
  const latestSentId = detail.proposals.find((p) => sentOrAccepted(p.status))?.id ?? null;
  return (
    <div className="space-y-6">
      <Panel title="Proposal versions" description="Newest first. The version number is assigned automatically.">
        {detail.proposals.length === 0 ? (
          <Muted>No proposal recorded yet.{canEdit && isOpen ? " Add the first version below once you have the document." : ""}</Muted>
        ) : (
          <ul className="divide-y divide-border/70">
            {detail.proposals.map((p) => {
              const file = p.file_id ? filesById.get(p.file_id) : undefined;
              const actions = canEdit ? proposalActions(p, opp.stage) : { send: false, accept: false, supersede: false };
              const unapproved = policy === "required" && p.id === latestSentId && latestApproval?.state !== "approved";
              return (
                <li key={p.id} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold"><FileText className="h-4 w-4" aria-hidden /> Version {p.version}</p>
                    <Badge variant={p.status === "accepted" ? "success" : p.status === "superseded" ? "secondary" : "outline"}>{PROPOSAL_STATUS_LABELS[p.status]}</Badge>
                    {p.id === latestSentId ? <Badge variant="outline">Latest sent</Badge> : null}
                  </div>
                  {p.note ? <p className="break-words text-sm">{p.note}</p> : null}
                  <p className="break-words text-xs text-muted-foreground">
                    {file ? `Document: ${fileDisplayName(file)}` : "No document linked"} · added by {ctx.personName(p.created_by)} on {formatDate(p.created_at)}
                    {p.sent_on ? ` · recorded as sent on ${formatDate(p.sent_on)}` : ""}
                  </p>
                  {unapproved ? <p className="text-xs text-warning">No founder approval on record for this opportunity. Recording a proposal as sent is not an approval.</p> : null}
                  {actions.send || actions.accept || actions.supersede ? (
                    <div className="flex flex-wrap gap-1.5">
                      {actions.send ? <ProposalStatusButton proposalId={p.id} opportunityId={opp.id} version={p.version} status="sent" /> : null}
                      {actions.accept ? <ProposalStatusButton proposalId={p.id} opportunityId={opp.id} version={p.version} status="accepted" /> : null}
                      {actions.supersede ? <ProposalStatusButton proposalId={p.id} opportunityId={opp.id} version={p.version} status="superseded" /> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {canEdit && isOpen ? (
        <Panel title={`Add version ${nextVersion}`} description="Records a new draft. Nothing is sent to the client from here.">
          <AddProposalForm opportunityId={opp.id} nextVersion={nextVersion} files={fileOptions} />
        </Panel>
      ) : !canEdit && isOpen ? (
        <Muted>Only the owner ({view.ownerName}) or a founder can add or change proposal versions.</Muted>
      ) : null}
    </div>
  );
}
