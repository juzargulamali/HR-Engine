import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { availabilityDisplay, type AvailabilityDisplay } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import type { CrmFollowUpRow, CrmOpportunityRow } from "@/types/crm";
import type { CrmContext } from "./context";
import { loadOpportunities, num } from "./data";
import { listFromItems, type EnquiryListQuery, type EnquiryNeed } from "./enquiry-list";

/** The columns of an enquiry the list and the board show or act on. Nothing else is read for them (no brief, scope, notes or commercial text). */
export type ListOpp = Pick<CrmOpportunityRow,
  "id" | "reference" | "title" | "company_id" | "owner_id" | "stage" | "stage_before_hold" | "version" | "currency" | "source" | "created_at" | "install_start" | "event_start" | "first_response_at">;
export interface EnquiryListItem {
  opp: ListOpp;
  value: number | null;
  companyName: string;
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
      value: num(o.value), companyName: ctx.companyName(o.company_id), ownerName: ctx.personName(o.owner_id),
      agency: o.agency_name ? { name: o.agency_name } : null, client: o.client_name ? { name: o.client_name } : null,
      nextFollowUp: o.next, openFollowUps: Number(o.open_follow_ups),
      availability: availabilityDisplay({ availabilityState: o.availability_state, availabilityCovers: o.availability_covers, installStart: o.install_start, eventStart: o.event_start, eventEnd: o.event_end, technologies: o.technologies ?? [] }),
    })),
  };
}
