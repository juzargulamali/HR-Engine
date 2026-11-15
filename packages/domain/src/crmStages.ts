/**
 * Sales pipeline stages. Ids are stable (stored in the database and in reports); labels are display text and may be
 * renamed without changing history. Mirrors crm_stage_index / crm_move_stage (supabase/migrations/20270111000200_crm_retire_estimate_sent_stage.sql).
 *
 * `estimate_sent` is a RETIRED stage (2027-01-11): nobody can be moved into it any more. Sending an estimate is a recorded fact about one estimate revision
 * (`crm_estimate_sends`, "Record as sent" on the Estimates tab) and no longer a place in the pipeline. The id stays in `CRM_STAGE_IDS` because history lines
 * mention it and an enquiry whose earlier stage could not be worked out from its records may still hold it until a person moves it on: such an enquiry is still
 * open, still needs a next action and can be moved out (never in).
 */
export const CRM_STAGE_IDS = ["new", "qualified", "proposal_prep", "proposal_sent", "estimate_sent", "quote_sent", "negotiation", "on_hold", "won", "lost"] as const;
export type CrmStageId = (typeof CRM_STAGE_IDS)[number];

/** The stages an enquiry can be put in today (filters, lanes and move targets are built from this list). */
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

/** Stages that were removed from the pipeline. They are never offered as a target; their label says so wherever history or an enquiry still shows one. */
export const CRM_RETIRED_STAGES: { id: CrmStageId; label: string; open: boolean }[] = [{ id: "estimate_sent", label: "Estimate sent (stage no longer used)", open: true }];
export const isCrmRetiredStage = (stage: string | null | undefined): boolean => CRM_RETIRED_STAGES.some((s) => s.id === stage);

/** The working stages (everything open except On hold), in the order the board shows them. A retired stage is not one of them. */
export const CRM_PIPELINE_STAGES: CrmStageId[] = ["new", "qualified", "proposal_prep", "proposal_sent", "quote_sent", "negotiation"];
/** Every stage id an open, not-held enquiry can HOLD in the database: the working stages plus the retired one. Use this for reads, so no enquiry is left out. */
export const CRM_WORKING_STAGE_IDS: CrmStageId[] = [...CRM_PIPELINE_STAGES, ...CRM_RETIRED_STAGES.map((s) => s.id)];

/**
 * The step a working stage is at (crm_stage_index in the database). The retired Estimate sent keeps the step it had (4, beside Proposal sent) so an enquiry still
 * holding it can be moved out by the same rule as any other. null for On hold, Won, Lost and anything unknown.
 */
const STAGE_STEP: Record<string, number> = { new: 1, qualified: 2, proposal_prep: 3, proposal_sent: 4, estimate_sent: 4, quote_sent: 5, negotiation: 6 };
export const crmStageStep = (stage: string): number | null => STAGE_STEP[stage] ?? null;

export const crmStageLabel = (id: string): string => (CRM_STAGES.find((s) => s.id === id) ?? CRM_RETIRED_STAGES.find((s) => s.id === id))?.label ?? id;
export const isCrmClosed = (stage: string) => stage === "won" || stage === "lost";
export const isCrmOpen = (stage: string) => !isCrmClosed(stage);
/** Open, not on hold: needs a next action at all times. True for an enquiry still holding the retired stage too (it is open and must not be forgotten). */
export const isCrmActive = (stage: string) => crmStageStep(stage) !== null;

/**
 * Plain stage moves: one step back or any step forward within the working stages. The retired Estimate sent is never a target; an enquiry still holding it
 * can go to Proposal preparation, Proposal sent, Quote sent or Negotiation (the database checks the evidence each "sent" stage needs). On hold, Won and Lost
 * are never plain moves (they carry a reason or evidence), and a held or closed opportunity does not move. Mirrors crm_move_stage
 * (supabase/migrations/20270111000200_crm_retire_estimate_sent_stage.sql).
 */
export function crmAllowedMoves(from: string): CrmStageId[] {
  const step = crmStageStep(from);
  if (step === null) return [];
  return CRM_PIPELINE_STAGES.filter((s) => s !== from && STAGE_STEP[s]! >= step - 1);
}

export const CRM_SOURCES: { id: string; label: string }[] = [
  { id: "agency_call", label: "Agency call (outbound)" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "direct_client", label: "Direct client" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "website", label: "Website enquiry" },
  { id: "referral", label: "Referral" },
  // Raised from the Sales team's own outreach to an account (the Outreach section's "Create enquiry" chooses it; it can also be chosen by hand).
  { id: "outreach", label: "Outreach" },
  { id: "other", label: "Other" },
];
export const crmSourceLabel = (id: string) => CRM_SOURCES.find((s) => s.id === id)?.label ?? id;

export const CRM_LOST_REASONS = ["Budget lower than scope", "Went with another supplier", "Event cancelled", "Timeline not feasible", "Technology not available", "No response from client"] as const;
export const CRM_HOLD_REASONS = ["Client postponed event", "Waiting for venue confirmation", "Waiting for client budget approval", "Internal capacity", "Other (note required)"] as const;

export const CRM_EVIDENCE_TYPES = [
  { id: "purchase_order", label: "Purchase order" },
  { id: "authorised_email", label: "Authorised email" },
] as const;
