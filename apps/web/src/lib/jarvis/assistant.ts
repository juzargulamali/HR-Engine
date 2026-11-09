import "server-only";
import { classifyRequest, EXCLUSION_MESSAGE, type ExclusionCategory } from "./classifier";
import { createDispatcher, type JarvisDeps } from "./dispatcher";
import { jarvisLog } from "./log";
import type { ConfirmResult, ContextView, EnquiryCard, JarvisRefusal, SendResult } from "./protocol";
import { listJarvisActions } from "./registry";
import { CREATE_FROM_BRIEF_ID } from "./sales/enquiry-create-from-brief";

export type Routed = { kind: "excluded"; category: ExclusionCategory } | { kind: "help" } | { kind: "disabled"; actionId: string } | { kind: "brief" };

const HELP = /^\s*(?:help|what can (?:you|jarvis) do|what do you do|what are you able to do|capabilit(?:y|ies)|what are your capabilit(?:y|ies)|options)\s*[?!.]*\s*$/i;
const SHORT = 240;
const INTENTS: { id: string; re: RegExp; not?: RegExp }[] = [
  { id: "jarvis.sales.email.draft_reply", re: /^\s*(?:please\s+)?(?:draft|write|compose|reply|respond)\b.*\b(?:e-?mail|reply|response|message)\b/i },
  { id: "jarvis.sales.enquiry.change_status", re: /\b(?:change|move|set|mark|update)\b.*\b(?:status|stage)\b|\bmark\b.*\b(?:won|lost)\b|\bput\b.*\bon hold\b/i },
  { id: "jarvis.sales.meeting.notes_to_activity", re: /\b(?:meeting|call)\s+notes?\b|\bminutes\s+of\b/i },
  { id: "jarvis.sales.enquiry.update", re: /^\s*(?:please\s+)?(?:update|edit|change|amend)\b.*\b(?:enquiry|inquiry|opportunity)\b/i },
  { id: "jarvis.sales.organisation.register", re: /^\s*(?:please\s+)?(?:register|add|create|onboard)\b.*\b(?:client|agency|organi[sz]ation|company)\b/i, not: /\b(?:enquiry|inquiry)\b/i },
  { id: "jarvis.sales.help.ask", re: /^\s*(?:how\s+(?:do|can|should)\s+i|where\s+(?:do|can)\s+i|what\s+is|why\s+(?:is|does|can't|cannot))\b/i },
];

/** Decides, deterministically and BEFORE any provider call, what a typed message is. The pasted brief is the default; everything refused here never leaves the app. */
export function routeMessage(text: string): Routed {
  const c = classifyRequest(text);
  if (!c.allowed) return { kind: "excluded", category: c.category! };
  if (HELP.test(text)) return { kind: "help" };
  if (text.length <= SHORT) for (const i of INTENTS) if (i.re.test(text) && !(i.not && i.not.test(text))) return { kind: "disabled", actionId: i.id };
  return { kind: "brief" };
}

/** The assistant's server-side entry points. Every one authorises again from the session (see createDispatcher.authorize). */
export function createAssistant(deps: JarvisDeps) {
  const d = createDispatcher(deps);
  const asCard = (o: Awaited<ReturnType<typeof d.propose>>): SendResult => (o.ok ? { ok: true, kind: "card", card: o.card as EnquiryCard, confirmation: o.confirmation } : o);

  return {
    ...d,

    async send(req: { companyId: string; text: string }): Promise<SendResult> {
      const text = (req.text ?? "").trim();
      if (!text) return { ok: false, code: "invalid_input", message: "Paste a brief or ask a question." };
      // Authorise first (identity, pilot, company), so a refused person learns nothing, then classify, then (only if allowed) route to the provider-free or provider path.
      const auth = await d.authorize(null, req.companyId, "read");
      if (!auth.ok) return auth;
      const routed = routeMessage(text);
      if (routed.kind === "excluded") { jarvisLog({ event: "refused", code: `excluded_${routed.category}` }); return { ok: false, code: "excluded_request", message: EXCLUSION_MESSAGE }; }
      if (routed.kind === "help") { jarvisLog({ event: "message", outcome: "help" }); return { ok: true, kind: "help", help: d.help() }; }
      if (routed.kind === "disabled") {
        const a = listJarvisActions().find((x) => x.id === routed.actionId);
        jarvisLog({ event: "message", actionId: routed.actionId, outcome: "not_available" });
        return { ok: true, kind: "not_available", title: a?.title ?? "That", reason: a?.status.reason ?? "Not available yet." };
      }
      return asCard(await d.propose({ actionId: CREATE_FROM_BRIEF_ID, companyId: req.companyId, input: { mode: "extract", brief: text } }));
    },

    async review(req: { companyId: string; fields: Record<string, unknown>; typed?: { agency?: string | null; client?: string | null }; search?: { agency?: string | null; client?: string | null }; fromBrief?: string[] }): Promise<SendResult> {
      return asCard(await d.propose({ actionId: CREATE_FROM_BRIEF_ID, companyId: req.companyId, input: { mode: "revise", fields: req.fields, typed: req.typed, search: req.search, fromBrief: req.fromBrief } }));
    },

    async confirm(req: { companyId: string; token: string; values: unknown; duplicateIds?: string[] }): Promise<ConfirmResult> {
      const out = await d.execute({ actionId: CREATE_FROM_BRIEF_ID, companyId: req.companyId, token: req.token, values: req.values, acknowledgements: { duplicateIds: req.duplicateIds ?? [] } });
      if (!out.ok) return out;
      const r = out.result as { opportunityId: string; reference: string };
      return { ok: true, status: "done", confirmationId: out.confirmationId, reference: r.reference, opportunityId: r.opportunityId, href: `/sales/opportunities/${r.opportunityId}`, replayed: out.replayed };
    },

    /** Which company and enquiry the page the person is on belongs to (a HINT for the panel, never a permission). Read through their own session. */
    async context(req: { companyId: string | null; enquiryId: string | null }): Promise<{ ok: true; view: ContextView } | JarvisRefusal> {
      const auth = await d.authorize(null, null, "read");
      if (!auth.ok) return auth;
      const view: ContextView = { company: null, enquiry: null };
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (req.enquiryId && uuid.test(req.enquiryId)) {
        const r = await auth.ctx.supabase.from("crm_opportunities").select("id, reference, title, company_id").eq("id", req.enquiryId).maybeSingle();
        const o = r.data as { id: string; reference: string; title: string; company_id: string } | null;
        if (o) view.enquiry = { id: o.id, reference: o.reference, title: o.title, companyId: o.company_id };
      }
      const companyId = view.enquiry?.companyId ?? (req.companyId && uuid.test(req.companyId) ? req.companyId : null);
      if (companyId) {
        const c = await auth.ctx.supabase.from("companies").select("id, legal_name").eq("id", companyId).maybeSingle();
        const row = c.data as { id: string; legal_name: string } | null;
        if (row) view.company = { id: row.id, name: row.legal_name };
      }
      return { ok: true, view };
    },
  };
}
export type JarvisAssistant = ReturnType<typeof createAssistant>;
