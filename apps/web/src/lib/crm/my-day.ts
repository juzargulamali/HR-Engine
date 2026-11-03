import "server-only";
import { crmStageLabel, isCrmFounder, isCrmOpen } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { getCrmContext, type CrmContext } from "./context";
import { loadHandoverRows, type HandoverCheck } from "./handover-attention-data";
import { loadFollowUps, loadOpportunities } from "./data";
import { attentionItems, openPipelineByStage, type AttentionItem } from "./reports";

export interface SalesToday {
  /** Items the signed-in person owns or is assigned, most urgent first. */
  attention: AttentionItem[];
  overdue: number;
  dueToday: number;
  noFirstResponse: number;
  /** Open opportunities visible to this person across the companies they hold a Sales grant for. */
  openCount: number;
  opportunityCount: number;
  /** Open opportunities by stage, as on the Enquiries board (the six working stages, then On hold). Counts only: no values are read here. */
  pipeline: { stage: string; label: string; count: number }[];
  /** The Sales-to-Projects handover rows (won without a submitted handover, the PM's question, accepted). A failed read is its own status, never an empty list. */
  handover: HandoverCheck;
  /** Commercial approval requests waiting for this person to decide (Sales founders only). */
  approvals: ApprovalsWaiting;
}

/**
 * Pending commercial approval requests in the companies where the person is a Sales founder (the only people who may decide one) and the company's
 * approval policy is "required" (otherwise nothing can be decided). Read through the person's own session. Nothing here changes who decides.
 */
export async function loadApprovalsWaiting(ctx: CrmContext): Promise<ApprovalsWaiting> {
  const companyIds = ctx.companies.filter((c) => isCrmFounder(ctx.grants, c.id) && c.settings?.approval_policy === "required").map((c) => c.id);
  if (companyIds.length === 0) return { status: "none" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("crm_approvals").select("id, opportunity_id, requested_at").eq("state", "pending").in("company_id", companyIds).order("requested_at");
    if (error) return { status: "error" };
    const rows = data ?? [];
    if (rows.length === 0) return { status: "ok", requests: [] };
    // Which enquiry each request is about: a best-effort read (the request still lists, unnamed, when it fails).
    const named = new Map<string, { reference: string; title: string }>();
    const { data: opps } = await supabase.from("crm_opportunities").select("id, reference, title").in("id", [...new Set(rows.map((r) => r.opportunity_id))]);
    for (const o of opps ?? []) named.set(o.id, { reference: o.reference, title: o.title });
    return {
      status: "ok",
      requests: rows.map((r) => ({ id: r.id, opportunityId: r.opportunity_id, requestedAt: r.requested_at, reference: named.get(r.opportunity_id)?.reference ?? null, title: named.get(r.opportunity_id)?.title ?? null })),
    };
  } catch {
    return { status: "error" };
  }
}

/** Commercial approval requests waiting for a Sales founder's decision. "none": not a founder anywhere or no company needs approvals; "error": the read failed. */
export type CommercialApprovalRequest = { id: string; opportunityId: string; requestedAt: string; reference: string | null; title: string | null };
export type ApprovalsWaiting = { status: "none" } | { status: "error" } | { status: "ok"; /** One entry per request, oldest first. */ requests: CommercialApprovalRequest[] };

export type SalesTodayResult = { status: "none" } | { status: "error" } | { status: "ok"; data: SalesToday };

/**
 * The Sales part of My Day: the same loaders and the same attention rules as the Sales overview, scoped to the signed-in
 * person ("mine"), so the two places can never disagree. Everything is read through the person's own session, so RLS decides
 * what is visible. No Sales grant means "none" (nothing is shown, nothing is queried beyond the grant lookup).
 */
export async function loadSalesToday(): Promise<SalesTodayResult> {
  const ctx = await getCrmContext();
  // The grants could not be read: the card says so instead of vanishing as "no Sales access".
  if (ctx?.loadFailed) return { status: "error" };
  if (!ctx || ctx.grants.length === 0) return { status: "none" };
  try {
    const [opportunities, followUps] = await Promise.all([loadOpportunities(ctx), loadFollowUps(ctx)]);
    const attention = attentionItems({ opportunities, followUps: followUps.open, userId: ctx.userId, scope: "mine" });
    const count = (kind: AttentionItem["kind"]) => attention.filter((a) => a.kind === kind).length;
    const [handover, approvals] = await Promise.all([loadHandoverRows(ctx, opportunities), loadApprovalsWaiting(ctx)]);
    return {
      status: "ok",
      data: {
        attention,
        overdue: count("overdue"),
        dueToday: count("due_today"),
        noFirstResponse: count("no_first_response"),
        openCount: opportunities.filter((o) => isCrmOpen(o.opp.stage)).length,
        opportunityCount: opportunities.length,
        pipeline: openPipelineByStage(opportunities.map((i) => ({ ...i.opp, value: i.value }))).map((b) => ({ stage: b.stage, label: crmStageLabel(b.stage), count: b.count })),
        handover,
        approvals,
      },
    };
  } catch (e) {
    console.error("[crm] my day load failed", e);
    return { status: "error" };
  }
}
