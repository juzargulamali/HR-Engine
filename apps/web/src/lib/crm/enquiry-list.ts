import { CRM_PIPELINE_STAGES, CRM_STAGES, crmAllowedMoves, crmStageLabel, followUpTiming, isCrmActive, isCrmOpen } from "@enginious-hr/domain";
import { compareNullable, type SortState } from "@/components/workspace/url-state";
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
/** What the list helpers need of an enquiry: both the full list item and the bounded list item have it. */
export interface SortableEnquiry {
  opp: { id: string; reference: string; title: string; stage: string; company_id: string; owner_id: string; currency: string; created_at: string; install_start: string | null; event_start: string | null; first_response_at: string | null };
  value: number | null;
  ownerName: string;
  agency: { name: string } | null;
  client: { name: string } | null;
  nextFollowUp: { due_at: string } | null;
  openFollowUps: number;
}

export function sortEnquiries<T extends SortableEnquiry>(items: readonly T[], sort: SortState<EnquirySortKey>): T[] {
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

// ---------------------------------------------------------------------------------------------------------------
// What an enquiry needs now (the quick filters above the list)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Read from the recorded follow-ups and first response only, with the same rules as My Day and Follow-ups (`attentionItems`): the enquiry's NEXT open follow-up
 * is overdue or due today (Dubai day); an open enquiry has no first response recorded; a working-stage enquiry has no open follow-up at all.
 */
export type EnquiryNeed = "overdue" | "due_today" | "no_first_response" | "no_next_action";
export const ENQUIRY_NEEDS: readonly { id: EnquiryNeed; label: string; tone: "red" | "amber" | "blue" }[] = [
  { id: "overdue", label: "Overdue", tone: "red" },
  { id: "due_today", label: "Due today", tone: "amber" },
  { id: "no_first_response", label: "Awaiting first response", tone: "blue" },
  { id: "no_next_action", label: "No next action", tone: "amber" },
];
export const parseNeed = (v: string): EnquiryNeed | "" => (ENQUIRY_NEEDS.some((n) => n.id === v) ? (v as EnquiryNeed) : "");

type NeedInput = { opp: { stage: string; first_response_at: string | null }; nextFollowUp: { due_at: string } | null; openFollowUps: number };
export function enquiryNeeds(i: NeedInput, now: Date = new Date()): EnquiryNeed[] {
  const out: EnquiryNeed[] = [];
  if (i.nextFollowUp && isCrmOpen(i.opp.stage)) {
    const t = followUpTiming(i.nextFollowUp.due_at, now);
    if (t === "overdue") out.push("overdue");
    else if (t === "due_today") out.push("due_today");
  }
  if (isCrmOpen(i.opp.stage) && !i.opp.first_response_at) out.push("no_first_response");
  if (isCrmActive(i.opp.stage) && i.openFollowUps === 0) out.push("no_next_action");
  return out;
}
/** How many of `items` need each thing (an enquiry can count under more than one). */
export function needCounts(items: readonly NeedInput[], now: Date = new Date()): Record<EnquiryNeed, number> {
  const counts: Record<EnquiryNeed, number> = { overdue: 0, due_today: 0, no_first_response: 0, no_next_action: 0 };
  for (const i of items) for (const n of enquiryNeeds(i, now)) counts[n] += 1;
  return counts;
}

// ---------------------------------------------------------------------------------------------------------------
// One list request, and the same answer computed in the app (used only where the database function is not installed)
// ---------------------------------------------------------------------------------------------------------------

export interface EnquiryListQuery {
  q: string; company: string; owner: string; stage: string; status: "open" | "closed" | "all"; need: EnquiryNeed | "";
  /** Only these enquiries (the "My won: handover open" view). */
  ids?: string[];
  sort: SortState<EnquirySortKey>;
  limit: number; offset: number;
  /** Board: the first N enquiries of each stage, by next due time. Leave out for one page of the table. */
  perStage?: number;
}

/**
 * The rules of crm_enquiry_list in the app, over enquiries that were already read completely for the query's company, owner, stage and status:
 * the search, the need filter, the counts (needs over the filters without the need; stages over the filters with it) and one page or the first cards per lane.
 */
export function listFromItems<T extends SortableEnquiry>(all: readonly T[], query: EnquiryListQuery, now: Date = new Date()): { matched: number; needs: Record<EnquiryNeed, number>; stages: { stage: string; count: number; unvalued: number; totals: Record<string, number> }[]; items: T[] } {
  const ids = query.ids ? new Set(query.ids) : null;
  const needle = query.q.trim().toLowerCase();
  // The same rules as filterOpportunities (reports.ts) and as the database function: a chosen stage wins over open / closed; the search is "contains", any case.
  const base = all.filter((i) => {
    const o = i.opp;
    if (ids && !ids.has(o.id)) return false;
    if (query.stage) { if (o.stage !== query.stage) return false; }
    else if (query.status === "open" ? !isCrmOpen(o.stage) : query.status === "closed" ? isCrmOpen(o.stage) : false) return false;
    if (query.company && o.company_id !== query.company) return false;
    if (query.owner && o.owner_id !== query.owner) return false;
    return !needle || [o.reference, o.title, i.agency?.name, i.client?.name].some((v) => v?.toLowerCase().includes(needle));
  });
  const needs = needCounts(base, now);
  const need = query.need;
  const sel = need ? base.filter((i) => enquiryNeeds(i, now).includes(need)) : base;
  const by = new Map<string, T[]>();
  for (const i of sel) by.set(i.opp.stage, [...(by.get(i.opp.stage) ?? []), i]);
  const stages = [...by.entries()].map(([stage, rows]) => {
    const totals: Record<string, number> = {};
    for (const r of rows) if (r.value != null) totals[r.opp.currency] = (totals[r.opp.currency] ?? 0) + r.value;
    return { stage, count: rows.length, unvalued: rows.filter((r) => r.value == null).length, totals };
  }).sort((a, b) => a.stage.localeCompare(b.stage));
  const byDue = (a: T, b: T) => compareNullable(a.nextFollowUp?.due_at, b.nextFollowUp?.due_at, "asc") || a.opp.reference.localeCompare(b.opp.reference);
  const items = query.perStage != null
    ? [...by.values()].flatMap((rows) => [...rows].sort(byDue).slice(0, Math.max(0, query.perStage ?? 0)))
    : sortEnquiries(sel, query.sort).slice(Math.max(0, query.offset), Math.max(0, query.offset) + Math.max(1, query.limit));
  return { matched: sel.length, needs, stages, items };
}
