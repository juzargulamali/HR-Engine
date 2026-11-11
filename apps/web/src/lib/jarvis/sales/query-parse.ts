import { CRM_STAGES } from "@enginious-hr/domain";

/**
 * A typed Sales question -> a QUERY DESCRIPTOR, deterministically and locally (no model reads the question). The descriptor is only a question: the server validates it
 * again with the action's own schema, authorises the person and the company again and reads everything through the person's own session.
 *
 * Nothing here lists whole sentences. A question is read by what it is about (follow-ups, enquiries, an enquiry reference, attention, a count or a summary), by its time
 * words and by its scope words ("my" or "our").
 */
export type ParsedQuery =
  | { kind: "lookup"; descriptor: Record<string, unknown> }
  | { kind: "summary"; descriptor: Record<string, unknown> }
  | { kind: "scope" };

const REFERENCE = /\bOPP-[A-Z0-9]{2,8}-\d{4}-\d{3,6}\b/i;
const FOLLOW_UP = /\bfollow[-\s]?ups?\b|\bnext\s+actions?\b|\breminders?\b/i;
const ENQUIRY = /\b(?:enquir(?:y|ies)|inquir(?:y|ies)|opportunit(?:y|ies)|pipeline|leads?|deals?)\b/i;
const ATTENTION = /\b(?:needs?|requires?|wants?)\s+(?:my|our)\s+attention\b|\bwhat\s+should\s+i\s+(?:do|focus\s+on|look\s+at|chase|work\s+on)\b|\bmy\s+(?:priorities|to-?dos?|to-?do\s+list)\b|\bwhat(?:'s|\s+is)\s+(?:urgent|on\s+my\s+plate|waiting\s+for\s+me)\b|\bwhere\s+should\s+i\s+start\b/i;
const INACTIVE = /\b(?:no|without|zero)\s+(?:recorded\s+)?(?:activit(?:y|ies)|contact|updates?)\b|\b(?:inactive|stale|untouched|neglected|dormant|forgotten)\b|\bnot\s+(?:been\s+)?(?:touched|updated|contacted|chased)\b|\bgone\s+(?:quiet|cold)\b|\bquiet\s+(?:enquir|for)\b/i;
const SUMMARISE = /\bsummar(?:y|ise|ize|ies|ising|izing)\b|\boverview\b|\brecap\b|\bround[-\s]?up\b/i;
const COUNT = /\bhow\s+many\b|\bcount\b|\bnumber\s+of\b|\btotal\s+(?:number|enquir)\b/i;
const COMPARE = /\bcompar(?:e|ed|ison)\b|\bversus\b|\bvs\.?\b|\bchanged?\b|\bthan\s+(?:the\s+)?(?:previous|last|before)\b|\bprevious\s+(?:period|month|year|equivalent)\b|\btrends?\b|\bup\s+or\s+down\b/i;
const WON_LOST = /\b(?:won|win|wins|winning|lost|lose|loses|losing|closed)\b/i;
const EVENTS = /\b(?:events?|exhibitions?|shows?|expos?|fairs?)\b/i;
const MOST = /\bmost\b|\btop\b|\brank|\bbiggest\b|\bbusiest\b/i;
const SCOPE_DRAFT = /\b(?:estimate|estimates|quotation|quote)\b[^.\n]{0,40}\b(?:scope|line\s+items?|line\s+descriptions?|deliverables|wording)\b|\b(?:scope|deliverables|line\s+items?|line\s+descriptions?)\b[^.\n]{0,40}\b(?:for|of)\b[^.\n]{0,20}\b(?:an?\s+|the\s+|this\s+|my\s+)?(?:estimate|quotation|quote)\b|\bscope\s+of\s+work\b/i;
/** The person is talking about a text they are giving, not asking about the records. */
const ABOUT_A_TEXT = /\b(?:this|the\s+following|below)\s+(?:e-?mail|message|text|note|notes|thread|conversation|paragraph|draft|brief|article)\b|:\s*\S[\s\S]{120,}$/i;
const COMPANY_WIDE = /\b(?:our|team(?:'s)?|company(?:'s)?|company[-\s]wide|everyone(?:'s)?|everybody|whole|all\s+(?:open\s+)?(?:enquir|the\s+enquir|of\s+(?:our|the)))\b/i;
const MINE = /\b(?:my|mine|i\s+own|i'm\s+working|assigned\s+to\s+me|owned\s+by\s+me)\b/i;

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30, sixty: 60, ninety: 90 };
/** "14 days", "two weeks", "a month" -> a number of days; null when the text gives none. */
export function daysIn(text: string): number | null {
  const m = /\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|ten|fourteen|thirty|sixty|ninety)\s+(day|week|month)s?\b/i.exec(text);
  if (m) { const n = WORDS[m[1]!.toLowerCase()] ?? Number(m[1]); return n * (m[2]!.toLowerCase() === "day" ? 1 : m[2]!.toLowerCase() === "week" ? 7 : 30); }
  if (/\bfortnight\b/i.test(text)) return 14;
  if (/\b(?:this|next|coming)\s+week\b/i.test(text)) return 7;
  if (/\b(?:this|next|coming)\s+month\b/i.test(text)) return 30;
  return null;
}

const PERIODS: { period: string; re: RegExp }[] = [
  { period: "last_month", re: /\b(?:last|previous)\s+month\b/i },
  { period: "this_month", re: /\bthis\s+month(?:'s)?\b|\bmonth\s+to\s+date\b|\bso\s+far\s+this\s+month\b/i },
  { period: "last_year", re: /\b(?:last|previous)\s+year\b/i },
  { period: "this_year", re: /\bthis\s+year(?:'s)?\b|\byear\s+to\s+date\b|\bytd\b/i },
  { period: "last_7_days", re: /\b(?:last|past)\s+(?:7|seven)\s+days\b|\b(?:last|past|this)\s+week\b/i },
  { period: "last_30_days", re: /\b(?:last|past)\s+(?:30|thirty)\s+days\b/i },
  { period: "last_90_days", re: /\b(?:last|past)\s+(?:90|ninety)\s+days\b|\b(?:last|past|this)\s+quarter\b|\b(?:last|past)\s+(?:3|three)\s+months\b/i },
];
export const summaryPeriodIn = (text: string): string | null => PERIODS.find((p) => p.re.test(text))?.period ?? null;

const STAGE_WORDS: { id: string; re: RegExp }[] = CRM_STAGES.filter((s) => s.open).map((s) => ({ id: s.id, re: new RegExp(`\\b${s.label.replace(/\s+/g, "\\s+")}\\b`, "i") }));
export const stageIn = (text: string): string | null => STAGE_WORDS.find((s) => s.re.test(text))?.id ?? null;

/** A proper name after "for", "from", "with", "at" or "linked to": an organisation or an event, to be searched (never trusted). */
export function nameIn(text: string): string | null {
  const m = /\b(?:for|from|with|at|linked\s+to|related\s+to|about)\s+(?:the\s+(?:client|agency|event|exhibition|show)\s+)?((?:[A-Z0-9][\w&'.-]*)(?:\s+(?:[A-Z0-9][\w&'.-]*|of|and|the|&|de|al))*)/.exec(text.replace(REFERENCE, ""));
  if (!m) return null;
  const name = m[1]!.replace(/\s+(?:of|and|the|&|de|al)$/i, "").replace(/[.,?!]+$/, "").trim();
  return name.length >= 2 && !/^(?:I|My|Our|Me|Us|Today|Tomorrow|This|Last|Next|Sales|CRM|Enginious\s+OS|JARVIS)$/i.test(name) ? name.slice(0, 120) : null;
}

/**
 * The Sales question a short message asks, or null when it is not one. `enquiryOnPage`: the person is on an enquiry's page ("summarise this enquiry").
 */
export function parseSalesQuery(raw: string, opts: { enquiryOnPage?: boolean } = {}): ParsedQuery | null {
  const text = raw.trim();
  if (text.length > 240 || ABOUT_A_TEXT.test(text)) return SCOPE_DRAFT.test(text.slice(0, 200)) && /^\s*(?:please\s+)?(?:draft|write|prepare|suggest|give|help|outline|list|what)\b/i.test(text) ? { kind: "scope" } : null;
  const reference = REFERENCE.exec(text)?.[0]?.toUpperCase() ?? null;
  const thisEnquiry = reference !== null || (opts.enquiryOnPage === true && /\b(?:this|the)\s+(?:enquiry|inquiry|opportunity|one)\b/i.test(text));
  // Scope wording for an estimate is a draft, not a lookup: it never reads a prepared estimate.
  if (SCOPE_DRAFT.test(text)) return { kind: "scope" };
  if (SUMMARISE.test(text) && thisEnquiry) return { kind: "summary", descriptor: { kind: "enquiry", reference } };
  if (ATTENTION.test(text)) return { kind: "lookup", descriptor: { kind: "attention" } };
  if (FOLLOW_UP.test(text) && !COUNT.test(text) && !SUMMARISE.test(text)) {
    if (/\b(?:overdue|late|past\s+due|missed)\b/i.test(text)) return null; // the existing overdue lookup answers this
    if (/\btoday\b/i.test(text)) return { kind: "lookup", descriptor: { kind: "followups", when: "today" } };
    if (/\b(?:upcoming|coming\s+up|coming|next|tomorrow|ahead|planned|scheduled|this\s+week|this\s+month|due\s+(?:in|within))\b/i.test(text)) return { kind: "lookup", descriptor: { kind: "followups", when: "upcoming", days: Math.min(60, daysIn(text) ?? 7) } };
    return null;
  }
  if (INACTIVE.test(text) && (ENQUIRY.test(text) || /\bclients?\b/i.test(text))) return { kind: "lookup", descriptor: { kind: "inactive", days: Math.min(365, daysIn(text) ?? 14) } };
  if (thisEnquiry && !SUMMARISE.test(text) && !COUNT.test(text) && /\b(?:status|stage|details?|where|what(?:'s|\s+is)|show|open|look\s+up|find|progress|follow[-\s]?ups?|next\s+steps?|latest)\b/i.test(text)) return { kind: "lookup", descriptor: { kind: "enquiry", reference } };
  if ((ENQUIRY.test(text) && (SUMMARISE.test(text) || COUNT.test(text) || COMPARE.test(text) || WON_LOST.test(text) || (EVENTS.test(text) && MOST.test(text)))) || (WON_LOST.test(text) && COUNT.test(text) && /\b(?:we|our|team|sales)\b/i.test(text))) {
    const focus = EVENTS.test(text) && MOST.test(text) ? "events" : WON_LOST.test(text) && !SUMMARISE.test(text) ? "won_lost" : "all";
    return { kind: "summary", descriptor: { kind: "period", period: summaryPeriodIn(text) ?? "this_month", compare: COMPARE.test(text), focus, narrative: SUMMARISE.test(text) || /\bwhat\s+changed\b|\bexplain\b|\bdescribe\b/i.test(text) } };
  }
  if (COMPARE.test(text) && /\b(?:previous|last|before)\b/i.test(text) && /\b(?:period|month|year|week|quarter)\b/i.test(text) && /\bsales\b/i.test(text)) return { kind: "summary", descriptor: { kind: "period", period: summaryPeriodIn(text) ?? "this_month", compare: true, focus: "all", narrative: true } };
  if (ENQUIRY.test(text)) {
    const named = nameIn(text);
    return { kind: "lookup", descriptor: { kind: "enquiries", scope: COMPANY_WIDE.test(text) && !MINE.test(text) ? "company" : named && !MINE.test(text) ? "company" : "mine", stage: stageIn(text), named } };
  }
  return null;
}

/**
 * A short follow-up to the lookup or summary the panel last showed ("show last month instead", "the whole company", "make it 30 days", "compare with the previous period",
 * "make that shorter"): the SAME kind of question with one thing changed. Returns null when the text does not change it. The result is validated and run like any other.
 */
export function refineQuery(raw: string, last: { kind: "lookup" | "summary"; descriptor: Record<string, unknown> }): ParsedQuery | null {
  const text = raw.trim();
  if (text.length > 90 || ABOUT_A_TEXT.test(text)) return null;
  const d = last.descriptor;
  if (last.kind === "summary") {
    if (d.kind === "enquiry") return /\b(?:shorter|short|brief(?:er)?|again|retry|try\s+again)\b/i.test(text) ? { kind: "summary", descriptor: { ...d } } : null;
    const period = summaryPeriodIn(text);
    const compare = COMPARE.test(text);
    const words = /\b(?:shorter|short|brief(?:er)?|in\s+words|explain|describe|summar(?:y|ise|ize))\b/i.test(text);
    const focus = EVENTS.test(text) && MOST.test(text) ? "events" : /\bwon\b|\blost\b/i.test(text) && !period && !compare ? "won_lost" : null;
    if (!period && !compare && !words && !focus) return null;
    return { kind: "summary", descriptor: { ...d, ...(period ? { period } : {}), ...(compare ? { compare: true } : {}), ...(words ? { narrative: true } : {}), ...(focus ? { focus } : {}) } };
  }
  if (d.kind === "followups") {
    if (/\btoday\b/i.test(text)) return { kind: "lookup", descriptor: { kind: "followups", when: "today" } };
    const days = daysIn(text);
    return days ? { kind: "lookup", descriptor: { kind: "followups", when: "upcoming", days: Math.min(60, days) } } : null;
  }
  if (d.kind === "inactive") { const days = daysIn(text); return days ? { kind: "lookup", descriptor: { kind: "inactive", days: Math.min(365, days) } } : null; }
  if (d.kind === "enquiries") {
    const stage = stageIn(text);
    const scope = COMPANY_WIDE.test(text) && !MINE.test(text) ? "company" : MINE.test(text) ? "mine" : null;
    const allStages = /\b(?:all|any)\s+stages?\b|\bevery\s+stage\b/i.test(text);
    if (!stage && !scope && !allStages) return null;
    return { kind: "lookup", descriptor: { ...d, ...(scope ? { scope } : {}), ...(stage ? { stage } : allStages ? { stage: null } : {}) } };
  }
  return null;
}
