/**
 * Sales pipeline stages. Ids are stable (stored in the database and in reports); labels are display text and may be
 * renamed without changing history. Mirrors crm_stage_index / crm_move_stage in
 * supabase/migrations/20261115000200_crm_workflow_functions.sql.
 */
export const CRM_STAGE_IDS = ["new", "qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"] as const;
export type CrmStageId = (typeof CRM_STAGE_IDS)[number];

export const CRM_STAGES: { id: CrmStageId; label: string; open: boolean }[] = [
  { id: "new", label: "New enquiry", open: true },
  { id: "qualified", label: "Qualified", open: true },
  { id: "proposal_prep", label: "Proposal preparation", open: true },
  { id: "proposal_sent", label: "Proposal sent", open: true },
  { id: "estimate_sent", label: "Estimate sent", open: true },
  { id: "quote_sent", label: "Quote sent", open: true },
  { id: "negotiation", label: "Negotiation", open: true },
  { id: "on_hold", label: "On hold", open: true },
  { id: "won", label: "Won", open: false },
  { id: "lost", label: "Lost", open: false },
];

/**
 * The working stages (everything open except On hold), in the order the board shows them. Proposal sent and Estimate sent are ALTERNATIVE milestones at the same
 * level: an enquiry reaches either (or both, one after the other), each on its own recorded evidence, before Quote sent.
 */
export const CRM_PIPELINE_STAGES: CrmStageId[] = ["new", "qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation"];

/** The step a working stage is at (crm_stage_index in the database): Proposal sent and Estimate sent share step 4. null for On hold, Won, Lost and anything unknown. */
const STAGE_STEP: Record<string, number> = { new: 1, qualified: 2, proposal_prep: 3, proposal_sent: 4, estimate_sent: 4, quote_sent: 5, negotiation: 6 };
export const crmStageStep = (stage: string): number | null => STAGE_STEP[stage] ?? null;

export const crmStageLabel = (id: string): string => CRM_STAGES.find((s) => s.id === id)?.label ?? id;
export const isCrmClosed = (stage: string) => stage === "won" || stage === "lost";
export const isCrmOpen = (stage: string) => !isCrmClosed(stage);
/** Open, not on hold: needs a next action at all times. */
export const isCrmActive = (stage: string) => (CRM_PIPELINE_STAGES as string[]).includes(stage);

/**
 * Plain stage moves: one step back or any step forward within the working stages, and across between Proposal sent and Estimate sent (the same step). On hold,
 * Won and Lost are never plain moves (they carry a reason or evidence), and a held or closed opportunity does not move. Mirrors crm_move_stage
 * (supabase/migrations/20261228000100_crm_estimate_sent_stage.sql); the database also checks the evidence each "sent" stage needs.
 */
export function crmAllowedMoves(from: string): CrmStageId[] {
  const step = crmStageStep(from);
  if (step === null) return [];
  return CRM_PIPELINE_STAGES.filter((s) => s !== from && STAGE_STEP[s]! >= step - 1);
}

/** True when moving to Estimate sent from this stage would not be a step backwards (the "record estimate as sent" form offers the move only then). */
export const canAdvanceToEstimateSent = (stage: string): boolean => { const step = crmStageStep(stage); return step !== null && stage !== "estimate_sent" && step <= STAGE_STEP.estimate_sent!; };

export const CRM_SOURCES: { id: string; label: string }[] = [
  { id: "agency_call", label: "Agency call (outbound)" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "direct_client", label: "Direct client" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "website", label: "Website enquiry" },
  { id: "referral", label: "Referral" },
  { id: "other", label: "Other" },
];
export const crmSourceLabel = (id: string) => CRM_SOURCES.find((s) => s.id === id)?.label ?? id;

export const CRM_LOST_REASONS = ["Budget lower than scope", "Went with another supplier", "Event cancelled", "Timeline not feasible", "Technology not available", "No response from client"] as const;
export const CRM_HOLD_REASONS = ["Client postponed event", "Waiting for venue confirmation", "Waiting for client budget approval", "Internal capacity", "Other (note required)"] as const;

export const CRM_EVIDENCE_TYPES = [
  { id: "purchase_order", label: "Purchase order" },
  { id: "authorised_email", label: "Authorised email" },
] as const;
