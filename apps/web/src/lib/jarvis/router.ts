import { classifyRequest, HOW_TO, type ExclusionCategory } from "./classifier";
import { APP_QUESTION } from "./help/guidance";
import type { JarvisModeKey } from "./modes";
import { ENQUIRY_REFERENCE } from "./modes";
import { findProtectedContent, protectedTopic, type ProtectedCategory } from "./protected";
import type { LookupPeriod } from "./protocol";

/**
 * LOCAL ROUTING. Decides what a typed message is, deterministically and BEFORE any provider call (no model is ever asked to classify): a greeting, a question about what
 * JARVIS can do, a memory request, a request about protected information, a live lookup, a live request JARVIS does not support, one of the Sales actions, a client brief, a
 * question about Enginious OS, a writing request or a general question. When it cannot tell, the answer is ONE short question. An enquiry form is opened only for an explicit
 * request or a text that clearly is a brief: it is never the fallback.
 */
export type Route =
  | { kind: "excluded"; category: ExclusionCategory }
  | { kind: "protected"; category: ProtectedCategory }
  | { kind: "greeting"; flavour: "hello" | "how_are_you" | "thanks" | "bye" | "confirm" }
  | { kind: "capabilities" }
  | { kind: "memory"; op: "save" | "show" | "forget" }
  | { kind: "lookup"; period: LookupPeriod }
  | { kind: "unsupported_live"; area: LiveArea }
  | { kind: "mode"; key: JarvisModeKey; chosen: boolean }
  | { kind: "brief" }
  | { kind: "need_brief" }
  | { kind: "clarify_brief" }
  | { kind: "knowledge" }
  | { kind: "chat"; draft: boolean }
  | { kind: "clarify" };

export type LiveArea = "sales" | "projects" | "delivered" | "inventory" | "people" | "finance" | "approvals";
export interface RouteContext { intent?: JarvisModeKey | null; hasChatContext?: boolean; lastLookup?: boolean; hasEnquiry?: boolean }

const CAPABILITIES = /^\s*(?:help|what can (?:you|jarvis) do|what do you do|what are you able to do|capabilit(?:y|ies)|what are your capabilit(?:y|ies)|options)\s*[?!.]*\s*$/i;
const HELLO = /^\s*(?:hi|hello|hey|hiya|good\s+(?:morning|afternoon|evening|day)|salam|salaam|marhaba|greetings)(?:\s+(?:jarvis|there|team))?\s*[!.,]*\s*$/i;
const HOW_ARE_YOU = /^\s*(?:(?:hi|hello|hey)[,!.\s]+)?(?:how\s+are\s+you(?:\s+(?:today|doing|doing\s+today|this\s+morning))?|how(?:'s|\s+is)\s+it\s+going|how\s+do\s+you\s+do|what'?s\s+up|you\s+ok(?:ay)?)\s*(?:,?\s*jarvis)?\s*[?!.]*\s*$/i;
const THANKS = /^\s*(?:thanks?(?:\s+you)?(?:\s+(?:so|very)\s+much|\s+a\s+lot)?|thank\s+you|cheers|great|perfect|ok(?:ay)?|got\s+it|nice|brilliant)(?:[,\s]+(?:jarvis|thanks?|thank\s+you))?\s*[!.]*\s*$/i;
const CONFIRM = /^\s*(?:yes|yep|confirm(?:ed)?|approved?|go\s+ahead|do\s+it|save\s+it|create\s+it|proceed)\b[^?]{0,40}$/i;
const BYE = /^\s*(?:bye|goodbye|see\s+you(?:\s+later)?|good\s+night)\s*[!.]*\s*$/i;

const MEM_SAVE = /^\s*(?:please\s+)?(?:remember|keep\s+in\s+mind|note)\b|\b(?:from\s+now\s+on|in\s+future|going\s+forward)\b[^.]{0,40}\b(?:prefer|use|write|keep|answer)\b|^\s*i\s+(?:always\s+)?prefer\b/i;
const MEM_SHOW = /\bwhat\s+(?:do|have|did)\s+you\s+(?:remember|know\s+about\s+me|saved?)\b|\bwhat\s+jarvis\s+remembers\b|\b(?:show|list|see|view)\b[^.]{0,20}\b(?:my\s+)?(?:preferences|memory|memories)\b|^\s*my\s+preferences\s*\??\s*$/i;
const MEM_FORGET = /^\s*(?:please\s+)?(?:forget|stop\s+remembering|delete|remove|clear)\b[^.]{0,60}\b(?:preferences?|memory|memories|that|everything|what\s+you\s+remember|english|spelling|tone|length|answers?)\b|^\s*(?:please\s+)?forget\b/i;

const READ = "(?:show|list|give|display|find|get|pull|see|view|tell\\s+me|what(?:'s|\\s+is|\\s+are|\\s+were)|which|how\\s+many|who|count|look\\s+up|search)";
const OVERDUE = /\b(?:overdue|late|past\s+due|missed)\b[^.]{0,30}\b(?:follow[-\s]?ups?|next\s+actions?|actions?|tasks?)\b|\b(?:follow[-\s]?ups?|next\s+actions?)\b[^.]{0,30}\b(?:overdue|late|past\s+due|missed)\b/i;
const PERIODS: { period: LookupPeriod; re: RegExp }[] = [
  { period: "last_month", re: /\blast\s+month\b|\bprevious\s+month\b/i },
  { period: "this_month", re: /\bthis\s+month\b/i },
  { period: "last_7_days", re: /\b(?:last|past)\s+(?:7|seven)\s+days\b|\b(?:last|past|this)\s+week\b/i },
  { period: "last_30_days", re: /\b(?:last|past)\s+(?:30|thirty)\s+days\b/i },
  { period: "all", re: /\b(?:all|everything|any\s+time|all\s+time)\b/i },
];
export const periodIn = (text: string): LookupPeriod | null => PERIODS.find((p) => p.re.test(text))?.period ?? null;

const LIVE: { area: LiveArea; re: RegExp }[] = [
  { area: "delivered", re: /\b(?:deliver(?:ed|y|ies|ing)?|completed\s+projects?|finished\s+projects?|projects?\s+(?:done|completed|finished))\b/i },
  { area: "sales", re: /\b(?:enquir(?:y|ies)|inquir(?:y|ies)|opportunit(?:y|ies)|pipeline|leads?|clients?|agenc(?:y|ies)|accounts?|proposals?|follow[-\s]?ups?|deals?|won|lost|sales\s+(?:numbers?|figures?|results?|summary|report|trend|performance)|conversion|outreach)\b/i },
  { area: "projects", re: /\b(?:projects?|tasks?|milestones?|handovers?)\b/i },
  { area: "inventory", re: /\b(?:inventory|stock|warehouse|equipment|items?\s+in\s+stock)\b/i },
  { area: "finance", re: /\b(?:budgets?|expenses?|purchase\s+orders?|invoices?)\b/i },
  { area: "approvals", re: /\b(?:approvals?|waiting\s+(?:for|on)\s+(?:my|me))\b/i },
  { area: "people", re: /\b(?:employees?|staff|attendance|colleagues|team\s+members?|holidays?|letters?)\b/i },
];
const LIVE_ASK = new RegExp(`^\\s*(?:please\\s+)?(?:can\\s+you\\s+|could\\s+you\\s+)?${READ}\\b`, "i");

/** Short typed sentences that clearly name one of the Sales actions. */
const INTENTS: { key: JarvisModeKey; re: RegExp; not?: RegExp }[] = [
  { key: "stage", re: /\b(?:change|move|set|mark|update)\b.*\b(?:status|stage)\b|\bmark\b.*\b(?:won|lost)\b|\bput\b.*\bon hold\b|^\s*(?:please\s+)?move\b.*\bto\s+(?:new\s+enquiry|qualified|proposal\s+(?:preparation|sent)|quote\s+sent|negotiation)\b/i },
  { key: "meeting", re: /\b(?:meeting|call)\s+notes?\b|\bminutes\s+of\b/i },
  { key: "update", re: /^\s*(?:please\s+)?(?:update|edit|change|amend)\b.*\b(?:enquiry|inquiry|opportunity)\b/i },
  { key: "organisation", re: /^\s*(?:please\s+)?(?:register|add|create|onboard)\b.*\b(?:client|agency|organi[sz]ation|company)\b/i, not: /\b(?:enquiry|inquiry)\b/i },
];
const CREATE_ENQUIRY = /^\s*(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:create|add|log|open|start|make|raise|record)\b[^.\n]{0,30}\b(?:enquiry|inquiry|lead|opportunity)\b|^\s*new\s+(?:enquiry|inquiry|lead)\b|\b(?:turn|convert|make)\b[^.\n]{0,20}\binto\s+an?\s+(?:new\s+)?(?:enquiry|inquiry)\b/i;
const LABELLED = /^\s*(?:agency|client|end client|brand|event|event dates?|venue|location|budget|source|next|next action|technolog(?:y|ies)|equipment|scope|title|requirement|installation)\s*:\s*\S/gim;

const WRITE = /^\s*(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|help\s+me\s+(?:to\s+)?)?(?:draft|write|compose|rewrite|rephrase|reword|proofread|polish|improve|summari[sz]e|translate|shorten|tidy|prepare)\b/i;
const REVISE = /^\s*(?:please\s+)?(?:make|keep)\s+(?:it|this|that)\b|^\s*(?:please\s+)?(?:shorter|longer|simpler|more\s+\w+|less\s+\w+|try\s+again|another\s+(?:version|one|go)|again\b|in\s+(?:british|american|arabic|english)\b|add\b|remove\b|change\b|use\b|now\b)/i;
const QUESTION = /\?\s*$|^\s*(?:what|why|how|when|where|who|which|can|could|should|would|is|are|do|does|did|explain|tell\s+me|give\s+me|define|compare|suggest|recommend)\b/i;
const ABOUT_APP = /\b(?:enginious(?:\s+os)?|jarvis|this\s+(?:app|system|software)|the\s+(?:app|system)|sales\s*(?:&|and)\s*crm|the\s+crm|module)\b/i;

/** How strongly a pasted text looks like a client brief for a new enquiry (0 = not at all). */
export function briefScore(text: string): number {
  if (WRITE.test(text) || HOW_TO.test(text) || HOW_ARE_YOU.test(text)) return 0;
  const labelled = (text.match(LABELLED) ?? []).length;
  if (labelled >= 2 || (labelled === 1 && /^\s*(?:title|agency|client|requirement)\s*:/i.test(text))) return 10;
  let score = labelled;
  if (/\b(?:we\s+(?:need|require|want|are\s+looking\s+for|would\s+like)|looking\s+for|can\s+you\s+(?:provide|supply|quote|do)|please\s+quote|request\s+for\s+(?:quotation|proposal)|rfq|rfp|need\s+a\s+quote|(?:enquiry|inquiry)\s+(?:for|about|from))\b/i.test(text)) score += 1;
  if (/\b(?:event|gala|exhibition|conference|launch|activation|booth|stand|wedding|festival|expo|summit|roadshow|ceremony|show)\b/i.test(text)) score += 1;
  if (/\b(?:led|screens?|projectors?|holograms?|kiosks?|touch\s?screens?|vr|ar|displays?|lighting|sound|av|video\s+wall|interactive)\b/i.test(text)) score += 1;
  if (/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}\b/i.test(text)) score += 1;
  if (/\b\d+\s?(?:x|pcs|pieces|units|screens|sqm|m2|days)\b/i.test(text)) score += 1;
  if (text.length >= 160 || text.split(/\n/).length >= 3) score += 1;
  return score;
}

export function routeMessage(raw: string, ctx: RouteContext = {}): Route {
  const text = raw.trim();
  const intent = ctx.intent ?? null;
  const howTo = HOW_TO.test(text) || /^\s*(?:please\s+)?(?:show|tell)\s+me\s+how\b/i.test(text);
  // The hard exclusions and the protected areas come first, whatever shortcut was chosen: the text never leaves the app.
  const c = classifyRequest(text, { howTo: intent === "help" || howTo });
  if (!c.allowed) {
    // Inside a chosen shortcut the text is pasted material for that action: a protected or excluded request in it refuses the whole text, as before.
    if (intent && intent !== "help" && c.category !== "other_modules") return { kind: "excluded", category: c.category! };
    if (intent && intent !== "help") return { kind: "excluded", category: "other_modules" };
    if (c.category === "payroll_salary") return { kind: "protected", category: "compensation" };
    if (c.category === "leave_hr") return { kind: "protected", category: protectedTopic(text) ?? "private_leave" };
    if (c.category !== "other_modules") return { kind: "excluded", category: c.category! };
  }
  // A text that clearly is a client brief (or an explicit "create an enquiry" request) goes to the enquiry flow even when it mentions a price or a contact: that flow
  // separates those details locally and never sends them (sales/brief-outbound.ts). It is not a request to be told protected information.
  const clearBrief = !intent && (briefScore(text) >= 4 || (CREATE_ENQUIRY.test(text) && text.length >= 60));
  let topic = clearBrief ? null : protectedTopic(text);
  // Prices are only a "protected request" when the person asks to be TOLD a saved one ("what discount did we give?"). Asking for a draft that mentions a price the person
  // supplies ("draft a reply offering 85 per item") is ordinary writing.
  if (topic === "pricing" && (WRITE.test(text) || !(LIVE_ASK.test(text) || /\?\s*$/.test(text)))) topic = null;
  // (Inside a chosen Sales shortcut the text is material for that action: the outbound gate screens it and refuses it there.)
  if ((!intent || intent === "help") && topic && topic !== "credential" && topic !== "attachment" && !(howTo && findProtectedContent(text).length === 0)) return { kind: "protected", category: topic };
  if (intent && intent !== "help") return { kind: "mode", key: intent, chosen: true };

  if (text.length <= 80) {
    if (HOW_ARE_YOU.test(text)) return { kind: "greeting", flavour: "how_are_you" };
    if (HELLO.test(text)) return { kind: "greeting", flavour: "hello" };
    if (BYE.test(text)) return { kind: "greeting", flavour: "bye" };
    if (THANKS.test(text)) return { kind: "greeting", flavour: "thanks" };
    // "confirmed", "yes, create it": a chat line never saves anything. Only the confirm button on a review card does.
    if (CONFIRM.test(text)) return { kind: "greeting", flavour: "confirm" };
  }
  if (CAPABILITIES.test(text)) return { kind: "capabilities" };
  if (text.length <= 300) {
    if (MEM_SHOW.test(text)) return { kind: "memory", op: "show" };
    if (MEM_FORGET.test(text) && !ctx.hasChatContext) return { kind: "memory", op: "forget" };
    if (MEM_FORGET.test(text) && /\b(?:preferences?|memory|remember)\b/i.test(text)) return { kind: "memory", op: "forget" };
    if (MEM_SAVE.test(text)) return { kind: "memory", op: "save" };
  }
  if (!howTo && text.length <= 200) {
    if (OVERDUE.test(text)) return { kind: "lookup", period: periodIn(text) ?? "all" };
    // A follow-up to the lookup the person just ran ("show last month instead"): the lookup runs again, under today's permissions.
    if (ctx.lastLookup && text.length <= 60 && periodIn(text) && !WRITE.test(text)) return { kind: "lookup", period: periodIn(text)! };
    if (LIVE_ASK.test(text) || (!c.allowed && c.category === "other_modules")) {
      const area = LIVE.find((l) => l.re.test(text))?.area;
      if (area) return { kind: "unsupported_live", area };
    }
  }
  if (!c.allowed) return { kind: "unsupported_live", area: LIVE.find((l) => l.re.test(text))?.area ?? "people" };
  // The "Ask how something works" shortcut: published guidance (or an honest "no guidance"), after the protected, live and memory checks above.
  if (intent === "help") return { kind: "knowledge" };

  if (CREATE_ENQUIRY.test(text)) return text.length >= 60 || (text.match(LABELLED) ?? []).length >= 1 ? { kind: "brief" } : { kind: "need_brief" };
  if (text.length <= 240 && !howTo) {
    for (const i of INTENTS) if (i.re.test(text) && !(i.not && i.not.test(text))) return { kind: "mode", key: i.key, chosen: false };
    if (/^\s*(?:please\s+)?(?:draft|write)\b[^.\n]{0,40}\b(?:reply|response)\b/i.test(text) && (ctx.hasEnquiry || ENQUIRY_REFERENCE.test(text))) return { kind: "mode", key: "reply", chosen: false };
  }
  const brief = briefScore(text);
  if (brief >= 4) return { kind: "brief" };
  if (brief >= 2 && !QUESTION.test(text)) return { kind: "clarify_brief" };

  if (howTo || ((QUESTION.test(text) || /^\s*(?:explain|describe)\b/i.test(text)) && (ABOUT_APP.test(text) || (APP_QUESTION.test(text) && text.length <= 160 && !WRITE.test(text))))) return { kind: "knowledge" };
  if (WRITE.test(text)) return { kind: "chat", draft: true };
  if (ctx.hasChatContext && text.length <= 200 && REVISE.test(text)) return { kind: "chat", draft: true };
  if (QUESTION.test(text) || text.split(/\s+/).length >= 4) return { kind: "chat", draft: false };
  return { kind: "clarify" };
}
