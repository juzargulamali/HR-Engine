import "server-only";
import { isCrmFounder } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";
import type { CrmContext } from "./context";
import type { OpportunityListItem } from "./data";
import type { HandoverRead } from "./enquiry-guide";
import { founderCandidates, handoverRows, type HandoverRow, type OwnHandover, type WonOpportunity } from "./handover-attention";

/** "none": Projects & Tasks is not installed here (no handover exists to check). "error": a read failed, so the page says "Could not check the handover", never nothing. */
export type HandoverCheck = { status: "none" } | { status: "error" } | { status: "ok"; rows: HandoverRow[] };

const FOUNDER_CHECK_LIMIT = 40;
const CHUNK = 10;

/**
 * The handover rows for the signed-in person. Reads only what a Sales person may already read: their own handovers (as owner or preparer) straight from
 * the Projects handover record, and, for a Sales founder, the handover status of other owners' won enquiries through the same read function the
 * Sales handover page uses (proj_handover_for_opportunity, open to any Sales grantee of the company). Nothing is written.
 */
export async function loadHandoverRows(ctx: CrmContext, opportunities: readonly OpportunityListItem[], now: Date = new Date()): Promise<HandoverCheck> {
  const won: WonOpportunity[] = opportunities
    .filter((o) => o.opp.stage === "won")
    .map((o) => ({ id: o.opp.id, reference: o.opp.reference, title: o.opp.title, ownerId: o.opp.owner_id, companyId: o.opp.company_id, wonAt: o.opp.closed_at ?? o.opp.stage_changed_at }));
  const founderCompanies = new Set(ctx.grants.filter((g) => isCrmFounder(ctx.grants, g.companyId)).map((g) => g.companyId));
  try {
    const supabase = await createClient();
    const mine = `sales_owner_id.eq.${ctx.userId},prepared_by.eq.${ctx.userId}`;
    const ownRes = await supabase
      .from("proj_handovers")
      .select("crm_opportunity_id, crm_reference, title, status, clarification_note, accepted_at, updated_at")
      .or(mine)
      .neq("status", "withdrawn")
      .limit(500);
    if (isNotInstalled(ownRes.error)) return { status: "none" };
    if (ownRes.error) return { status: "error" };
    const own: OwnHandover[] = (ownRes.data ?? []).map((h) => ({
      crmOpportunityId: h.crm_opportunity_id, reference: h.crm_reference, title: h.title, status: h.status, clarificationNote: h.clarification_note, acceptedAt: h.accepted_at, updatedAt: h.updated_at,
    }));

    const founderStatus = new Map<string, string | null>();
    const candidates = founderCandidates({ userId: ctx.userId, wonOpportunities: won, founderCompanies, now }).slice(0, FOUNDER_CHECK_LIMIT);
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const part = candidates.slice(i, i + CHUNK);
      const results = await Promise.all(part.map((o) => supabase.rpc("proj_handover_for_opportunity", { p_opportunity_id: o.id })));
      for (const [n, r] of results.entries()) {
        if (isNotInstalled(r.error)) return { status: "none" };
        if (r.error) return { status: "error" };
        founderStatus.set(part[n]!.id, r.data?.[0]?.status ?? null);
      }
    }
    return { status: "ok", rows: handoverRows({ userId: ctx.userId, wonOpportunities: won, own, founderCompanies, founderStatus, now }) };
  } catch (e) {
    console.error("[crm] handover rows failed", e);
    return { status: "error" };
  }
}

export type HandoverStatusCheck = { status: "none" } | { status: "error" } | { status: "ok"; handoverStatus: string | null };

/** The handover state of ONE won enquiry (the same read the Sales handover page uses). "ok" with null means no handover has been started. */
export async function loadHandoverStatus(opportunityId: string): Promise<HandoverStatusCheck> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("proj_handover_for_opportunity", { p_opportunity_id: opportunityId });
    if (isNotInstalled(error)) return { status: "none" };
    if (error) return { status: "error" };
    return { status: "ok", handoverStatus: data?.[0]?.status ?? null };
  } catch {
    return { status: "error" };
  }
}

/**
 * The handover of ONE enquiry with who has it and, when the database lets this person see the project's summary, the project's reference
 * (proj_handover_for_opportunity: the same read the Sales handover page uses; open to a Sales grantee of the company; a withdrawn handover is not returned).
 */
export async function loadHandoverRead(opportunityId: string): Promise<HandoverRead> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("proj_handover_for_opportunity", { p_opportunity_id: opportunityId });
    if (isNotInstalled(error)) return { status: "none" };
    if (error) return { status: "error" };
    const h = data?.[0];
    return { status: "ok", handover: h ? { status: h.status, pmName: h.pm_name ?? null, projectId: h.project_id ?? null, projectReference: h.project_reference ?? null, clarificationNote: h.clarification_note ?? null } : null };
  } catch {
    return { status: "error" };
  }
}

/** "none": Projects is not installed. "error": a read failed. "ok": the person's OWN won enquiries whose handover is not accepted yet, however old the win. */
export type MyOpenHandovers = { status: "none" } | { status: "error" } | { status: "ok"; rows: { id: string; companyId: string }[] };

/**
 * The signed-in person's own won enquiries that still have no ACCEPTED handover, with no age limit (My Day stops reminding after its window; this keeps them
 * findable). Only their own: a person can read their own handovers (as Sales owner) directly, so "no accepted handover" is a fact, never a guess about a
 * handover they may not see. Reads ids only.
 */
export async function loadMyOpenHandovers(ctx: CrmContext): Promise<MyOpenHandovers> {
  try {
    const supabase = await createClient();
    const won: { id: string; company_id: string }[] = [];
    for (let from = 0; ; from += 1000) {
      const r = await supabase.from("crm_opportunities").select("id, company_id").eq("owner_id", ctx.userId).eq("stage", "won").order("id").range(from, from + 999);
      if (r.error) return { status: "error" };
      won.push(...(r.data ?? []));
      if ((r.data ?? []).length < 1000) break;
    }
    if (won.length === 0) return { status: "ok", rows: [] };
    const accepted = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const r = await supabase.from("proj_handovers").select("crm_opportunity_id").eq("sales_owner_id", ctx.userId).eq("status", "accepted").order("crm_opportunity_id").range(from, from + 999);
      if (isNotInstalled(r.error)) return { status: "none" };
      if (r.error) return { status: "error" };
      for (const h of r.data ?? []) accepted.add(h.crm_opportunity_id);
      if ((r.data ?? []).length < 1000) break;
    }
    return { status: "ok", rows: won.filter((o) => !accepted.has(o.id)).map((o) => ({ id: o.id, companyId: o.company_id })) };
  } catch (e) {
    console.error("[crm] my open handovers failed", e);
    return { status: "error" };
  }
}
