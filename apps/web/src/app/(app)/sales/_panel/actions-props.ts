import { crmAllowedMoves, crmStageLabel } from "@enginious-hr/domain";
import { formatMoney } from "@/components/sales/format";
import { stageMoveRequirement } from "../opportunities/[id]/helpers";
import { toEditable } from "../opportunities/[id]/scope-panel";
import type { OppView } from "../opportunities/[id]/view";
import type { EnquiryActionsProps } from "./enquiry-actions";

/** The More-menu data for one enquiry, from the same permission view the full page uses (so panel and page offer exactly the same things). */
export function buildEnquiryActions(view: OppView): EnquiryActionsProps {
  const { opp, detail, canEdit, isActive, isHold, isOpen, isWon } = view;
  const hasSentProposal = detail.proposals.some((p) => p.status === "sent" || p.status === "accepted");
  const hasQuoteRef = !!detail.zoho?.quote_ref?.trim();
  const moveOptions = canEdit && isActive ? crmAllowedMoves(opp.stage).map((to) => ({ id: to, label: crmStageLabel(to), requirement: stageMoveRequirement(to, { hasSentProposal, hasQuoteRef }) })) : null;
  const availability = detail.item.availability;
  return {
    opportunityId: opp.id,
    version: opp.version,
    stage: opp.stage,
    moveOptions,
    canHold: canEdit && isActive,
    resume: canEdit && isHold ? { returnsTo: opp.stage_before_hold } : null,
    close: canEdit && isOpen ? { won: isActive, lost: true, valueText: formatMoney(detail.item.value, opp.currency), hasValue: detail.item.value != null, openFollowUps: view.openFollowUps.length, onHold: isHold } : null,
    assign: view.canAssign && isOpen ? { currentOwnerId: opp.owner_id, currentOwnerName: view.ownerName, people: view.people } : null,
    reopen: view.canReopen ? { outcome: isWon ? "won" : "lost", stageBeforeClose: opp.stage_before_close, hasHandover: !!detail.handover } : null,
    edit: view.editMode ? { data: toEditable(view), mode: view.editMode, availabilityWillNeedRecheck: availability === "confirmed" || availability === "unavailable" } : null,
    handoverHref: isWon ? `/sales/opportunities/${opp.id}/handover` : null,
  };
}
