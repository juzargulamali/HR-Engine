import { describeProtected, findProtectedContent, type ProtectedCategory } from "../protected";
import { LIMITS } from "./enquiry-values";

/**
 * What an "enquiry from a brief" request sends to the AI provider, decided LOCALLY before any provider call.
 *
 * The text a person deliberately submits for this task goes out as they wrote it: project and company names, the client, agency and end client, the venue, dates, the game
 * journey, technical requirements, quantities, quoted prices, unit rates and client budgets. Nothing useful is stripped, summarised or cut.
 *
 * Three things do not go:
 *   - a brief restricted AS A WHOLE ("External sharing prohibited", "Internal use only", "NDA", "Confidential" in the heading, as a notice line, or said of the brief itself):
 *     no provider call in any version; the person uses the new-enquiry form; an edited text does not lift the restriction;
 *   - genuinely restricted material inside an otherwise usable brief (employee documents, salaries, medical records, personal IDs, bank details, credentials, company
 *     financial statements, internal costing and margins): the brief is NOT sent automatically. The person is shown a clean excerpt (the brief without those sentences) to
 *     check, edit and send, or continues with the form;
 *   - email addresses and phone numbers: replaced by "[contact withheld]" (they are not needed to prepare an enquiry).
 *
 * What the model reads is separate from what the app saves: the client, agency and end client named on labelled lines and the client's budget are read HERE, not taken from
 * the model. The original brief stays in Enginious OS for the review card and is saved only by the confirmed enquiry.
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
const NOT_PHONE = /^\d{4}-\d{2}-\d{2}$|^\d{4}\s*(?:-|to)\s*\d{4}$|^\d{1,3}(?:[,.]\d{3})+$|^\d{1,3}(?:,\d{3})+\s*[-–]\s*\d{1,3}(?:,\d{3})+$/;
const PARTY = /^\s*(agency|end[\s-]?client|brand|client|customer)\s*:\s*(.+?)\s*$/i;

/** A restriction that covers the whole brief, not one sentence. */
const WHOLE_MARK = /\b(?:nda|non-?disclosure|confidential(?:ity)?|strictly\s+private|internal\s+(?:use\s+)?only|external\s+sharing\s+(?:is\s+)?(?:prohibited|not\s+(?:allowed|permitted))|(?:prohibited|barred)\s+from\s+external\s+sharing|not\s+for\s+external\s+(?:sharing|use|distribution|circulation)|do\s+not\s+(?:share|forward|distribute|circulate)|not\s+for\s+(?:distribution|sharing|circulation)|client[-\s]restricted|restricted|under\s+embargo|embargoed|privileged)\b/i;
const WHOLE_STATEMENT = /\b(?:this|the)\s+(?:brief|document|e-?mail|message|information|material|project)\b[^.\n]{0,40}\b(?:is|are|remains?|must)\b[^.\n]{0,30}\b(?:confidential|under\s+(?:an?\s+)?nda|restricted|privileged|embargoed|not\s+be\s+shared\s+externally)\b|\b(?:covered\s+by|subject\s+to|under)\s+(?:an?\s+|the\s+|our\s+)?(?:nda|non-?disclosure)\b/i;
const FIELD_LINE = /^\s*[A-Za-z][A-Za-z ]{1,24}:\s*\S/;

/** Is the brief as a whole marked restricted? A marking in the heading (the first three lines), a short standalone notice line anywhere, or a sentence saying the brief itself is restricted. */
export function wholeBriefRestricted(original: string): boolean {
  const lines = original.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.slice(0, 3).some((l) => WHOLE_MARK.test(l))) return true;
  if (lines.some((l) => l.length <= 90 && WHOLE_MARK.test(l) && (!FIELD_LINE.test(l) || /^\s*(?:classification|status|notice|note|marking|confidentiality)\s*:/i.test(l)))) return true;
  return WHOLE_STATEMENT.test(original);
}

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
        .replace(PHONE, (m) => (NOT_PHONE.test(m.trim()) ? m : (hold("contact details"), "[contact withheld]")));
      const cats = findProtectedContent(s);
      if (cats.length > 0) { found = true; hold(describeProtected(cats)); continue; }
      kept.push(s);
    }
    if (kept.length > 0) out.push(kept.join(" "));
  }
  const outbound = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const remaining = findProtectedContent(outbound);
  const restricted = wholeBriefRestricted(original);
  return {
    outbound: restricted ? "" : outbound, withheld: [...counts].map(([label, count]) => ({ label, count })), parties: { agency, client }, budget, budgetUnclear,
    separable: !restricted && !found && remaining.length === 0 && outbound.length > 0, remaining, restricted,
  };
}

export const RESTRICTED_BRIEF_MESSAGE = "This brief is marked as restricted from external sharing (for example NDA, confidential, internal use only or external sharing prohibited), so I have not sent any of it to Anthropic and will not prepare it here. Enter it yourself with the new-enquiry form.";
export const BUDGET_UNCLEAR_NOTE = "The brief mentions a budget that is not one exact client budget (a range, more than one value, or not clearly the client's), so I left the value blank and kept the wording in the budget note for you to check.";

export const withheldNote = (p: Pick<PreparedBrief, "withheld">): string | null => {
  const parts = p.withheld.map((w) => `${w.label} (${w.count})`);
  return parts.length === 0 ? null : `Not sent to Anthropic: ${parts.join("; ")}. Your original brief is kept below and is saved only when you create the enquiry.`;
};
