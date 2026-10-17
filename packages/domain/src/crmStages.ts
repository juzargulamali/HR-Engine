/**
 * Sales pipeline stages. Ids are stable (stored in the database and in reports); labels are display text and may be
 * renamed without changing history. Mirrors crm_stage_index / crm_move_stage in
 * supabase/migrations/20261115000200_crm_workflow_functions.sql.
 */
export const CRM_STAGE_IDS = ["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"] as const;
export type CrmStageId = (typeof CRM_STAGE_IDS)[number];

export const CRM_STAGES: { id: CrmStageId; label: string; open: boolean }[] = [
  { id: "new", label: "New enquiry", open: true },
  { id: "qualified", label: "Qualified", open: true },
  { id: "proposal_prep", label: "Proposal preparation", open: true },
  { id: "proposal_sent", label: "Proposal sent", open: true },
  { id: "quote_sent", label: "Quote sent", open: true },
  { id: "negotiation", label: "Negotiation", open: true },
  { id: "on_hold", label: "On hold", open: true },
  { id: "won", label: "Won", open: false },
  { id: "lost", label: "Lost", open: false },
];

/** The ordered working stages (everything open except On hold). */
export const CRM_PIPELINE_STAGES: CrmStageId[] = ["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation"];

export const crmStageLabel = (id: string): string => CRM_STAGES.find((s) => s.id === id)?.label ?? id;
export const isCrmClosed = (stage: string) => stage === "won" || stage === "lost";
export const isCrmOpen = (stage: string) => !isCrmClosed(stage);
/** Open, not on hold: needs a next action at all times. */
export const isCrmActive = (stage: string) => (CRM_PIPELINE_STAGES as string[]).includes(stage);

/**
 * Plain stage moves: one step back or any step forward within the working stages. On hold, Won and Lost are never
 * plain moves (they carry a reason or evidence), and a held or closed opportunity does not move.
 */
export function crmAllowedMoves(from: string): CrmStageId[] {
  const i = (CRM_PIPELINE_STAGES as string[]).indexOf(from);
  if (i < 0) return [];
  return CRM_PIPELINE_STAGES.filter((_, j) => j !== i && j >= i - 1);
}

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
