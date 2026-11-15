import { CRM_PIPELINE_STAGES, CRM_RETIRED_STAGES, CRM_STAGE_IDS, crmAllowedMoves, crmStageLabel, followUpTiming, isCrmActive, isCrmOpen, isCrmRetiredStage } from "@enginious-hr/domain";
import { compareNullable, type SortState } from "@/components/workspace/url-state";
import { stageMoveRequirement } from "@/app/(app)/sales/opportunities/[id]/helpers";
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
  // The due time is part of the Next action cell. This is the same time in a column of its own, for a person who wants it (and for saved links that name it).
  { id: "due", label: "Due" },
  { id: "dates", label: "Installation / show" },
  { id: "value", label: "Value" },
  { id: "source", label: "Source" },
  { id: "availability", label: "Equipment availability" },
  { id: "created", label: "Created" },
  { id: "company", label: "Company" },
];

export const ENQUIRY_ALL_COLUMNS: readonly EnquiryColumn[] = ENQUIRY_COLUMNS.map((c) => c.id);
export const ENQUIRY_DEFAULT_COLUMNS: readonly EnquiryColumn[] = ["enquiry", "party", "owner", "stage", "next", "dates"];

export type EnquirySortKey = "enquiry" | "party" | "owner" | "stage" | "due" | "dates" | "value" | "created";
export const ENQUIRY_SORT_KEYS: readonly EnquirySortKey[] = ["enquiry", "party", "owner", "stage", "due", "dates", "value", "created"];
export const ENQUIRY_DEFAULT_SORT: SortState<EnquirySortKey> = { key: "due", dir: "asc" };

/** The installation date, or the show start when there is no installation date (the first date that matters to the team). */
export const installOrShowDate = (opp: { install_start: string | null; event_start: string | null }): string | null => opp.install_start ?? opp.event_start ?? null;

// Every id a row can hold, the retired stage included (it keeps its old place beside Proposal sent, as in crm_enquiry_list).
const stageRank = (stage: string): string => String(Math.max(0, (CRM_STAGE_IDS as readonly string[]).indexOf(stage))).padStart(2, "0");

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

/**
 * The lanes. A retired stage ("Estimate sent") has no lane of its own unless an enquiry still holds it: `presentStages` are the stages of the matching
 * enquiries, and a retired one among them gets a lane after Proposal sent so those enquiries are shown where they really are. Nothing can be dropped into it
 * (no card ever lists it as a target).
 */
export function boardColumns(presentStages: readonly string[] = []): { id: string; label: string }[] {
  const retired = CRM_RETIRED_STAGES.map((s) => s.id as string).filter((id) => presentStages.includes(id));
  const ids = [...BOARD_COLUMN_IDS];
  if (retired.length > 0) ids.splice(ids.indexOf("proposal_sent") + 1, 0, ...retired);
  return ids.map((id) => ({ id, label: crmStageLabel(id) }));
}

/** Which lane a record sits in (an unknown stage never disappears: it is shown in the first lane; a retired stage is shown in its own lane). */
export const boardColumnFor = (stage: string): string => (BOARD_COLUMN_IDS.includes(stage) || isCrmRetiredStage(stage) ? stage : (BOARD_COLUMN_IDS[0] ?? "new"));

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

// ---------------------------------------------------------------------------------------------------------------
// Board: the detail page's evidence rules, checked before a move is sent
// ---------------------------------------------------------------------------------------------------------------

/** The recorded facts three stages need before the database lets an enquiry into them (crm_move_stage, migration 20261228000100). */
export interface StageEvidence { hasSentProposal: boolean; hasQuoteRef: boolean }
export interface BoardRefusal {
  /** What is missing, in the same words as the Move stage dialog on the enquiry's own page. */
  message: string;
  /** The tab of the enquiry's page where it is added, and the words of the link to it. */
  tab: string;
  linkLabel: string;
}

const EVIDENCE_PLACE: Record<string, { tab: string; linkLabel: string }> = {
  proposal_sent: { tab: "proposals", linkLabel: "Open Proposals & files to record it" },
  quote_sent: { tab: "commercial", linkLabel: "Open Commercial to record it" },
};

/**
 * Whether a plain move to `to` would be refused for missing evidence, using the SAME rule as the enquiry's own page (`stageMoveRequirement`): Proposal sent needs
 * a proposal recorded as sent, Quote sent the Zoho Books quote reference (an estimate recorded as sent is evidence for neither). Null = nothing is missing as far as is
 * known. `evidence` null means it could not be read: nothing is assumed either way, the move is sent and the database decides, as it always does.
 * This only answers sooner and says where to go; it never allows a move the database refuses.
 */
export function boardMoveCheck(to: string, evidence: StageEvidence | null | undefined): BoardRefusal | null {
  if (!evidence) return null;
  const message = stageMoveRequirement(to, evidence);
  const place = EVIDENCE_PLACE[to];
  return message && place ? { message, ...place } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The line above the list: what is shown, what is not, and why
// ---------------------------------------------------------------------------------------------------------------

/** Every enquiry of the chosen company the person may see (all stages), and how many of them are won and lost. From a second, count-only read. */
export interface EnquiryScopeCounts { inCompany: number; won: number; lost: number }

export interface CountInput {
  /** Enquiries that match everything chosen (company, Show, search, filters). */
  matched: number;
  /** Every enquiry the person may see, in every company and stage. */
  total: number;
  status: "open" | "closed" | "all";
  /** The chosen company's name, or null when every company is shown. */
  companyName: string | null;
  /** The person has Sales access to more than one company. */
  multiCompany: boolean;
  /** A search, an owner, a stage or a quick filter is on (anything beyond the company and Show). */
  narrowed: boolean;
  /** The "My won: handover open" view. */
  handover: boolean;
  /** The breakdown for the chosen company, when it was read. Null = not known: the sentence then says only what the two counts prove. */
  scope: EnquiryScopeCounts | null;
}

const enquiries = (n: number) => (n === 1 ? "enquiry" : "enquiries");
const isAre = (n: number) => (n === 1 ? "is" : "are");

/**
 * In words: what the list is showing, and why the rest is not shown. Only counts the database returned are used; where a breakdown is not known the sentence
 * names the possible reasons instead of inventing numbers.
 */
export function enquiryCountSentence(i: CountInput): { shown: string; hidden: string | null } {
  const where = i.companyName ? ` in ${i.companyName}` : i.multiCompany ? " across all your companies" : "";
  const n = i.matched;
  const rest = Math.max(0, i.total - i.matched);
  let shown: string;
  if (i.handover) shown = n === 0 ? `None of your won enquiries${where} is waiting for its handover to be accepted.` : `Showing ${n} of your won ${enquiries(n)}${where} whose handover is not accepted yet.`;
  else if (i.narrowed) shown = n === 0 ? `No ${enquiries(2)}${where} match your filters.` : `Showing ${n} ${enquiries(n)}${where} that ${n === 1 ? "matches" : "match"} your filters.`;
  else if (i.status === "open") shown = n === 0 ? `No open enquiries${where}.` : `Showing ${n} open ${enquiries(n)}${where}.`;
  else if (i.status === "closed") shown = n === 0 ? `No won or lost enquiries${where}.` : `Showing ${n} won and lost ${enquiries(n)}${where}.`;
  else shown = n === 0 ? `No enquiries${where}.` : `Showing all ${n} ${enquiries(n)}${where}.`;
  if (rest === 0) return { shown, hidden: null };

  if (i.handover || i.narrowed) return { shown, hidden: `${rest} of the ${i.total} ${enquiries(i.total)} you can see ${isAre(rest)} not shown by these filters.` };

  const elsewhere = i.companyName && i.multiCompany;
  if (i.companyName && i.scope) {
    const s = i.scope;
    const other = i.total - s.inCompany;
    const open = s.inCompany - s.won - s.lost;
    const parts: string[] = [];
    let sum = 0;
    if (i.status === "open") {
      const closed = [s.won > 0 ? `${s.won} won` : "", s.lost > 0 ? `${s.lost} lost` : ""].filter(Boolean).join(" and ");
      if (closed) parts.push(`${closed} in ${i.companyName}`);
      sum += s.won + s.lost;
    } else if (i.status === "closed" && open > 0) { parts.push(`${open} open in ${i.companyName}`); sum += open; }
    if (other > 0) { parts.push(`${other} in your other companies`); sum += other; }
    // The two reads are separate: if something changed between them the parts no longer add up, and the general sentence below is used instead.
    if (sum === rest && other >= 0 && open >= 0 && parts.length > 0) return { shown, hidden: `${rest} more ${isAre(rest)} not shown: ${parts.join(", ")}.` };
  }
  const reasons = i.status === "open" ? (elsewhere ? "won, lost or in your other companies" : "won or lost")
    : i.status === "closed" ? (elsewhere ? "open or in your other companies" : "open")
      : "in your other companies";
  return { shown, hidden: `${rest} more ${isAre(rest)} ${reasons}.` };
}

/** The view "Clear filters" returns to, in words. The company is not a filter: it stays as chosen. */
export const ENQUIRY_DEFAULT_VIEW = "open enquiries, any owner and stage";

export interface FilterChip { id: string; label: string; /** The address parameters that removing this chip clears. */ clear: readonly string[] }

/** The filters in use, one removable chip each. The company and the view (Table or Board) are not filters. */
export function enquiryFilterChips(f: { q: string; stageLabel: string; ownerLabel: string; status: "open" | "closed" | "all"; need: EnquiryNeed | ""; handover: boolean }): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.handover) return [{ id: "handover", label: "My won: handover open", clear: ["need"] }];
  if (f.q) chips.push({ id: "q", label: `Search: ${f.q}`, clear: ["q"] });
  if (f.ownerLabel) chips.push({ id: "owner", label: `Owner: ${f.ownerLabel}`, clear: ["owner", "mine"] });
  if (f.stageLabel) chips.push({ id: "stage", label: `Stage: ${f.stageLabel}`, clear: ["stage"] });
  if (f.status !== "open") chips.push({ id: "status", label: f.status === "closed" ? "Show: won and lost" : "Show: everything", clear: ["status"] });
  const need = ENQUIRY_NEEDS.find((n) => n.id === f.need);
  if (need) chips.push({ id: "need", label: need.label, clear: ["need"] });
  return chips;
}

// ---------------------------------------------------------------------------------------------------------------
// One obvious action per row
// ---------------------------------------------------------------------------------------------------------------

export interface RowAction {
  label: string;
  /** The tab of the enquiry's own page the action opens ("" = its first tab). */
  tab: string;
  /** "amber" = something is waiting on the person; "red" = it is late. The label says so in words. */
  tone: "red" | "amber" | null;
}

/**
 * The next step for an enquiry, as one link to its own page: the late or missing next action first, then the first response, then what its stage is waiting for.
 * It opens a page and changes nothing; the row itself still opens the side panel.
 */
export function enquiryRowAction(i: NeedInput, now: Date = new Date()): RowAction {
  const stage = i.opp.stage;
  if (stage === "won" || stage === "lost") return { label: "View", tab: "", tone: null };
  if (stage === "on_hold") return { label: "Review hold", tab: "", tone: null };
  const needs = enquiryNeeds(i, now);
  if (needs.includes("overdue")) return { label: "Follow up now", tab: "", tone: "red" };
  if (needs.includes("no_next_action")) return { label: "Plan next action", tab: "", tone: "amber" };
  if (needs.includes("no_first_response")) return { label: "Log first response", tab: "activity", tone: "amber" };
  if (stage === "proposal_prep") return { label: "Prepare proposal", tab: "proposals", tone: null };
  return { label: "Open", tab: "", tone: null };
}
