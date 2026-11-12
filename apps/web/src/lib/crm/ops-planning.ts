/**
 * Operations planning on an enquiry (20270102000100_ops_phase2b.sql sections 2 and 3). Two halves that must never be confused:
 *   - what SALES tells Operations: the planning fields on the enquiry itself (crm_opportunities.ops_*), written only through crm_set_ops_planning;
 *   - what OPERATIONS recorded: one row per flagged enquiry, read here through crm_ops_planning.
 * This file is pure (no database client), so the client forms and the server panel share one set of labels.
 */

/** The teams Sales may tick, in the order they are offered. Mirrors the crm_opportunities_ops_shape check. */
export const OPS_TEAMS = ["engineering", "content", "programming", "installation", "warehouse"] as const;
export type OpsTeam = (typeof OPS_TEAMS)[number];
export const OPS_TEAM_LABELS: Record<OpsTeam, string> = { engineering: "Engineering", content: "Content", programming: "Programming", installation: "Installation", warehouse: "Warehouse" };
/** A team the screen does not know is shown as stored rather than dropped. */
export const opsTeamLabel = (team: string) => OPS_TEAM_LABELS[team as OpsTeam] ?? team;

export const OPS_TEXT_MAX = 1000;

export type OpsRisk = "unknown" | "low" | "medium" | "high";
export const OPS_RISK_LABELS: Record<OpsRisk, string> = { unknown: "Not assessed", low: "Low", medium: "Medium", high: "High" };

/** What Operations recorded against a flagged enquiry: the shape crm_ops_planning returns. */
export interface OpsPlanningFromOperations {
  provisionalPm: string | null;
  risk: OpsRisk;
  riskNote: string | null;
  capacityConflict: boolean;
  capacityNote: string | null;
  question: string | null;
  questionAt: string | null;
  questionBy: string | null;
  answer: string | null;
  answeredAt: string | null;
}

/**
 * The read of Operations' half, three different things that must never look alike: it loaded and there is a row, it loaded and Operations has recorded
 * nothing yet (null), or it could NOT be loaded. A failed read is never shown as "nothing from Operations".
 */
export type OpsPlanningRead = { kind: "ok"; planning: OpsPlanningFromOperations | null } | { kind: "failed" };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** crm_ops_planning's jsonb -> the typed shape. Anything that is not an object is "nothing recorded". */
export function parseOpsPlanning(raw: unknown): OpsPlanningFromOperations | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const risk = typeof r.risk === "string" && r.risk in OPS_RISK_LABELS ? (r.risk as OpsRisk) : "unknown";
  return {
    provisionalPm: text(r.provisional_pm), risk, riskNote: text(r.risk_note), capacityConflict: r.capacity_conflict === true, capacityNote: text(r.capacity_note),
    question: text(r.question), questionAt: text(r.question_at), questionBy: text(r.question_by), answer: text(r.answer), answeredAt: text(r.answered_at),
  };
}

export const OPS_DATES_TENTATIVE = "Dates are tentative";
export const OPS_DATES_CONFIRMED = "Dates confirmed";
export const OPS_DATES_WON = "Confirmed: this enquiry is won";

/** A won enquiry is confirmed whatever the tick says: the win is the confirmation, and Operations must not read a stale "tentative" beside it. */
export const opsDatesText = (stage: string, tentative: boolean | null | undefined): string =>
  stage === "won" ? OPS_DATES_WON : tentative === false ? OPS_DATES_CONFIRMED : OPS_DATES_TENTATIVE;

export const OPS_NOT_FLAGGED = "Operations cannot see this enquiry until it is flagged. Prices, quotes and notes are never shown to Operations.";
export const OPS_PROVISIONAL_NOTE = "Provisional. No project, crew or stock is booked by this.";
export const OPS_READ_FAILED = "What Operations recorded could not be loaded. This does not mean Operations has recorded nothing. Reload the page to try again.";
export const OPS_NOTE_HINT = "Operations can read this note. Do not put prices or commercial terms here.";
export const OPS_READS_FROM_ENQUIRY =
  "Operations also reads these from the enquiry itself: the location, the installation and event dates, the technologies and quantities, and the linked event edition. Keep them up to date with Edit details. Prices, quotes and notes are never shown to Operations.";
export const OPS_UNAVAILABLE =
  "Operations planning is not available yet, so nothing was saved. Trying again will not help until a required database update is installed. Ask the system owner to complete the Operations database update.";
