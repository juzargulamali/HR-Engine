import { CRM_PIPELINE_STAGES, CRM_STAGES, crmAllowedMoves, crmStageLabel, isCrmActive } from "@enginious-hr/domain";
import { compareNullable, type SortState } from "@/components/workspace/url-state";
import type { OpportunityListItem } from "./data";
import { organisationLabel } from "./reports";

/**
 * Pure helpers for the Enquiries workspace (table and board). No React, no server-only imports, so they are unit tested.
 * Nothing here is a business rule: the database still decides every stage move, who may edit, and what is visible.
 */

// ---------------------------------------------------------------------------------------------------------------
// Table columns and sorting
// ---------------------------------------------------------------------------------------------------------------

export type EnquiryColumn = "enquiry" | "party" | "owner" | "stage" | "next" | "due" | "dates" | "value" | "source" | "availability" | "created" | "company";

export const ENQUIRY_COLUMNS: readonly { id: EnquiryColumn; label: string; required?: boolean }[] = [
  { id: "enquiry", label: "Enquiry", required: true },
  { id: "party", label: "Agency / client" },
  { id: "owner", label: "Owner" },
  { id: "stage", label: "Stage" },
  { id: "next", label: "Next action" },
  { id: "due", label: "Due" },
  { id: "dates", label: "Installation / show" },
  { id: "value", label: "Value" },
  { id: "source", label: "Source" },
  { id: "availability", label: "Equipment availability" },
  { id: "created", label: "Created" },
  { id: "company", label: "Company" },
];

export const ENQUIRY_ALL_COLUMNS: readonly EnquiryColumn[] = ENQUIRY_COLUMNS.map((c) => c.id);
export const ENQUIRY_DEFAULT_COLUMNS: readonly EnquiryColumn[] = ["enquiry", "party", "owner", "stage", "next", "due", "dates"];

export type EnquirySortKey = "enquiry" | "party" | "owner" | "stage" | "due" | "dates" | "value" | "created";
export const ENQUIRY_SORT_KEYS: readonly EnquirySortKey[] = ["enquiry", "party", "owner", "stage", "due", "dates", "value", "created"];
export const ENQUIRY_DEFAULT_SORT: SortState<EnquirySortKey> = { key: "due", dir: "asc" };

/** The installation date, or the show start when there is no installation date (the first date that matters to the team). */
export const installOrShowDate = (opp: { install_start: string | null; event_start: string | null }): string | null => opp.install_start ?? opp.event_start ?? null;

const stageRank = (stage: string): string => String(Math.max(0, CRM_STAGES.findIndex((s) => s.id === stage))).padStart(2, "0");

/** A stable copy of the list in the requested order. Missing values always sort last. Values sort by currency first: amounts in different currencies are never compared. */
export function sortEnquiries<T extends OpportunityListItem>(items: readonly T[], sort: SortState<EnquirySortKey>): T[] {
  const text = (i: T): string | null => {
    switch (sort.key) {
      case "enquiry": return i.opp.title;
      case "party": return i.agency || i.client ? organisationLabel(i) : null;
      case "owner": return i.ownerName;
      case "stage": return stageRank(i.opp.stage);
      case "due": return i.nextFollowUp?.due_at ?? null;
      case "dates": return installOrShowDate(i.opp);
      case "created": return i.opp.created_at;
      case "value": return null;
    }
  };
  const copy = [...items];
  if (sort.key === "value") {
    return copy.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      const byCurrency = compareNullable(a.opp.currency, b.opp.currency, "asc");
      if (byCurrency !== 0) return byCurrency;
      return sort.dir === "asc" ? a.value - b.value : b.value - a.value;
    });
  }
  return copy.sort((a, b) => compareNullable(text(a), text(b), sort.dir) || compareNullable(a.opp.reference, b.opp.reference, "asc"));
}

// ---------------------------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------------------------

/** The pipeline stages, then On hold, then the two closing lanes that are only ever entered through their forms. */
export const BOARD_COLUMN_IDS: readonly string[] = [...CRM_PIPELINE_STAGES, "on_hold", "won", "lost"];

export const boardColumns = (): { id: string; label: string }[] => BOARD_COLUMN_IDS.map((id) => ({ id, label: crmStageLabel(id) }));

/** Which lane a record sits in (an unknown stage never disappears: it is shown in the first lane). */
export const boardColumnFor = (stage: string): string => (BOARD_COLUMN_IDS.includes(stage) ? stage : (BOARD_COLUMN_IDS[0] ?? "new"));

export type BoardMoveKind = "stage" | "hold" | "won" | "lost" | "resume";

/** What dropping a card from `from` into `to` means: a plain move, or one of the moves that need a form first. */
export function boardMoveKind(from: string, to: string): BoardMoveKind {
  if (to === "on_hold") return "hold";
  if (to === "won") return "won";
  if (to === "lost") return "lost";
  if (from === "on_hold") return "resume";
  return "stage";
}

export interface BoardMoveInput {
  stage: string;
  stageBeforeHold: string | null;
  /** Owner or founder (the same rule as the Move stage button). */
  canEdit: boolean;
  ownerName: string;
}

/**
 * Where a card may be offered a move. Only what the full page offers: a step back or any step forward between working stages,
 * On hold, Won and Lost (each of those asks for its own details first); a held card can be resumed into the stage it came from or
 * marked Lost; a closed card cannot be moved (reopening is a separate, audited action). Someone who may not edit it gets no moves.
 */
export function boardMoveTargets(i: BoardMoveInput): { moveTo: string[]; lockedReason?: string } {
  if (i.stage === "won" || i.stage === "lost") return { moveTo: [], lockedReason: "Closed. A founder can reopen it from its details." };
  if (!i.canEdit) return { moveTo: [], lockedReason: `Only the owner (${i.ownerName}) or a founder can move this.` };
  if (i.stage === "on_hold") {
    const back = i.stageBeforeHold && (CRM_PIPELINE_STAGES as string[]).includes(i.stageBeforeHold) ? [i.stageBeforeHold] : [];
    return { moveTo: [...back, "lost"] };
  }
  if (isCrmActive(i.stage)) return { moveTo: [...crmAllowedMoves(i.stage), "on_hold", "won", "lost"] };
  return { moveTo: [] };
}
