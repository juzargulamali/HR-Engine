import "server-only";
import { isCrmOpen } from "@enginious-hr/domain";
import { getCrmContext } from "./context";
import { loadFollowUps, loadOpportunities } from "./data";
import { attentionItems, type AttentionItem } from "./reports";

export interface SalesToday {
  /** Items the signed-in person owns or is assigned, most urgent first. */
  attention: AttentionItem[];
  overdue: number;
  dueToday: number;
  noFirstResponse: number;
  /** Open opportunities visible to this person across the companies they hold a Sales grant for. */
  openCount: number;
  opportunityCount: number;
}

export type SalesTodayResult = { status: "none" } | { status: "error" } | { status: "ok"; data: SalesToday };

/**
 * The Sales part of My Day: the same loaders and the same attention rules as the Sales overview, scoped to the signed-in
 * person ("mine"), so the two places can never disagree. Everything is read through the person's own session, so RLS decides
 * what is visible. No Sales grant means "none" (nothing is shown, nothing is queried beyond the grant lookup).
 */
export async function loadSalesToday(): Promise<SalesTodayResult> {
  const ctx = await getCrmContext();
  if (!ctx || ctx.grants.length === 0) return { status: "none" };
  try {
    const [opportunities, followUps] = await Promise.all([loadOpportunities(ctx), loadFollowUps(ctx)]);
    const attention = attentionItems({ opportunities, followUps: followUps.open, userId: ctx.userId, scope: "mine" });
    const count = (kind: AttentionItem["kind"]) => attention.filter((a) => a.kind === kind).length;
    return {
      status: "ok",
      data: {
        attention,
        overdue: count("overdue"),
        dueToday: count("due_today"),
        noFirstResponse: count("no_first_response"),
        openCount: opportunities.filter((o) => isCrmOpen(o.opp.stage)).length,
        opportunityCount: opportunities.length,
      },
    };
  } catch (e) {
    console.error("[crm] my day load failed", e);
    return { status: "error" };
  }
}
