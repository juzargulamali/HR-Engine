import "server-only";
import { classifyRequest, EXCLUSION_MESSAGE, HOW_TO, type ExclusionCategory } from "./classifier";
import { createDispatcher, type JarvisDeps } from "./dispatcher";
import { jarvisLog } from "./log";
import { ENQUIRY_REFERENCE, JARVIS_MODES, modeByAction, modeByKey, type JarvisModeKey } from "./modes";
import type { ActionCard, ActionConfirmResult, ConfirmResult, ContextView, EnquiryCard, JarvisRefusal, SendResult } from "./protocol";
import { listJarvisActions, resolveJarvisAction } from "./registry";
import { CREATE_FROM_BRIEF_ID } from "./sales/enquiry-create-from-brief";
import type { GenericResult } from "./types";

export type Routed =
  | { kind: "excluded"; category: ExclusionCategory }
  | { kind: "help" }
  | { kind: "disabled"; actionId: string }
  | { kind: "mode"; key: JarvisModeKey; chosen: boolean }
  | { kind: "brief" };

const HELP = /^\s*(?:help|what can (?:you|jarvis) do|what do you do|what are you able to do|capabilit(?:y|ies)|what are your capabilit(?:y|ies)|options)\s*[?!.]*\s*$/i;
const SHORT = 240;
/** A short typed sentence that clearly names one of the capabilities (no mode chosen). Longer text is a brief unless the person chose a mode. */
const INTENTS: { key: JarvisModeKey; re: RegExp; not?: RegExp }[] = [
  { key: "reply", re: /^\s*(?:please\s+)?(?:draft|write|compose|reply|respond)\b.*\b(?:e-?mail|reply|response|message)\b/i },
  { key: "stage", re: /\b(?:change|move|set|mark|update)\b.*\b(?:status|stage)\b|\bmark\b.*\b(?:won|lost)\b|\bput\b.*\bon hold\b/i },
  { key: "meeting", re: /\b(?:meeting|call)\s+notes?\b|\bminutes\s+of\b/i },
  { key: "update", re: /^\s*(?:please\s+)?(?:update|edit|change|amend)\b.*\b(?:enquiry|inquiry|opportunity)\b/i },
  { key: "organisation", re: /^\s*(?:please\s+)?(?:register|add|create|onboard)\b.*\b(?:client|agency|organi[sz]ation|company)\b/i, not: /\b(?:enquiry|inquiry)\b/i },
  { key: "help", re: HOW_TO },
];

/**
 * Decides, deterministically and BEFORE any provider call, what a typed message is. The pasted brief is the default; everything refused here never leaves the app.
 * `intent` is the mode the person picked in the panel: it only chooses WHICH registered action the text goes to (the registry still decides whether it is enabled).
 */
export function routeMessage(text: string, intent?: JarvisModeKey | null): Routed {
  const helpMode = intent === "help" || (!intent && HOW_TO.test(text));
  const c = classifyRequest(text, { howTo: helpMode });
  if (!c.allowed) return { kind: "excluded", category: c.category! };
  if ((!intent || intent === "help") && HELP.test(text)) return { kind: "help" };
  if (intent) return { kind: "mode", key: intent, chosen: true };
  if (text.length <= SHORT) for (const i of INTENTS) if (i.re.test(text) && !(i.not && i.not.test(text))) return { kind: "mode", key: i.key, chosen: false };
  return { kind: "brief" };
}

/** "register Wave Agency as a new agency" -> "Wave Agency"; a bare name stays as it is. */
export function organisationNameFromText(text: string): string {
  const t = text.replace(/^\s*(?:please\s+)?(?:register|add|create|onboard)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:client|agency|organi[sz]ation|company|customer)?\s*(?:called|named)?\s*[:\-]?\s*/i, "").replace(/\s+as\s+(?:a\s+|an\s+)?(?:new\s+)?(?:direct\s+client|end\s+client|client|agency|organi[sz]ation|company)\.?\s*$/i, "").trim();
  return (t || text).trim().slice(0, 200);
}

/** What the typed text becomes as the action's own input (the action's input schema validates it again). */
function inputFor(key: JarvisModeKey, text: string, enquiryId: string | null): unknown {
  switch (key) {
    case "reply": return { enquiryId, conversation: text };
    case "update": return { mode: "extract", enquiryId, text };
    case "stage": return { mode: "propose", enquiryId, text: text.slice(0, 500) };
    case "meeting": return { mode: "extract", enquiryId, notes: text };
    case "organisation": return { mode: "search", name: organisationNameFromText(text) };
    case "help": return { question: text };
    default: return null;
  }
}
/** Modes that need much more than a sentence: typing a short phrase without choosing the mode only explains how to start. */
const NEEDS_PASTE: JarvisModeKey[] = ["reply", "meeting"];

/** The assistant's server-side entry points. Every one authorises again from the session (see createDispatcher.authorize). */
export function createAssistant(deps: JarvisDeps) {
  const d = createDispatcher(deps);
  const asCard = (o: Awaited<ReturnType<typeof d.propose>>): SendResult => (o.ok ? { ok: true, kind: "card", card: o.card as EnquiryCard, confirmation: o.confirmation } : o);
  const asAction = (actionId: string, o: Awaited<ReturnType<typeof d.propose>>): SendResult => (o.ok ? { ok: true, kind: "action", actionId, card: o.card as ActionCard, confirmation: o.confirmation } : o);

  /** An enquiry named by its reference in the text wins; otherwise the page's enquiry (a hint). Either way it is re-read through the person's own session by the action. */
  async function resolveEnquiry(supabase: import("@supabase/supabase-js").SupabaseClient, text: string, hint: string | null): Promise<{ ok: true; id: string } | JarvisRefusal> {
    const ref = ENQUIRY_REFERENCE.exec(text)?.[0];
    if (ref) {
      const r = await supabase.from("crm_opportunities").select("id").eq("reference", ref.toUpperCase()).maybeSingle();
      if (r.error) return { ok: false, code: "unavailable", message: "Could not look up that enquiry just now. Try again in a moment." };
      const row = r.data as { id: string } | null;
      return row ? { ok: true, id: row.id } : { ok: false, code: "not_permitted", message: "That enquiry could not be found, or you cannot see it." };
    }
    if (hint && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hint)) return { ok: true, id: hint };
    return { ok: false, code: "invalid_input", message: "Open the enquiry you mean first (JARVIS uses the one the page shows), or include its reference, for example OPP-UAE-2026-0001." };
  }

  return {
    ...d,

    async send(req: { companyId: string; text: string; intent?: string | null; enquiryId?: string | null }): Promise<SendResult> {
      const text = (req.text ?? "").trim();
      if (!text) return { ok: false, code: "invalid_input", message: "Paste a brief or ask a question." };
      const intent = req.intent ? modeByKey(req.intent) : null;
      if (req.intent && !intent) return { ok: false, code: "invalid_input", message: "That is not something JARVIS can do." };
      // Authorise first (identity, pilot, company), so a refused person learns nothing, then classify, then (only if allowed) route to the provider-free or provider path.
      const auth = await d.authorize(null, req.companyId, "read");
      if (!auth.ok) return auth;
      const routed = routeMessage(text, intent?.key ?? null);
      if (routed.kind === "excluded") { jarvisLog({ event: "refused", code: `excluded_${routed.category}` }); return { ok: false, code: "excluded_request", message: EXCLUSION_MESSAGE }; }
      if (routed.kind === "help") { jarvisLog({ event: "message", outcome: "help" }); return { ok: true, kind: "help", help: d.help() }; }
      if (routed.kind === "mode") {
        const mode = JARVIS_MODES.find((m) => m.key === routed.key)!;
        const resolved = resolveJarvisAction(mode.actionId);
        if (!resolved.ok) {
          const a = listJarvisActions().find((x) => x.id === mode.actionId);
          jarvisLog({ event: "message", actionId: mode.actionId, outcome: "not_available" });
          return { ok: true, kind: "not_available", title: a?.title ?? mode.label, reason: a?.status.reason ?? resolved.reason };
        }
        if (mode.key === "enquiry") return asCard(await d.propose({ actionId: CREATE_FROM_BRIEF_ID, companyId: req.companyId, input: { mode: "extract", brief: text } }));
        if (!routed.chosen && NEEDS_PASTE.includes(mode.key)) return { ok: true, kind: "info", text: `To ${mode.label.toLowerCase()}, pick "${mode.label}" below, then paste the text. JARVIS uses the enquiry the page shows.` };
        let enquiryId: string | null = null;
        if (mode.needsEnquiry) {
          const r = await resolveEnquiry(auth.ctx.supabase, text, req.enquiryId ?? null);
          if (!r.ok) return r;
          enquiryId = r.id;
        }
        return asAction(mode.actionId, await d.propose({ actionId: mode.actionId, companyId: req.companyId, input: inputFor(mode.key, text, enquiryId) }));
      }
      return asCard(await d.propose({ actionId: CREATE_FROM_BRIEF_ID, companyId: req.companyId, input: { mode: "extract", brief: text } }));
    },

    async review(req: { companyId: string; fields: object; typed?: { agency?: string | null; client?: string | null }; search?: { agency?: string | null; client?: string | null }; fromBrief?: string[] }): Promise<SendResult> {
      return asCard(await d.propose({ actionId: CREATE_FROM_BRIEF_ID, companyId: req.companyId, input: { mode: "revise", fields: req.fields as Record<string, unknown>, typed: req.typed, search: req.search, fromBrief: req.fromBrief } }));
    },

    async confirm(req: { companyId: string; token: string; values: unknown; duplicateIds?: string[] }): Promise<ConfirmResult> {
      const out = await d.execute({ actionId: CREATE_FROM_BRIEF_ID, companyId: req.companyId, token: req.token, values: req.values, acknowledgements: { duplicateIds: req.duplicateIds ?? [] } });
      if (!out.ok) return out;
      const r = out.result as { opportunityId: string; reference: string };
      return { ok: true, status: "done", confirmationId: out.confirmationId, reference: r.reference, opportunityId: r.opportunityId, href: `/sales/opportunities/${r.opportunityId}`, replayed: out.replayed };
    },

    /** Propose again for one of the other actions (the card's "Review changes", a search, a choice). Same checks as `send`; never writes. */
    async act(req: { companyId: string; actionId: string; input: unknown }): Promise<SendResult> {
      const mode = modeByAction(req.actionId);
      if (!mode || mode.key === "enquiry") return { ok: false, code: "unknown_action", message: "That is not something JARVIS can do." };
      return asAction(req.actionId, await d.propose({ actionId: req.actionId, companyId: req.companyId, input: req.input }));
    },

    /** The ONE write endpoint of the other actions: only a review card's confirm button calls it (through the server action). */
    async confirmAction(req: { companyId: string; actionId: string; token: string; values: unknown; acknowledgements?: Record<string, unknown> }): Promise<ActionConfirmResult> {
      const mode = modeByAction(req.actionId);
      if (!mode || mode.key === "enquiry") return { ok: false, code: "unknown_action", message: "That is not something JARVIS can do." };
      const out = await d.execute({ actionId: req.actionId, companyId: req.companyId, token: req.token, values: req.values, acknowledgements: req.acknowledgements });
      if (!out.ok) return out;
      const resolved = resolveJarvisAction(req.actionId);
      const r = out.result as GenericResult;
      const view = resolved.ok && resolved.action.resultView ? resolved.action.resultView({ resultId: r.resultId, reference: r.reference, extra: r.extra, target: "" }) : { reference: r.reference, href: null, summary: "Saved." };
      return { ok: true, status: "done", confirmationId: out.confirmationId, actionId: req.actionId, reference: view.reference, href: view.href, summary: view.summary, replayed: out.replayed };
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
      // A company is named only if it is one this person has a module grant for: a company id from the browser is a hint, never a way to read another company's name.
      const mine = await deps.companies({ supabase: auth.ctx.supabase, userId: auth.ctx.userId });
      const companyId = view.enquiry?.companyId ?? (req.companyId && uuid.test(req.companyId) ? req.companyId : null);
      if (companyId && mine !== "error" && mine.some((c) => c.id === companyId)) {
        const c = await auth.ctx.supabase.from("companies").select("id, legal_name").eq("id", companyId).maybeSingle();
        const row = c.data as { id: string; legal_name: string } | null;
        if (row) view.company = { id: row.id, name: row.legal_name };
      }
      return { ok: true, view };
    },
  };
}
export type JarvisAssistant = ReturnType<typeof createAssistant>;
