import "server-only";
import { z } from "zod";
import { CRM_TIME_ZONE, crmToday, daysOverdue, dubaiDateTimeToIso } from "@enginious-hr/domain";
import { displaySafe } from "../outbound";
import type { FollowUpsLookupCard, LookupPeriod } from "../protocol";
import { JarvisRefusalError, type JarvisActionDefinition } from "../types";

export const OVERDUE_FOLLOWUPS_ID = "jarvis.sales.followups.overdue";
export const LOOKUP_LIMIT = 25;
const KIND: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", proposal: "Proposal", other: "Other" };

const inputSchema = z.object({ period: z.enum(["all", "last_month", "this_month", "last_7_days", "last_30_days"]).default("all") });
type Input = z.infer<typeof inputSchema>;

const FAILED = "I could not load your follow-ups just now. This is a failed lookup, not an empty list: try again in a moment, or open Follow-ups in Sales.";

/** The window of DUE dates a period means (Dubai calendar), always capped at "now": only follow-ups whose due time has passed are overdue. */
export function periodWindow(period: LookupPeriod, now: Date): { from: string | null; to: string; label: string } {
  const today = crmToday(now);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const iso = (date: string) => dubaiDateTimeToIso(date, "00:00")!;
  const month = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const name = (yy: number, mm: number) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(yy, mm - 1, 1)));
  const nowIso = now.toISOString();
  switch (period) {
    case "last_month": { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return { from: iso(month(py, pm)), to: iso(month(y, m)), label: `that fell due in ${name(py, pm)}` }; }
    case "this_month": return { from: iso(month(y, m)), to: nowIso, label: `that fell due in ${name(y, m)}` };
    case "last_7_days": return { from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to: nowIso, label: "that fell due in the last 7 days" };
    case "last_30_days": return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString(), to: nowIso, label: "that fell due in the last 30 days" };
    default: return { from: null, to: nowIso, label: "overdue now (any due date)" };
  }
}

/**
 * "Show my overdue Sales follow-ups": a LIVE lookup, computed and shown inside Enginious OS. It never calls the provider. The rows are read through the signed-in person's own
 * session from the same table the Follow-ups page uses (the database shows only companies the person has a Sales grant for), narrowed to the selected company and to open
 * follow-ups assigned to that person whose due time has passed. Every call (and every follow-up such as "show last month instead") is authorised again by the dispatcher.
 * Shown: title, type, due date, days overdue, the enquiry's reference, title and link. A failed read is a refusal ("lookup_failed"), never an empty list.
 */
export const overdueFollowUps: JarvisActionDefinition<Input, Input, FollowUpsLookupCard, never> = {
  id: OVERDUE_FOLLOWUPS_ID,
  module: "sales",
  title: "Show my overdue Sales follow-ups",
  description: "Lists your own open follow-ups whose due time has passed, for the selected company, with links to the enquiries. Say \"show last month instead\" to change the dates. Nothing leaves Enginious OS.",
  risk: "read",
  requires: { moduleGrant: "sales" },
  status: { enabled: true },
  usesProvider: false,
  inputSchema,
  valuesSchema: inputSchema,
  describe: () => "Show my overdue follow-ups (read only)",
  async propose(ctx, input) {
    const w = periodWindow(input.period, ctx.now);
    let q = ctx.supabase.from("crm_follow_ups").select("id, title, kind, due_at, opportunity_id, company_id")
      .eq("status", "open").eq("assigned_to", ctx.userId).eq("company_id", ctx.companyId).lt("due_at", w.to);
    if (w.from) q = q.gte("due_at", w.from);
    const r = await q.order("due_at").limit(LOOKUP_LIMIT + 1);
    if (r.error) throw new JarvisRefusalError("lookup_failed", FAILED);
    const rows = (r.data ?? []) as { id: string; title: string; kind: string; due_at: string; opportunity_id: string | null }[];
    const shown = rows.slice(0, LOOKUP_LIMIT);
    const oppIds = [...new Set(shown.map((f) => f.opportunity_id).filter((x): x is string => !!x))];
    const opps = new Map<string, { id: string; reference: string; title: string }>();
    if (oppIds.length > 0) {
      const o = await ctx.supabase.from("crm_opportunities").select("id, reference, title").eq("company_id", ctx.companyId).in("id", oppIds);
      if (o.error) throw new JarvisRefusalError("lookup_failed", FAILED);
      for (const x of (o.data ?? []) as { id: string; reference: string; title: string }[]) opps.set(x.id, x);
    }
    const c = await ctx.supabase.from("companies").select("legal_name").eq("id", ctx.companyId).maybeSingle();
    if (c.error) throw new JarvisRefusalError("lookup_failed", FAILED);
    const card: FollowUpsLookupCard = {
      kind: "lookup.followups",
      company: { id: ctx.companyId, name: (c.data as { legal_name?: string } | null)?.legal_name ?? "this company" },
      period: input.period, periodLabel: w.label,
      cutoff: ctx.now.toISOString(),
      cutoffLabel: `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: CRM_TIME_ZONE }).format(ctx.now)} (Dubai)`,
      total: shown.length, truncated: rows.length > LOOKUP_LIMIT,
      items: shown.map((f) => {
        const t = displaySafe(f.title);
        const opp = f.opportunity_id ? opps.get(f.opportunity_id) : undefined;
        return {
          id: f.id, title: t.text, hidden: t.hidden, kindLabel: KIND[f.kind] ?? "Other", dueDate: crmToday(new Date(f.due_at)), daysOverdue: daysOverdue(f.due_at, ctx.now),
          // A link only to an enquiry the person's own session could read.
          enquiry: opp ? { reference: opp.reference, title: displaySafe(opp.title, 120).text, href: `/sales/opportunities/${opp.id}` } : null,
        };
      }),
      followUpsHref: "/sales/follow-ups",
    };
    return { values: input, target: { kind: "new" }, valid: false, card };
  },
};
