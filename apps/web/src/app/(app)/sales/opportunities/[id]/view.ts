import { canAssignOwner, canConfirmAvailability, canDecideApproval, canEditOpportunity, isCrmActive, isCrmClosed, isCrmFounder, type ApprovalPolicy } from "@enginious-hr/domain";
import type { CrmContext } from "@/lib/crm/context";
import type { OpportunityDetail } from "@/lib/crm/data";
import type { CrmFollowUpRow, CrmOpportunityRow } from "@/types/crm";
import { approvalPolicyOf } from "./helpers";

/** Who may do what on this opportunity, decided once. The database repeats every rule; this only shapes what is offered. */
export interface OppView {
  detail: OpportunityDetail;
  ctx: CrmContext;
  opp: CrmOpportunityRow;
  ownerName: string;
  isOpen: boolean;
  isActive: boolean;
  isHold: boolean;
  isWon: boolean;
  isLost: boolean;
  /** Owner or founder: stage moves, hold/resume, close, proposals, Zoho references, availability and approval requests. */
  canEdit: boolean;
  isFounder: boolean;
  canAssign: boolean;
  canConfirm: boolean;
  canDecide: boolean;
  /** Which edit form applies: everything while open, only the value on a won opportunity (founders), nothing once lost. */
  editMode: "full" | "value" | null;
  policy: ApprovalPolicy;
  openFollowUps: CrmFollowUpRow[];
  nextFollowUp: CrmFollowUpRow | null;
  /** People who can own it: Sales staff of this opportunity's company. */
  people: { id: string; name: string }[];
}

export function buildOppView(ctx: CrmContext, detail: OpportunityDetail): OppView {
  const opp = detail.item.opp;
  const ref = { companyId: opp.company_id, ownerId: opp.owner_id };
  const canEdit = canEditOpportunity(ctx.grants, ref, ctx.userId);
  const isFounder = isCrmFounder(ctx.grants, opp.company_id);
  const isWon = opp.stage === "won";
  const isLost = opp.stage === "lost";
  const openFollowUps = detail.followUps.filter((f) => f.status === "open");
  return {
    detail, ctx, opp,
    ownerName: detail.item.ownerName,
    isOpen: !isCrmClosed(opp.stage),
    isActive: isCrmActive(opp.stage),
    isHold: opp.stage === "on_hold",
    isWon, isLost, canEdit, isFounder,
    canAssign: canAssignOwner(ctx.grants, opp.company_id),
    canConfirm: canConfirmAvailability(ctx.grants, opp.company_id),
    canDecide: canDecideApproval(ctx.grants, opp.company_id),
    editMode: isLost ? null : isWon ? (isFounder ? "value" : null) : canEdit ? "full" : null,
    policy: approvalPolicyOf(ctx.companies.find((c) => c.id === opp.company_id)?.settings),
    openFollowUps,
    nextFollowUp: openFollowUps[0] ?? null,
    people: ctx.people.filter((p) => p.companyIds.includes(opp.company_id)).map((p) => ({ id: p.id, name: p.name })),
  };
}
