import { crmStageLabel, CRM_PIPELINE_STAGES } from "@enginious-hr/domain";
import type { StageTransitionView } from "../protocol";

/**
 * Which stage moves JARVIS offers, derived from crm_move_stage (supabase/migrations/20261115000200_crm_workflow_functions.sql) and docs/enginious-os/modules/sales-pipeline-and-stages.md:
 *   the database allows, between the six working stages, one step back or any step forward, and gates two TARGETS on evidence (Proposal sent: a proposal recorded as sent or accepted;
 *   Quote sent: the Zoho Books quote reference). JARVIS is deliberately narrower: exactly ONE step in either direction, and a move INTO a gated stage only when its evidence is
 *   recorded (the database checks it again). On hold, Won, Lost, reopen and handover are never offered: they have their own forms, evidence and side effects.
 */
export const WORKING: readonly string[] = CRM_PIPELINE_STAGES;
export const NEVER_THROUGH_JARVIS = "Putting an enquiry on hold, marking it Won or Lost, reopening it and handing it over are not available through JARVIS: they need their own form, evidence and approval. Use the buttons on the enquiry page.";

export interface Evidence { proposalSent: boolean | "unknown"; zohoQuoteRef: boolean | "unknown" }

export function transitionsFrom(stage: string, ev: Evidence): StageTransitionView[] {
  const i = WORKING.indexOf(stage);
  return WORKING.filter((s) => s !== stage).map((to) => {
    const j = WORKING.indexOf(to);
    const base = { to, toLabel: crmStageLabel(to), direction: (i >= 0 && j < i ? "back" : "forward") as "forward" | "back" };
    if (i < 0) return { ...base, enabled: false, reason: `${crmStageLabel(stage)} enquiries cannot be moved like this. ${NEVER_THROUGH_JARVIS}` };
    if (Math.abs(j - i) !== 1) return { ...base, enabled: false, reason: j > i ? "That skips stages. JARVIS moves one step at a time (the enquiry page can skip forward)." : "Only one step back is allowed." };
    if (to === "proposal_sent" && ev.proposalSent !== true) return { ...base, enabled: false, reason: ev.proposalSent === "unknown" ? "Could not check whether a proposal is recorded as sent. Try again in a moment." : "Record a proposal as sent first (Proposals & files tab of the enquiry): a draft or an estimate does not count." };
    if (to === "quote_sent" && ev.zohoQuoteRef !== true) return { ...base, enabled: false, reason: ev.zohoQuoteRef === "unknown" ? "Could not check the Zoho Books quote reference. Try again in a moment." : "Record the Zoho Books quote reference first (Commercial tab of the enquiry)." };
    return { ...base, enabled: true, reason: null };
  });
}

/** The full table of moves for the documentation and its test: every (from, to) pair of the working stages, with evidence both present and absent for the gated ones. */
export function transitionTable(): { from: string; to: string; withEvidence: boolean; withoutEvidence: boolean; gate: string | null }[] {
  const rows: { from: string; to: string; withEvidence: boolean; withoutEvidence: boolean; gate: string | null }[] = [];
  for (const from of WORKING) for (const to of WORKING) {
    if (from === to) continue;
    const yes = transitionsFrom(from, { proposalSent: true, zohoQuoteRef: true }).find((t) => t.to === to)!.enabled;
    const no = transitionsFrom(from, { proposalSent: false, zohoQuoteRef: false }).find((t) => t.to === to)!.enabled;
    rows.push({ from, to, withEvidence: yes, withoutEvidence: no, gate: to === "proposal_sent" ? "a proposal recorded as sent" : to === "quote_sent" ? "the Zoho Books quote reference" : null });
  }
  return rows;
}

const WORDS: [string, RegExp][] = [
  ["proposal_sent", /\bproposal\s+sent\b/i], ["quote_sent", /\bquote\s+sent\b/i], ["proposal_prep", /\bproposal\s+(?:prep(?:aration)?|preparation)\b|\bprep\b/i],
  ["negotiation", /\bnegotiat\w*\b/i], ["qualified", /\bqualif\w*\b/i], ["new", /\bnew(?:\s+enquiry)?\b/i],
];
/** The stage a typed request names, or null. */
export function stageFromText(text: string): string | null {
  for (const [id, re] of WORDS) if (re.test(text)) return id;
  return null;
}
export const CLOSING_WORDS = /\b(?:won|lost|on\s+hold|hold|close[ds]?|closure|re-?open|resume|hand\s+(?:it\s+)?over|handover)\b/i;
