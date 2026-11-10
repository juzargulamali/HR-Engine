import "server-only";
import { EXCLUSION_MESSAGE } from "./classifier";
import { matchGuidance } from "./help/guidance";
import { isPreference, parsePreferences, PREFERENCES, PREFERENCE_HELP, preferenceKeysNamed, toPreferenceViews, type PreferenceKey, type PreferenceView } from "./preferences";
import { describeProtected, findProtectedContent, PROTECTED_LABEL, type ProtectedCategory } from "./protected";
import { routeMessage, type LiveArea } from "./router";
import { prepareBrief, RESTRICTED_BRIEF_MESSAGE } from "./sales/brief-outbound";
import { CHAT_ID } from "./sales/chat";
import { OVERDUE_FOLLOWUPS_ID } from "./sales/followups-overdue";
import { HELP_ANSWER_ID } from "./sales/help-answer";
import { createDispatcher, type JarvisDeps } from "./dispatcher";
import { jarvisLog } from "./log";
import { ENQUIRY_REFERENCE, JARVIS_MODES, modeByAction, modeByKey, type JarvisModeKey } from "./modes";
import type { ActionCard, ActionConfirmResult, ConfirmResult, ContextView, EnquiryCard, JarvisRefusal, ReplyLink, SendContext, SendResult } from "./protocol";
import { listJarvisActions, resolveJarvisAction } from "./registry";
import { CREATE_FROM_BRIEF_ID } from "./sales/enquiry-create-from-brief";
import type { GenericResult } from "./types";

export { routeMessage, type Route } from "./router";

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


const ABOUT_APP = /\b(?:enginious(?:\s+os)?|jarvis|this\s+(?:app|system|software)|the\s+(?:app|system)|sales\s*(?:&|and)\s*crm|the\s+crm|module|screen|page|menu)\b/i;
const APP_HOW = /^\s*(?:how\s+(?:do|can|should|would)\s+(?:i|we)|how\s+to|where\s+(?:do|can|would|is|are)\s+(?:i|we|the))\b/i;
const PREFERENCE_VALUES: Record<string, Record<string, unknown>> = Object.fromEntries(Object.entries(PREFERENCES).map(([k, v]) => [k, v.options]));

const GREETINGS: Record<string, string> = {
  how_are_you: "I am well, thank you, and ready to help. Ask me a question, ask for a draft, ask how something works in Enginious OS, or say \"show my overdue Sales follow-ups\".",
  hello: "Hello. What can I help you with? You can ask a question, ask for a draft, ask how something works in Enginious OS, or say \"show my overdue Sales follow-ups\".",
  thanks: "You are welcome.",
  bye: "Goodbye. This conversation is not kept.",
  confirm: "Nothing is saved from a chat message. If a review card is open, check it and press its confirm button; otherwise tell me what you would like to do.",
};

const ONLY_LOOKUP = "The one live lookup I have today is \"Show my overdue Sales follow-ups\".";
const UNSUPPORTED: Record<LiveArea, { text: string; links: ReplyLink[] }> = {
  sales: { text: `I cannot look that up in Sales & CRM yet. ${ONLY_LOOKUP} Summaries, counts and trends are planned next; for now, open the screen.`, links: [{ label: "Enquiries", href: "/sales/opportunities" }, { label: "Follow-ups", href: "/sales/follow-ups" }, { label: "Clients & Agencies", href: "/sales/accounts" }, { label: "Reports", href: "/sales/reports" }] },
  delivered: { text: "I cannot answer delivery counts. A won enquiry is not a delivered project, and there is no approved Projects source or agreed definition of \"delivered\" for JARVIS yet. Open Projects to see the projects you have access to.", links: [{ label: "Projects", href: "/projects" }, { label: "Sales reports", href: "/sales/reports" }] },
  projects: { text: `I cannot read or change Projects & Tasks: JARVIS has no live access to that module yet. ${ONLY_LOOKUP} Open the screen instead.`, links: [{ label: "My Work", href: "/projects/work" }, { label: "Projects", href: "/projects" }] },
  inventory: { text: `I cannot read or change Inventory: JARVIS has no live access to that module yet. ${ONLY_LOOKUP} Open the screen instead.`, links: [{ label: "Inventory", href: "/inventory" }, { label: "My equipment", href: "/inventory/mine" }] },
  finance: { text: `I cannot read budgets, expenses or other financial records: JARVIS has no live access to that module, and financial figures stay in their own screens. Open the screen if you have access.`, links: [{ label: "Project budgets", href: "/finance/project-budgets" }] },
  approvals: { text: `I cannot read your approvals: JARVIS has no live access to them yet. ${ONLY_LOOKUP} Open Approvals or My Day instead.`, links: [{ label: "Approvals", href: "/approvals" }, { label: "My Day", href: "/" }] },
  people: { text: `I cannot read People & HR records: JARVIS has no live access to that module. ${ONLY_LOOKUP} Open the screen instead.`, links: [{ label: "My Profile", href: "/profile" }, { label: "My Leave", href: "/leave" }] },
};

const MEMORY_FAILED = (e: { code?: string }): JarvisRefusal => e.code === "PGRST202"
  ? { ok: false, code: "unavailable", message: "Memory is not set up in this environment yet." }
  : e.code === "JV010" ? { ok: false, code: "paused", message: "Saving preferences is paused right now. You can still see and delete what JARVIS remembers." }
  : { ok: false, code: "unavailable", message: "Could not reach your saved preferences just now. Try again in a moment." };

type Ctx = import("./types").JarvisContext;
async function listPreferences(ctx: Ctx): Promise<{ ok: true; preferences: PreferenceView[] } | JarvisRefusal> {
  const r = await ctx.supabase.rpc("jarvis_pref_list");
  if (r.error) return MEMORY_FAILED(r.error);
  return { ok: true, preferences: toPreferenceViews((r.data ?? []) as { pref_key?: unknown; pref_value?: unknown }[]) };
}
async function savePreferences(ctx: Ctx, prefs: { key: PreferenceKey; value: string }[]): Promise<{ ok: true } | JarvisRefusal> {
  if (ctx.config.paused.includes("memory")) return { ok: false, code: "paused", message: "Saving preferences is paused right now. You can still see and delete what JARVIS remembers." };
  for (const p of prefs) {
    const r = await ctx.supabase.rpc("jarvis_pref_set", { p_key: p.key, p_value: p.value });
    if (r.error) return MEMORY_FAILED(r.error);
    jarvisLog({ event: "memory", outcome: "saved", code: p.key });
  }
  return { ok: true };
}

/** "Remember that ...", "What do you remember?", "Forget ...": handled locally. Only the closed set of preferences can be saved; the sentence itself is never stored or sent. */
async function rememberFromText(ctx: Ctx, op: "save" | "show" | "forget", text: string): Promise<SendResult> {
  if (op === "save") {
    const found = findProtectedContent(text);
    if (found.length > 0) return { ok: true, kind: "reply", text: `I do not remember ${describeProtected(found)}, or any business record or personal detail. ${PREFERENCE_HELP}`, links: [] };
    const prefs = parsePreferences(text);
    if (prefs.length === 0) return { ok: true, kind: "reply", text: `I did not save that. ${PREFERENCE_HELP}`, links: [] };
    const saved = await savePreferences(ctx, prefs);
    if (!saved.ok) return saved;
  } else if (op === "forget") {
    const named = preferenceKeysNamed(text);
    const current = await listPreferences(ctx);
    if (!current.ok) return current;
    const keys = named === "all" ? current.preferences.map((p) => p.key) : named.filter((k) => current.preferences.some((p) => p.key === k));
    if (keys.length === 0 && current.preferences.length > 0) return { ok: true, kind: "memory", text: "Which one should I forget? Use Delete next to it.", preferences: current.preferences };
    for (const k of keys) {
      const r = await ctx.supabase.rpc("jarvis_pref_delete", { p_key: k });
      if (r.error) return MEMORY_FAILED(r.error);
      jarvisLog({ event: "memory", outcome: "deleted", code: k });
    }
  }
  const list = await listPreferences(ctx);
  if (!list.ok) return list;
  const lead = op === "save" ? "Saved. I will apply this from now on, in new conversations too." : op === "forget" ? "Done." : "";
  return { ok: true, kind: "memory", text: `${lead}${lead ? " " : ""}${list.preferences.length === 0 ? "I am not remembering anything for you." : "This is what I remember for you. Only you can see it."}`, preferences: list.preferences };
}

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


  /**
   * A request about protected information. JARVIS never shows or discusses it and never reads the records. It checks the person's OWN access inside Enginious OS (their roles
   * and grants, through their session) and then either points an authorised person to the screen, or says they do not have access WITHOUT saying whether any record exists, or
   * says the access could not be checked. Nothing goes to the provider.
   */
  async function protectedGuide(ctx: Ctx, category: ProtectedCategory): Promise<SendResult> {
    const what = PROTECTED_LABEL[category];
    const cannot = `I cannot show or discuss ${what} here: that information stays in its own screen in Enginious OS.`;
    const unverified: SendResult = { ok: true, kind: "reply", text: `${cannot} I could not check your access just now, so I cannot point you to the right screen. Try again in a moment.`, links: [] };
    const no = (area: string): SendResult => ({ ok: true, kind: "reply", text: `${cannot} You do not have access to ${area} in Enginious OS, so I cannot help with this request. If you need it for your work, ask for access through People & Access.`, links: [] });
    const yes = (text: string, links: ReplyLink[]): SendResult => ({ ok: true, kind: "reply", text: `${cannot} ${text}`, links });
    jarvisLog({ event: "refused", code: `protected_${category}` });
    if (category === "pricing") {
      const g = ctx.companyId ? await deps.moduleGrant({ module: "sales", supabase: ctx.supabase, userId: ctx.userId, companyId: ctx.companyId }) : false;
      if (g === "error") return unverified;
      return g ? yes("You have Sales access for this company: prices, rates and discounts are on the enquiry's estimate and in Proposals & quotes.", [{ label: "Proposals & quotes", href: "/sales/proposals" }, { label: "Enquiries", href: "/sales/opportunities" }]) : no("Sales & CRM for this company");
    }
    if (!deps.protectedAccess) return unverified;
    const acc = await deps.protectedAccess({ supabase: ctx.supabase, userId: ctx.userId, companyId: ctx.companyId });
    if (acc === "error") return unverified;
    const has = (...roles: string[]) => roles.some((r) => acc.roles.includes(r));
    switch (category) {
      case "compensation": return has("hr_admin", "finance", "ceo", "cto") ? yes("You have access to Payroll.", [{ label: "Payroll", href: "/payroll" }]) : no("payroll");
      case "project_financials": return acc.budget ? yes("You have access to Project budgets for this company.", [{ label: "Project budgets", href: "/finance/project-budgets" }]) : no("project budgets for this company");
      case "reimbursement": return yes(`Your own claims are in My Reimbursements.${has("hr_admin", "finance", "ceo", "cto", "line_manager") ? " Claims waiting for your decision are in Approvals." : " Other people's claims are visible only to those who approve or process them."}`, [{ label: "My Reimbursements", href: "/reimbursements" }, ...(has("hr_admin", "finance", "ceo", "cto", "line_manager") ? [{ label: "Approvals", href: "/approvals" }] : [])]);
      case "private_leave": return yes(`Your own leave is in My Leave.${has("hr_admin", "ceo", "cto", "line_manager") ? " Requests waiting for your decision are in Approvals." : " Other people's leave details are visible only to those who manage them."}`, [{ label: "My Leave", href: "/leave" }, ...(has("hr_admin", "ceo", "cto", "line_manager") ? [{ label: "Approvals", href: "/approvals" }] : [])]);
      default: return has("hr_admin") ? yes("Your own details are in My Profile, and you have access to employee records.", [{ label: "My Profile", href: "/profile" }, { label: "Employees", href: "/employees" }]) : yes("Your own details are in My Profile. You do not have access to other people's records.", [{ label: "My Profile", href: "/profile" }]);
    }
  }

  return {
    ...d,

    async send(req: { companyId: string; text: string; intent?: string | null; enquiryId?: string | null; context?: SendContext | null; briefOutbound?: string | null }): Promise<SendResult> {
      const text = (req.text ?? "").trim();
      if (!text) return { ok: false, code: "invalid_input", message: "Type a question or a request." };
      // "chat" is the answer to a clarifying question ("just answer it"): the text is a general message, still subject to every exclusion and protected-content rule below.
      const forceChat = req.intent === "chat";
      const intent = req.intent && !forceChat ? modeByKey(req.intent) : null;
      if (req.intent && !forceChat && !intent) return { ok: false, code: "invalid_input", message: "That is not something JARVIS can do." };
      // Authorise first (identity, pilot, company), so a refused person learns nothing; then route LOCALLY (no model classifies anything); only then, for the few routes that
      // need it, call the provider through the outbound gate. The context from the browser is a convenience for follow-ups: it is never permission and is screened like any text.
      const auth = await d.authorize(null, req.companyId, "read");
      if (!auth.ok) return auth;
      if (text.length > auth.ctx.config.maxInputChars) return { ok: false, code: "invalid_input", message: `That is too long (${text.length} characters; the limit is ${auth.ctx.config.maxInputChars}).` };
      const turns = (req.context?.turns ?? []).filter((t) => t && (t.role === "user" || t.role === "jarvis") && typeof t.text === "string");
      const routed = routeMessage(text, { intent: intent?.key ?? null, hasChatContext: turns.length > 0, lastLookup: !!req.context?.lastLookup, hasEnquiry: !!req.enquiryId });
      jarvisLog({ event: "route", outcome: routed.kind });
      const reply = (t: string, links: ReplyLink[] = []): SendResult => ({ ok: true, kind: "reply", text: t, links });
      const proposeFor = async (actionId: string, input: unknown) => asAction(actionId, await d.propose({ actionId, companyId: req.companyId, input }));
      // An enquiry brief is separated locally before anything is sent. If it cannot be separated safely, NOTHING is sent: the person sees the text that would go, edits it, or uses the form.
      const brief = async (): Promise<SendResult> => {
        const edited = typeof req.briefOutbound === "string" && req.briefOutbound.trim() ? req.briefOutbound.trim() : undefined;
        const prepared = prepareBrief(text);
        // The whole brief is marked restricted: nothing is sent, the editable preview is NOT offered (it could not lift the restriction), and the form is the way.
        if (prepared.restricted) {
          jarvisLog({ event: "outbound", actionId: CREATE_FROM_BRIEF_ID, outcome: "blocked", code: "brief_restricted" });
          return { ok: true, kind: "reply", text: RESTRICTED_BRIEF_MESSAGE, links: [{ label: "New-enquiry form", href: "/sales/new" }] };
        }
        const left = edited ? findProtectedContent(edited) : prepared.separable ? [] : findProtectedContent(text);
        if (left.length > 0 || (!edited && !prepared.separable)) {
          jarvisLog({ event: "outbound", actionId: CREATE_FROM_BRIEF_ID, outcome: "blocked", code: "brief_needs_review" });
          return { ok: true, kind: "brief_review", outbound: edited ?? prepared.outbound, formHref: "/sales/new", text: `I have not sent anything. This brief seems to contain ${describeProtected(left.length > 0 ? left : prepared.remaining)}, which stays inside Enginious OS. Below is the brief without those parts: check it, edit it if needed and send that clean excerpt, or use the new-enquiry form. Your original brief stays here for the review card.` };
        }
        return asCard(await d.propose({ actionId: CREATE_FROM_BRIEF_ID, companyId: req.companyId, input: { mode: "extract", brief: text, ...(edited ? { outbound: edited } : {}) } }));
      };
      const chat = (draft: boolean) => proposeFor(CHAT_ID, { message: text, draft, turns });

      if (forceChat && ["clarify", "clarify_brief", "brief", "need_brief", "knowledge"].includes(routed.kind)) return chat(false);
      switch (routed.kind) {
        case "excluded": jarvisLog({ event: "refused", code: `excluded_${routed.category}` }); return { ok: false, code: "excluded_request", message: EXCLUSION_MESSAGE };
        case "protected": return protectedGuide(auth.ctx, routed.category);
        case "greeting": return reply(GREETINGS[routed.flavour] ?? GREETINGS.hello!);
        case "capabilities": return { ok: true, kind: "help", help: d.help() };
        case "memory": return rememberFromText(auth.ctx, routed.op, text);
        case "lookup": return proposeFor(OVERDUE_FOLLOWUPS_ID, { period: routed.period });
        case "unsupported_live": return reply(UNSUPPORTED[routed.area].text, UNSUPPORTED[routed.area].links);
        case "need_brief": return reply("Paste the client's message or brief and I will turn it into an enquiry for you to review. Nothing is saved until you confirm.");
        case "clarify_brief": return { ok: true, kind: "clarify", text: "Is this a client brief you want turned into a new enquiry?", options: [{ label: "Yes, prepare an enquiry", intent: "enquiry" }, { label: "No, just answer it", intent: "chat" }] };
        case "clarify": return { ok: true, kind: "clarify", text: "What would you like me to do with that?", options: [{ label: "Answer it", intent: "chat" }, { label: "Explain how it works in Enginious OS", intent: "help" }, { label: "Prepare a new enquiry", intent: "enquiry" }] };
        case "brief": return brief();
        case "knowledge":
          // A question that only sounds like the app ("what makes a good follow-up email?") and has no guidance is a general question.
          if (!intent && matchGuidance(text).length === 0 && !ABOUT_APP.test(text) && !APP_HOW.test(text)) return chat(false);
          return proposeFor(HELP_ANSWER_ID, { question: text });
        case "chat": return chat(routed.draft);
        case "mode": {
          const mode = JARVIS_MODES.find((m) => m.key === routed.key)!;
          const resolved = resolveJarvisAction(mode.actionId);
          if (!resolved.ok) {
            const a = listJarvisActions().find((x) => x.id === mode.actionId);
            jarvisLog({ event: "message", actionId: mode.actionId, outcome: "not_available" });
            return { ok: true, kind: "not_available", title: a?.title ?? mode.label, reason: a?.status.reason ?? resolved.reason };
          }
          if (mode.key === "enquiry") return brief();
          if (!routed.chosen && NEEDS_PASTE.includes(mode.key)) return { ok: true, kind: "info", text: `To ${mode.label.toLowerCase()}, pick "${mode.label}" below, then paste the text. JARVIS uses the enquiry the page shows.` };
          let enquiryId: string | null = null;
          if (mode.needsEnquiry) {
            const r = await resolveEnquiry(auth.ctx.supabase, text, req.enquiryId ?? null);
            if (!r.ok) return r;
            enquiryId = r.id;
          }
          return proposeFor(mode.actionId, inputFor(mode.key, text, enquiryId));
        }
      }
    },

    /** What JARVIS remembers for the signed-in person: list, set (one of the closed pairs) or delete. Their own rows only: the database functions take no user argument. */
    async memory(req: { op: "list" } | { op: "set"; key: string; value: string } | { op: "delete"; key: string }): Promise<SendResult> {
      const auth = await d.authorize(null, null, "read");
      if (!auth.ok) return auth;
      if (req.op === "set") {
        if (!isPreference(req.key, req.value)) return { ok: false, code: "invalid_input", message: PREFERENCE_HELP };
        const saved = await savePreferences(auth.ctx, [{ key: req.key, value: req.value }]);
        if (!saved.ok) return saved;
      } else if (req.op === "delete") {
        if (!Object.prototype.hasOwnProperty.call(PREFERENCE_VALUES, req.key)) return { ok: false, code: "invalid_input", message: "That is not a saved preference." };
        const r = await auth.ctx.supabase.rpc("jarvis_pref_delete", { p_key: req.key });
        if (r.error) return MEMORY_FAILED(r.error);
        jarvisLog({ event: "memory", outcome: "deleted", code: req.key });
      }
      const list = await listPreferences(auth.ctx);
      if (!list.ok) return list;
      return { ok: true, kind: "memory", text: list.preferences.length === 0 ? "I am not remembering anything for you." : "This is what I remember for you. Only you can see it.", preferences: list.preferences };
    },

    /** A suggested correction to the guidance: stored for review (it changes nothing JARVIS says until it is reviewed and published through the Map). Never sent to the provider. */
    async suggestCorrection(req: { topicId: string; text: string }): Promise<SendResult> {
      const auth = await d.authorize(null, null, "read");
      if (!auth.ok) return auth;
      if (auth.ctx.config.paused.includes("help")) return { ok: false, code: "paused", message: "Suggestions are paused right now." };
      const body = (req.text ?? "").trim();
      if (body.length < 5 || body.length > 1000) return { ok: false, code: "invalid_input", message: "Write the correction in a sentence or two (up to 1000 characters)." };
      const found = findProtectedContent(body);
      if (found.length > 0) return { ok: false, code: "protected_content", message: `That seems to contain ${describeProtected(found)}. Describe the correction without those details.` };
      const r = await auth.ctx.supabase.rpc("jarvis_suggest_correction", { p_topic: req.topicId, p_text: body });
      if (r.error) { jarvisLog({ event: "refused", code: "suggestion_failed" }); return { ok: false, code: "unavailable", message: (r.error as { code?: string }).code === "PGRST202" ? "Suggestions are not set up in this environment yet." : "Could not send your suggestion just now. Try again in a moment." }; }
      jarvisLog({ event: "message", outcome: "suggestion_stored" });
      return { ok: true, kind: "reply", text: "Thank you. Your suggestion was sent for review. The guidance changes only after it is reviewed and published.", links: [] };
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
