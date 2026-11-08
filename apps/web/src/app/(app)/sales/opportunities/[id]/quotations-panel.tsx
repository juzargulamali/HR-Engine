import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LoadError } from "@/components/workspace/states";
import { formatDate } from "@/components/sales/format";
import { ActionForm } from "@/components/sales/action-form";
import { createQuotation } from "@/lib/actions/quotations";
import { loadQuotationList, type QuotationListItem } from "@/lib/crm/quotations/data";
import { QUOTATION_STATE_LABEL, quotationState } from "@/lib/crm/quotations/model";
import { Muted, Panel } from "./parts";
import { money } from "./quotations/[proposalId]/money";
import type { OppView } from "./view";

/**
 * "Estimates": priced bills of quantities built in the app. Each one IS a proposal row (its approval and numbering are the existing ones) but never an
 * official quotation: finalising only freezes it. Shown here with its reference and revision. Only the enquiry owner or a founder can start or edit one.
 */
export async function QuotationsPanel({ view }: { view: OppView }) {
  const { detail, opp, canEdit, isOpen } = view;
  let items: QuotationListItem[];
  try {
    items = await loadQuotationList(opp.id, detail.proposals);
  } catch {
    return <LoadError what="the estimates" retryHref={`/sales/opportunities/${opp.id}?tab=quotations`} />;
  }
  const pendingBy = new Set(detail.approvals.filter((a) => a.state === "pending").map((a) => a.proposal_id));
  return (
    <div className="space-y-6">
      <Panel title="Estimates" description="Build the priced estimate here, then finalise it. Finalising makes a frozen copy; nothing is sent to the client from this screen, and nothing is reserved or promised.">
        {items.length === 0 ? <Muted>No estimate yet.{canEdit && isOpen ? " Start one below." : ""}</Muted> : (
          <ul className="divide-y divide-border/70">
            {items.map(({ header, proposal, totalGross }) => {
              const state = quotationState(header, proposal.status, pendingBy.has(proposal.id));
              return (
                <li key={proposal.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                  <FileSpreadsheet className="h-4 w-4" aria-hidden />
                  <Link href={`/sales/opportunities/${opp.id}/quotations/${proposal.id}`} className="text-sm font-semibold underline-offset-2 hover:underline">{header.reference} · revision {header.revision}</Link>
                  <Badge variant={state === "issued" ? "success" : state === "superseded" ? "secondary" : "warning"}>{QUOTATION_STATE_LABEL[state]}</Badge>
                  {proposal.status === "sent" || proposal.status === "accepted" ? <Badge variant="outline">{proposal.status === "sent" ? "Recorded as sent" : "Accepted"}</Badge> : null}
                  <span className="text-sm text-muted-foreground">
                    {header.issue_date ? `finalised ${formatDate(header.issue_date)}` : `updated ${formatDate(header.content_changed_at)}`}{totalGross && header.currency ? ` · ${money(totalGross, header.currency)} incl. VAT` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {canEdit && isOpen ? (
        <Panel title="New estimate" description="Starts a draft with a new reference. Everything can stay incomplete until you finalise it.">
          <ActionForm action={createQuotation} submitLabel="Create draft estimate" pendingLabel="Creating…">
            <input type="hidden" name="opportunityId" value={opp.id} />
          </ActionForm>
        </Panel>
      ) : !canEdit && isOpen ? <Muted>Only the owner ({view.ownerName}) or a founder can start or change estimates.</Muted> : null}
    </div>
  );
}
