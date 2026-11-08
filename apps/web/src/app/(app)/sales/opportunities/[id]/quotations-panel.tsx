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
 * "Estimates & Quotations": priced bills of quantities built in the app. Each one IS a proposal version (same status, same approval, same
 * numbering), shown here with its reference and revision. Only the enquiry owner or a founder can start or edit one.
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
      <Panel title="Estimates & Quotations" description="Build the priced estimate here, then issue it. Issuing makes a frozen copy; nothing is sent to the client from this screen.">
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
                    {header.issue_date ? `issued ${formatDate(header.issue_date)}` : `updated ${formatDate(header.content_changed_at)}`}{totalGross && header.currency ? ` · ${money(totalGross, header.currency)} incl. VAT` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {canEdit && isOpen ? (
        <Panel title="New estimate" description="Starts a draft with a new reference and your company's standard terms. Everything can stay incomplete until you issue it.">
          <ActionForm action={createQuotation} submitLabel="Create draft estimate" pendingLabel="Creating…">
            <input type="hidden" name="opportunityId" value={opp.id} />
          </ActionForm>
        </Panel>
      ) : !canEdit && isOpen ? <Muted>Only the owner ({view.ownerName}) or a founder can start or change estimates.</Muted> : null}
    </div>
  );
}
