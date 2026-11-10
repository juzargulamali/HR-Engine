import { describeProtected, findProtectedContent, wholeTextRestricted, type ProtectedCategory } from "../protected";
import { RESTRICTED_TEXT_MESSAGE } from "../outbound-messages";
import { intendedOutcome } from "../router";
import { LIMITS } from "./enquiry-values";

/**
 * What an "enquiry from a brief" request sends to the AI provider, decided LOCALLY before any provider call.
 *
 * The text a person deliberately submits for this task goes out as they wrote it: project and company names, the client, agency and end client, the venue, dates, the game
 * journey, technical requirements, quantities, quoted prices, unit rates and client budgets. Nothing useful is stripped, summarised or cut.
 *
 * Three things do not go:
 *   - a brief restricted AS A WHOLE ("External sharing prohibited", "Internal use only", "NDA", "Confidential": `wholeTextRestricted`, enforced again at the outbound gate):
 *     no provider call in any version; the person uses the new-enquiry form; an edited text does not lift the restriction;
 *   - genuinely restricted material inside an otherwise usable brief (employee documents, salaries, medical records, personal IDs, bank details, credentials, company
 *     financial statements, internal costing and margins): the brief is NOT sent automatically. The person is shown a clean excerpt (the brief without those sentences) to
 *     check, edit and send, or continues with the form;
 *   - email addresses and phone numbers: replaced by "[contact withheld]" (they are not needed to prepare an enquiry).
 *
 * What the model reads is separate from what the app saves: the client, agency and end client named on labelled lines and the client's budget are read HERE, not taken from
 * the model. The Brief field of the card takes the model's SUMMARY only after `projectBrief` below has checked it is one; otherwise the card says so.
 */
export interface PreparedBrief {
  /** The text for the provider (when `separable`), or the proposed clean excerpt for the person to review (when not). */
  outbound: string;
  /** What was left out of the proposed text, by kind, in words for the person. */
  withheld: { label: string; count: number }[];
  parties: { agency: string | null; client: string | null };
  /** The client's budget for the review card. `value` and `currency` only for ONE clearly stated client budget; otherwise blank, with the original wording in `note`. */
  budget: { currency: string | null; value: number | null; note: string | null };
  /** A budget was mentioned but is not one exact client budget (a range, several values, an internal figure, or not said to be the client's). */
  budgetUnclear: boolean;
  /** True when the text can go out as prepared. False = restricted material was found: the person reviews the clean excerpt or uses the form. */
  separable: boolean;
  remaining: ProtectedCategory[];
  /** The brief as a WHOLE is marked restricted: nothing may be sent, in any version. */
  restricted: boolean;
}

const CUR = "(?:aed|usd|sar|eur|gbp|qar|omr|kwd|bhd|dhs?|dirhams?|riyals?|dollars?|euros?|pounds?)";
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?<![\w-])\+?\d[\d\s().-]{7,16}\d(?![\w-])/g;
/**
 * Is this run of digits really a phone number? A budget range ("AED 50000-65000"), an amount, a date or a pair of years is not. A phone number has 8 to 15 digits and looks
 * like one: an international or trunk prefix (+, 00, 0), brackets, or digits grouped by spaces; it does not follow a currency.
 */
function isPhone(match: string, before: string): boolean {
  const m = match.trim();
  const digits = m.replace(/\D/g, "").length;
  if (digits < 8 || digits > 15) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(m) || /^\d{1,3}(?:[,.]\d{3})+/.test(m)) return false;
  if (new RegExp(`(?:${CUR}|[$€£])\\.?\\s?$`, "i").test(before)) return false;   // "AED 50000-65000"
  if (/^[1-9]\d{2,6}\s?[-–.]\s?[1-9]\d{2,6}$/.test(m)) return false;                 // two plain numbers: a range, not a number to call
  return /^(?:\+|00|0)/.test(m) || /[()]/.test(m) || /\d\s+\d/.test(m) || digits >= 10;
}
const PARTY = /^\s*(agency|end[\s-]?client|brand|client|customer)\s*:\s*(.+?)\s*$/i;

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6 };
const AMT = new RegExp(`(${CUR})\\.?\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k|m|mn|million|thousand)?\\b|(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k|m|mn|million|thousand)?(?:\\s?(${CUR})\\b)?`, "i");
const RANGE = /\d\s?(?:k|m|mn)?\s*(?:-|–|—|to|and|or|\/)\s*(?:[a-z]{3}\s?)?\d|\b(?:between|from|around|about|approx\w*|roughly|up\s+to|at\s+least|max(?:imum)?|min(?:imum)?|circa|~)\b/i;

/** Every budget mention, and the ONE exact client budget if there is exactly one. */
function readBudget(lines: string[]): { budget: PreparedBrief["budget"]; unclear: boolean } {
  const exact: { currency: string | null; value: number | null }[] = [];
  const wording: string[] = [];
  let unclear = false;
  for (const whole of lines) {
    for (const hit of whole.matchAll(/\bbudget\b/gi)) {
      // What FOLLOWS the word "budget", up to the end of that sentence: an earlier quote or price on the same line is not this budget.
      const l = whole.slice(hit.index!).split(/(?<=[.!?])\s+(?=[A-Z])/)[0]!;
      const rest = l.replace(/^budget(?:\s+note)?\s*(?::|is|of|=)*\s*/i, "");
      const m = AMT.exec(rest);
      if (!m) continue;
      const before = whole.slice(Math.max(0, hit.index! - 30), hit.index!).split(/[.!?]\s/).pop()!;
      const internal = /\b(?:internal|our|target|cost|crew|production)\s+(?:\w+\s+)?$/i.test(before);
      const isClient = !internal && (/\b(?:end[\s-]?client|client|customer|brand)(?:['’]s)?\s+(?:total\s+|overall\s+|approved\s+|maximum\s+|max\s+)?$/i.test(before) || /\btheir\s+(?:total\s+|overall\s+|approved\s+)?$/i.test(before) || /^budget\s+(?:from|of|given\s+by|set\s+by)\s+the\s+(?:end\s+)?client\b/i.test(l));
      // An internal figure is never the client's budget and its wording is not copied to the card (it is internal costing).
      if (internal) { unclear = true; continue; }
      wording.push(`${before.trim() ? `${before.trim()} ` : ""}${l}`.trim());
      if (!isClient || RANGE.test(rest)) { unclear = true; continue; }
      const num = Number((m[2] ?? m[4])!.replace(/,/g, "")) * (SCALE[(m[3] ?? m[5] ?? "").toLowerCase()] ?? 1);
      const cur = (m[1] ?? m[6] ?? "").toUpperCase();
      exact.push({ value: Number.isFinite(num) ? num : null, currency: /^[A-Z]{3}$/.test(cur) ? cur : /^DH|DIRHAM/.test(cur) ? "AED" : /^RIYAL/.test(cur) ? "SAR" : /^DOLLAR/.test(cur) ? "USD" : /^EURO/.test(cur) ? "EUR" : /^POUND/.test(cur) ? "GBP" : null });
    }
  }
  const distinct = new Set(exact.map((b) => `${b.currency}:${b.value}`));
  const one = distinct.size === 1 && !unclear;
  // The ORIGINAL wording is always kept for the reviewer; the numeric fields are filled only for one exact client budget.
  const note = wording.length > 0 ? wording.join(" | ").slice(0, LIMITS.budgetNote) : null;
  return { budget: { currency: one ? exact[0]!.currency : null, value: one ? exact[0]!.value : null, note }, unclear: (wording.length > 0 || unclear) && !one };
}

export function prepareBrief(original: string): PreparedBrief {
  const counts = new Map<string, number>();
  const hold = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);
  const lines = original.replace(/\r\n?/g, "\n").split("\n");

  // 1. The parties named on labelled lines are read here, so the client, the end client and the agency stay distinct whatever the model returns.
  const named: Record<string, string> = {};
  for (const l of lines) { const m = PARTY.exec(l); if (m) named[m[1]!.toLowerCase().replace(/[\s-]/g, "")] = m[2]!.replace(/[.;,]+$/, "").trim().slice(0, 200); }
  const endClient = named.endclient ?? named.brand ?? null;
  // "Client" next to an "End client" is the party the brief comes through (the agency field); alone, it is the end client.
  const agency = named.agency ?? (endClient ? named.client ?? named.customer ?? null : null);
  const client = endClient ?? (named.agency || !endClient ? named.client ?? named.customer ?? null : null);

  // 2. The budget for the review card.
  const { budget, unclear: budgetUnclear } = readBudget(lines);

  // 3. The text as submitted, minus contacts. A sentence with genuinely restricted material is left out of the PROPOSED text, and then the brief is not sent automatically.
  let found = false;
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) { out.push(line); continue; }
    const kept: string[] = [];
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)) {
      const s = sentence
        .replace(EMAIL, () => { hold("contact details"); return "[contact withheld]"; })
        .replace(PHONE, (m, offset: number, whole: string) => (isPhone(m, whole.slice(Math.max(0, offset - 12), offset)) ? (hold("contact details"), "[contact withheld]") : m));
      const cats = findProtectedContent(s);
      if (cats.length > 0) { found = true; hold(describeProtected(cats)); continue; }
      kept.push(s);
    }
    if (kept.length > 0) out.push(kept.join(" "));
  }
  const outbound = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const remaining = findProtectedContent(outbound);
  const restricted = wholeTextRestricted(original);
  return {
    outbound: restricted ? "" : outbound, withheld: [...counts].map(([label, count]) => ({ label, count })), parties: { agency, client }, budget, budgetUnclear,
    separable: !restricted && !found && remaining.length === 0 && outbound.length > 0, remaining, restricted,
  };
}

export const RESTRICTED_BRIEF_MESSAGE = `${RESTRICTED_TEXT_MESSAGE} To add an enquiry, enter it yourself with the new-enquiry form.`;
export const BUDGET_UNCLEAR_NOTE = "The brief mentions a budget that is not one exact client budget (a range, more than one value, or not clearly the client's), so I left the value blank and kept the wording in the budget note for you to check.";

export const withheldNote = (p: Pick<PreparedBrief, "withheld">): string | null => {
  const parts = p.withheld.map((w) => `${w.label} (${w.count})`);
  return parts.length === 0 ? null : `Not sent to Anthropic: ${parts.join("; ")}. The Brief below is a summary; your pasted text is not saved.`;
};

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The model's summary, accepted as the enquiry's Brief only when it IS a summary. Returns null (the card then says no summary could be written) when it is empty or is the
 * pasted text again (nearly as long as it, or a long verbatim run of it). A sentence that is an instruction to JARVIS ("Turn this conversation into an enquiry ...") is
 * dropped: it is not a fact about the project. Nothing is cut to fit: the length limit is enforced earlier and an over-long summary is not used at all.
 */
export function projectBrief(summary: string | null, original: string): string | null {
  if (!summary) return null;
  const kept = summary.split(/(?<=[.!?:])\s+/).filter((s) => intendedOutcome(s) === null && !/\bjarvis\b/i.test(s)).join(" ").trim();
  const s = norm(kept), o = norm(original);
  if (!s) return null;
  if (o.length >= 300 && (s.length >= 0.8 * o.length || (s.length >= 240 && o.includes(s)))) return null;
  return kept;
}

/** Does the text show that Enginious itself made the call or the approach? Only then is "Agency call (outbound)" a source the model may choose. */
export function madeOutboundContact(text: string): boolean {
  return /\b(?:i|we|our\s+team|enginious)\s+(?:just\s+|have\s+|had\s+)?(?:called|rang|phoned|cold[-\s]?called|reached\s+out|contacted|approached)\b|\boutbound\b|\bcold[-\s]?call/i.test(text);
}

export const NO_SUMMARY_NOTE = "I could not write a summary of this brief, so the Brief field holds your text as you pasted it, not a summary. Edit it down before you create the enquiry.";
export const NO_SUMMARY_TOO_LONG_NOTE = "I could not write a summary of this brief and your text is longer than the Brief field holds, so the Brief field is empty. Write a short brief below; nothing was cut from what you pasted.";
