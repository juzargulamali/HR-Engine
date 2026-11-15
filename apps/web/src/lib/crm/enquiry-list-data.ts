import { zoneOfCompanies } from "./time-zone";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { availabilityDisplay, type AvailabilityDisplay } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { CrmFollowUpRow, CrmOpportunityRow } from "@/types/crm";
import type { CrmContext } from "./context";
import { loadOpportunities, num } from "./data";
import { listFromItems, type EnquiryListQuery, type EnquiryNeed, type EnquiryScopeCounts, type StageEvidence } from "./enquiry-list";

/** The columns of an enquiry the list and the board show or act on. Nothing else is read for them (no brief, scope, notes or commercial text). */
export type ListOpp = Pick<CrmOpportunityRow,
  "id" | "reference" | "title" | "company_id" | "owner_id" | "stage" | "stage_before_hold" | "version" | "currency" | "source" | "created_at" | "install_start" | "event_start" | "first_response_at">;
export interface EnquiryListItem {
  opp: ListOpp;
  value: number | null;
  companyName: string;
  /** The Sales time zone of the enquiry's company: the clock its next follow-up is shown and judged on. */
  timeZone?: string;
  ownerName: string;
  agency: { name: string } | null;
  client: { name: string } | null;
  nextFollowUp: Pick<CrmFollowUpRow, "id" | "title" | "due_at" | "assigned_to"> | null;
  openFollowUps: number;
  availability: AvailabilityDisplay;
}
export interface StageSummary { stage: string; count: number; unvalued: number; totals: Record<string, number> }
export interface EnquiryList {
  /** Every enquiry the person may see. */
  total: number;
  /** Every enquiry that matches the filters (the rows are one page, or the first cards of each lane, of these). */
  matched: number;
  /** Counts for the quick filters, over the filters WITHOUT the need filter. */
  needs: Record<EnquiryNeed, number>;
  /** Per stage, over every match: count, enquiries with no value, per-currency totals. */
  stages: StageSummary[];
  items: EnquiryListItem[];
  /** "database" = the bounded read; "complete" = the function is not installed, so every match was read and counted in the app (the same answers, more rows read). */
  source: "database" | "complete";
}

interface RpcRow {
  id: string; reference: string; title: string; company_id: string; owner_id: string; stage: CrmOpportunityRow["stage"]; stage_before_hold: CrmOpportunityRow["stage_before_hold"]; version: number;
  currency: string; value: number | string | null; source: string; created_at: string; install_start: string | null; event_start: string | null; event_end: string | null; first_response_at: string | null;
  availability_state: CrmOpportunityRow["availability_state"]; availability_covers: CrmOpportunityRow["availability_covers"]; technologies: CrmOpportunityRow["technologies"];
  agency_name: string | null; client_name: string | null; open_follow_ups: number; next: { id: string; title: string; due_at: string; assigned_to: string } | null;
}
interface RpcResult { total: number; matched: number; needs: Record<EnquiryNeed, number>; stages: StageSummary[]; rows: RpcRow[] }

const notInstalled = (e: { code?: string; message?: string }) => e.code === "PGRST202" || e.code === "42883" || /could not find the function|function .* does not exist/i.test(e.message ?? "");
const isResult = (v: unknown): v is RpcResult => !!v && typeof v === "object" && Array.isArray((v as RpcResult).rows) && Array.isArray((v as RpcResult).stages) && typeof (v as RpcResult).matched === "number";

/**
 * The Enquiries list or board for `query`: ONE bounded read (crm_enquiry_list, migration 20261229000100) that searches, filters, sorts and counts in the database,
 * as the signed-in person (row-level security decides what is visible), and returns one page (or the first cards of each lane) with counts that cover every match.
 * Where the function is not installed it falls back to the complete read and the same rules in the app (`listFromItems`), so the answers are the same.
 * Throws when a read fails: a short list or a zero count must never look like an answer.
 */
export async function loadEnquiryList(ctx: CrmContext, query: EnquiryListQuery): Promise<EnquiryList> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const res = await supabase.rpc("crm_enquiry_list", {
    p_company: query.company || null, p_owner: query.owner || null, p_stage: query.stage || null, p_status: query.status, p_q: query.q.trim() || null, p_need: query.need || null,
    p_ids: query.ids ?? null, p_sort: query.sort.key, p_dir: query.sort.dir,
    // Owners sort by NAME: the names live in the app, so the order of ids is sent.
    p_owner_order: [...ctx.people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => p.id),
    p_limit: query.limit, p_offset: query.offset, p_per_stage: query.perStage ?? null,
  });
  if (res.error && notInstalled(res.error)) {
    const all = await loadOpportunities(ctx, { company: query.company || undefined, owner: query.owner || undefined, stage: query.stage || undefined, status: query.status });
    const total = query.company || query.owner || query.stage || query.status !== "all" ? (await loadOpportunities(ctx)).length : all.length;
    return { total, ...listFromItems(all, query), source: "complete" };
  }
  if (res.error) throw new Error(`Sales data could not be loaded: ${res.error.message}`);
  if (!isResult(res.data)) throw new Error("Sales data could not be loaded: the enquiry list came back in an unexpected shape");
  const r = res.data;
  return {
    total: Number(r.total), matched: Number(r.matched), source: "database",
    needs: { overdue: Number(r.needs.overdue), due_today: Number(r.needs.due_today), no_first_response: Number(r.needs.no_first_response), no_next_action: Number(r.needs.no_next_action) },
    stages: r.stages.map((s) => ({ stage: s.stage, count: Number(s.count), unvalued: Number(s.unvalued), totals: Object.fromEntries(Object.entries(s.totals ?? {}).map(([k, v]) => [k, Number(v)])) })),
    items: r.rows.map((o) => ({
      opp: { id: o.id, reference: o.reference, title: o.title, company_id: o.company_id, owner_id: o.owner_id, stage: o.stage, stage_before_hold: o.stage_before_hold, version: o.version, currency: o.currency,
        source: o.source, created_at: o.created_at, install_start: o.install_start, event_start: o.event_start, first_response_at: o.first_response_at },
      value: num(o.value), companyName: ctx.companyName(o.company_id), timeZone: zoneOfCompanies(ctx.companies)(o.company_id), ownerName: ctx.personName(o.owner_id),
      agency: o.agency_name ? { name: o.agency_name } : null, client: o.client_name ? { name: o.client_name } : null,
      nextFollowUp: o.next, openFollowUps: Number(o.open_follow_ups),
      availability: availabilityDisplay({ availabilityState: o.availability_state, availabilityCovers: o.availability_covers, installStart: o.install_start, eventStart: o.event_start, eventEnd: o.event_end, technologies: o.technologies ?? [] }),
    })),
  };
}

/**
 * For the line above the list ("5 more are not shown: 2 won and 1 lost in this company, 2 in your other companies"): every enquiry of ONE company the person may
 * see, with how many are won and lost. The same function as the list, asked for counts only (one row), as the signed-in person. Returns null when it cannot be
 * read: the line then says what the list's own two counts prove and no more. It never makes the page fail.
 */
export async function loadEnquiryScope(ctx: CrmContext, company: string): Promise<EnquiryScopeCounts | null> {
  try {
    const list = await loadEnquiryList(ctx, { q: "", company, owner: "", stage: "", status: "all", need: "", sort: { key: "due", dir: "asc" }, limit: 1, offset: 0 });
    const count = (stage: string) => list.stages.find((s) => s.stage === stage)?.count ?? 0;
    return { inCompany: list.matched, won: count("won"), lost: count("lost") };
  } catch (e) {
    console.error("[crm] enquiry scope counts failed", e);
    return null;
  }
}

/**
 * For the board's check before a move: which of these enquiries have a proposal recorded as sent, an estimate recorded as sent and a Zoho Books quote reference
 * (the three facts crm_move_stage insists on). Read as the signed-in person, in small batches of ids. Returns null when any read fails: the board then assumes
 * nothing, sends the move and shows the database's own answer.
 */
export async function loadStageEvidence(ids: readonly string[]): Promise<Record<string, StageEvidence> | null> {
  const out: Record<string, StageEvidence> = {};
  for (const id of ids) out[id] = { hasSentProposal: false, hasQuoteRef: false, hasSentEstimate: false };
  if (ids.length === 0) return out;
  try {
    const supabase = (await createClient()) as unknown as SupabaseClient;
    for (let at = 0; at < ids.length; at += 80) {
      const chunk = ids.slice(at, at + 80);
      const [proposals, zoho, sends] = await Promise.all([
        supabase.from("crm_proposals").select("opportunity_id").in("opportunity_id", chunk).in("status", ["sent", "accepted"]).limit(2000),
        supabase.from("crm_zoho_references").select("opportunity_id, quote_ref").in("opportunity_id", chunk).limit(2000),
        supabase.from("crm_estimate_sends").select("opportunity_id").in("opportunity_id", chunk).limit(2000),
      ]);
      // A database without the sent-estimates table (its migration is not applied) is a known state: there are no sent estimates, as on the enquiry's own page.
      const sendsMissing = !!sends.error && /42P01|PGRST205|does not exist|could not find the table/i.test(`${(sends.error as { code?: string }).code ?? ""} ${sends.error.message}`);
      const failed = proposals.error ?? zoho.error ?? (sendsMissing ? null : sends.error);
      if (failed) throw new Error(failed.message);
      for (const r of (proposals.data ?? []) as { opportunity_id: string }[]) { const e = out[r.opportunity_id]; if (e) e.hasSentProposal = true; }
      for (const r of (zoho.data ?? []) as { opportunity_id: string; quote_ref: string | null }[]) { const e = out[r.opportunity_id]; if (e && (r.quote_ref ?? "").trim() !== "") e.hasQuoteRef = true; }
      for (const r of (sendsMissing ? [] : (sends.data ?? [])) as { opportunity_id: string }[]) { const e = out[r.opportunity_id]; if (e) e.hasSentEstimate = true; }
    }
    return out;
  } catch (e) {
    console.error("[crm] board stage evidence failed", e);
    return null;
  }
}
