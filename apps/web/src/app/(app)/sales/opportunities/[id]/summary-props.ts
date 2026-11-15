import { canActOnFollowUp, crmAllowedMoves, crmStageLabel } from "@enginious-hr/domain";
import { isOnlyOpenFollowUp, planNextProps, stageMoveRequirement } from "./helpers";
import type { PrimaryAction } from "./primary-action";
import { toEditable } from "./scope-panel";
import type { MoveOption } from "./stage-actions";
import type { SummaryActionsProps } from "./summary-actions";
import { anyFailed, planNextInput, type OppView } from "./view";

export const MOVES_NOT_OFFERED = "Not offered: the proposals or Zoho references could not be loaded.";
export const REOPEN_NOT_OFFERED = "Not offered: the handover record could not be loaded.";

/**
 * The stage moves this person may make now, each with what the database still requires first (stageMoveRequirement mirrors crm_move_stage). When the facts
 * those requirements are read from (proposals, Zoho references) could not be loaded, no move is offered and the menu says why:
 * the hints would otherwise be wrong. Null for someone who may not move the stage at all.
 */
export function stageMoves(view: OppView): { options: MoveOption[] } | { unavailable: string } | null {
  const { opp, detail, canEdit, isActive } = view;
  if (!canEdit || !isActive) return null;
  if (anyFailed(view, "proposals", "zoho")) return { unavailable: MOVES_NOT_OFFERED };
  const facts = {
    hasSentProposal: detail.proposals.some((p) => p.status === "sent" || p.status === "accepted"),
    hasQuoteRef: !!detail.zoho?.quote_ref?.trim(),
  };
  return { options: crmAllowedMoves(opp.stage).map((to) => ({ id: to, label: crmStageLabel(to), requirement: stageMoveRequirement(to, facts) })) };
}

/** Whether the signed-in person may complete or reschedule the next follow-up (its assignee, the enquiry's owner or a founder; the database repeats it). */
export function canActOnNext(view: OppView): boolean {
  const next = view.nextFollowUp;
  if (!next || anyFailed(view, "followUps")) return false;
  return canActOnFollowUp(view.ctx.grants, { assignedTo: next.assigned_to }, { companyId: view.opp.company_id, ownerId: view.opp.owner_id }, view.ctx.userId);
}

/** The data behind the summary's buttons: the same permission view as every tab, so the top of the page and the tabs offer exactly the same things. */
export function buildSummaryActions(view: OppView, primary: PrimaryAction | null): SummaryActionsProps {
  const { opp, detail, ctx, canEdit, isActive, isHold, isOpen, isWon, isLost } = view;
  const followUpsFailed = anyFailed(view, "followUps");
  const next = view.nextFollowUp;
  const availability = detail.item.availability;
  return {
    opportunityId: opp.id, version: opp.version, stage: opp.stage, primary,
    followUp: next && canActOnNext(view) ? { id: next.id, title: next.title, opportunityId: opp.id, isOnlyOpen: isOnlyOpenFollowUp(detail.followUps, next.id, opp.stage), timeZone: view.timeZone } : null,
    // Adding a follow-up and logging an activity both depend on the follow-ups (the form can complete one and plans the next): not offered when they could not be read.
    newFollowUp: isOpen && !followUpsFailed ? { people: view.people, canAssign: canEdit || view.canAssign, currentUserId: ctx.userId, timeZone: view.timeZone } : null,
    log: !isLost && !followUpsFailed ? planNextProps(planNextInput(view)) : null,
    move: stageMoves(view),
    canHold: canEdit && isActive,
    resume: canEdit && isHold ? { returnsTo: opp.stage_before_hold, timeZone: view.timeZone } : null,
    close: canEdit && isOpen ? { won: isActive, lost: true } : null,
    edit: view.editMode ? { data: toEditable(view), mode: view.editMode, availabilityWillNeedRecheck: availability === "confirmed" || availability === "unavailable" } : null,
    assign: view.canAssign && isOpen ? { currentOwnerId: opp.owner_id, currentOwnerName: view.ownerName, people: view.people } : null,
    reopen: view.canReopen ? (anyFailed(view, "handover") ? { unavailable: REOPEN_NOT_OFFERED } : { outcome: isWon ? "won" : "lost", stageBeforeClose: opp.stage_before_close, timeZone: view.timeZone, hasHandover: !!detail.handover }) : null,
    handoverHref: isWon ? `/sales/opportunities/${opp.id}/handover` : null,
  };
}
