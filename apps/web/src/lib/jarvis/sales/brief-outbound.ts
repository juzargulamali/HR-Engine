import { describeProtected, findProtectedContent, hasCommercialFigure, type ProtectedCategory } from "../protected";
import { LIMITS } from "./enquiry-values";

/**
 * What an explicit "create an enquiry" request may send to the AI provider: the FULL approved, non-sensitive narrative of the brief (event context, venue, dates, the visitor
 * or game journey, technical requirements, equipment, deliverables), prepared LOCALLY before any provider call. The model is never relied on to remove anything.
 *
 *   kept inside Enginious OS (never sent)     how
 *   pricing, budgets, costs, margins, rates    a labelled money line ("Budget: ...") and any sentence about a price, quote, budget, discount or rate are withheld whole; a
 *                                              stray figure in a narrative sentence is replaced by "[amount withheld]"; a client's budget is read locally for the review card
 *   contact details (email, phone)             replaced by "[contact withheld]"
 *   personal and employee data, credentials,   the sentence or line is withheld whole
 *   contracts, client-restricted material
 *   private party identities                   the agency / client / end client named on a labelled line are replaced by placeholders ([AGENCY], [CLIENT], [END CLIENT]) and
 *                                              resolved inside Enginious OS; names that only appear in the narrative (public names) stay as written
 *
 * Nothing is truncated: the original brief stays in Enginious OS for the review card and is saved only by the confirmed enquiry. After the separation the result is screened
 * again; if anything protected is still there the brief is NOT sent (`separable: false`): the person reviews and edits the text that would be sent, or uses the form.
 */
export interface PreparedBrief {
  /** The text for the provider. */
  outbound: string;
  /** What was kept inside Enginious OS, by kind, in words for the person. */
  withheld: { label: string; count: number }[];
  /** placeholder -> the real name (resolved locally; never sent). */
  placeholders: Record<string, string>;
  parties: { agency: string | null; client: string | null };
  /** The client's stated budget, read locally (never sent). */
  budget: { currency: string | null; value: number | null; note: string | null };
  /** A budget was mentioned but could not be autofilled (not explicitly the client's, or more than one): the reviewer enters it. */
  budgetUnclear: boolean;
  separable: boolean;
  remaining: ProtectedCategory[];
  /** The brief as a WHOLE is marked restricted (an NDA or confidentiality heading or notice): nothing may be sent, in any version; the person uses the form. */
  restricted: boolean;
}

const CUR = "(?:aed|usd|sar|eur|gbp|qar|omr|kwd|bhd|dhs?|dirhams?|riyals?|dollars?|euros?|pounds?)";
const AMOUNT = new RegExp(`(?:${CUR}\\.?\\s?\\d[\\d,.]*\\s?(?:k|m|mn|million|thousand)?\\b|[$€£]\\s?\\d[\\d,.]*\\s?(?:k|m|mn|million|thousand)?|\\d[\\d,.]*\\s?(?:k|m|mn|million|thousand)?\\s?${CUR}\\b|\\b\\d+(?:\\.\\d+)?\\s?(?:%|percent\\b|per\\s?cent\\b))`, "gi");
const MONEY_LINE = /^\s*(?:total\s+)?(?:client\s+)?(?:budget|budget\s+note|price|pricing|cost|costs|quote|quotation|estimate|rate|rates|fee|fees|discount|margin|mark-?up|payment(?:\s+terms)?|commercials?|value|deposit|invoice|po)\s*:/i;
const MONEY_WORD = /\b(?:budget|price[ds]?|pricing|cost(?:s|ing)?|quot(?:e|ed|es|ation)|estimate[ds]?|rates?|fees?|discount(?:s|ed)?|margins?|mark-?up|profit|invoice[ds]?|payment|deposit|commission)\b/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?<![\w-])\+?\d[\d\s().-]{7,16}\d(?![\w-])/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESTRICTED = /\b(?:contract(?:s|ual)?|agreement|nda|non-?disclosure|confidential(?:ity)?|do\s+not\s+(?:share|forward|distribute)|not\s+for\s+(?:distribution|sharing)|internal\s+(?:use\s+)?only|client[-\s]restricted|restricted|under\s+embargo|embargoed|privileged|terms\s+and\s+conditions|legal\s+terms|penalt(?:y|ies)|liabilit(?:y|ies)|indemnit\w+)\b/i;
/** A restriction that covers the whole brief, not one sentence. */
const WHOLE_MARK = /\b(?:nda|non-?disclosure|confidential(?:ity)?|strictly\s+private|internal\s+(?:use\s+)?only|do\s+not\s+(?:share|forward|distribute|circulate)|not\s+for\s+(?:distribution|sharing|circulation)|client[-\s]restricted|restricted|under\s+embargo|embargoed|privileged)\b/i;
const WHOLE_STATEMENT = /\b(?:this|the)\s+(?:brief|document|e-?mail|message|information|material|project)\b[^.\n]{0,40}\b(?:is|are|remains?)\b[^.\n]{0,20}\b(?:confidential|under\s+(?:an?\s+)?nda|restricted|privileged|embargoed)\b|\b(?:covered\s+by|subject\s+to|under)\s+(?:an?\s+|the\s+|our\s+)?(?:nda|non-?disclosure)\b/i;
const FIELD_LINE = /^\s*[A-Za-z][A-Za-z ]{1,24}:\s*\S/;

/** Is the brief as a whole marked restricted? A marking in the heading (the first three lines), a short standalone notice line anywhere, or a sentence saying the brief itself is confidential or under NDA. */
export function wholeBriefRestricted(original: string): boolean {
  const lines = original.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.slice(0, 3).some((l) => WHOLE_MARK.test(l))) return true;
  if (lines.some((l) => l.length <= 90 && WHOLE_MARK.test(l) && (!FIELD_LINE.test(l) || /^\s*(?:classification|status|notice|note|marking|confidentiality)\s*:/i.test(l)))) return true;
  return WHOLE_STATEMENT.test(original);
}

const MONEY_CATS: ProtectedCategory[] = ["pricing", "project_financials", "reimbursement"];
const PARTY = /^\s*(agency|end[\s-]?client|brand|client|customer)\s*:\s*(.+?)\s*$/i;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function prepareBrief(original: string): PreparedBrief {
  const counts = new Map<string, number>();
  const hold = (label: string, n = 1) => counts.set(label, (counts.get(label) ?? 0) + n);
  const lines = original.replace(/\r\n?/g, "\n").split("\n");

  // 1. The parties named on labelled lines: resolved inside Enginious OS, sent as placeholders.
  const named: Record<string, string> = {};
  for (const l of lines) { const m = PARTY.exec(l); if (m) named[m[1]!.toLowerCase().replace(/[\s-]/g, "")] = m[2]!.replace(/[.;,]+$/, "").trim().slice(0, 200); }
  const endClient = named.endclient ?? named.brand ?? null;
  // "Client" next to an "End client" is the party the brief comes through (the agency field); alone, it is the end client.
  const agency = named.agency ?? (endClient ? named.client ?? named.customer ?? null : null);
  const client = endClient ?? (named.agency || !endClient ? named.client ?? named.customer ?? null : null);
  const placeholders: Record<string, string> = {};
  if (agency) placeholders[named.agency ? "[AGENCY]" : "[CLIENT]"] = agency;
  if (client && client !== agency) placeholders["[END CLIENT]"] = client;

  // 2. The client's budget, read locally for the review card. Autofilled ONLY when it is explicitly the client's and unambiguous: every budget mention is found, and one
  //    counts as the client's only when the words say so ("Client budget: ...", "the client's budget is ...", "their budget"). An unlabelled "Budget:", an internal budget,
  //    or two different client budgets are left for the reviewer. No budget of any kind is ever sent.
  const budget: PreparedBrief["budget"] = { currency: null, value: null, note: null };
  const clientBudgets: PreparedBrief["budget"][] = [];
  let mentions = 0;
  const AMT = new RegExp(`(${CUR})\\.?\\s?(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k|m|mn|million|thousand)?|(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k|m|mn|million|thousand)?(?:\\s?(${CUR})\\b)?`, "i");
  for (const whole of lines) {
    for (const hit of whole.matchAll(/\bbudget\b/gi)) {
      // What FOLLOWS the word "budget", up to the end of that sentence: an earlier quote or price on the same line is not this budget.
      const l = whole.slice(hit.index!).split(/(?<=[.!?])\s+(?=[A-Z])/)[0]!;
      const m = AMT.exec(l.replace(/^budget/i, ""));
      if (!m) continue;
      mentions += 1;
      const before = whole.slice(Math.max(0, hit.index! - 30), hit.index!).split(/[.!?]\s/).pop()!;
      const isClient = /\b(?:end[\s-]?client|client|customer|brand)(?:['’]s)?\s+(?:total\s+|overall\s+|approved\s+|maximum\s+|max\s+)?$/i.test(before) || /\btheir\s+(?:total\s+|overall\s+|approved\s+)?$/i.test(before) || /^budget\s+(?:from|of|given\s+by|set\s+by)\s+the\s+(?:end\s+)?client\b/i.test(l);
      if (!isClient || /\b(?:internal|our|target|cost|margin)\s+(?:\w+\s+)?$/i.test(before)) continue;
      const num = Number((m[2] ?? m[4])!.replace(/,/g, "")) * ({ k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6 }[(m[3] ?? m[5] ?? "").toLowerCase()] ?? 1);
      const cur = (m[1] ?? m[6] ?? "").toUpperCase();
      const note = l.replace(/^budget(?:\s+note)?\s*(?::|is|of|around|about|approx(?:imately)?\.?)*\s*/i, "").trim();
      clientBudgets.push({
        value: Number.isFinite(num) ? num : null,
        currency: /^[A-Z]{3}$/.test(cur) ? cur : /^DH|DIRHAM/.test(cur) ? "AED" : /^RIYAL/.test(cur) ? "SAR" : /^DOLLAR/.test(cur) ? "USD" : /^EURO/.test(cur) ? "EUR" : /^POUND/.test(cur) ? "GBP" : null,
        // A bare figure is already in the value field; anything more (conditions, "excluding VAT") is kept as the note.
        note: note.replace(m[0], "").replace(/[\s.,;:()-]+/g, "") ? note.slice(0, LIMITS.budgetNote) : null,
      });
    }
  }
  const distinct = new Set(clientBudgets.map((b) => `${b.currency}:${b.value}`));
  if (distinct.size === 1) Object.assign(budget, clientBudgets[0]);
  const budgetUnclear = mentions > 0 && distinct.size !== 1;

  // 3. Line by line, sentence by sentence: withhold or redact, never truncate.
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) { out.push(line); continue; }
    if (MONEY_LINE.test(line)) { hold("pricing, budget or cost details"); continue; }
    const kept: string[] = [];
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)) {
      let s = sentence;
      if (RESTRICTED.test(s)) { hold("contract or restricted material"); continue; }
      s = s.replace(EMAIL, () => { hold("contact details"); return "[contact withheld]"; });
      s = s.replace(PHONE, (m) => (ISO_DATE.test(m.trim()) || /^\d{4}\s*(?:-|to)\s*\d{4}$/.test(m.trim()) ? m : (hold("contact details"), "[contact withheld]")));
      let cats = findProtectedContent(s);
      AMOUNT.lastIndex = 0;
      const figure = AMOUNT.test(s);
      AMOUNT.lastIndex = 0;
      // A sentence ABOUT pricing (a quote, a budget, a discount, a rate) is withheld whole, with or without a currency ("Our final quote is 85000"). A stray figure in a
      // narrative sentence is replaced, so the sentence keeps its meaning. Dates, quantities and durations are not amounts and stay.
      if ((figure && MONEY_WORD.test(s)) || hasCommercialFigure(s)) { hold("pricing, budget or cost details"); continue; }
      if (figure || cats.some((c) => MONEY_CATS.includes(c))) {
        s = s.replace(AMOUNT, () => { hold("pricing, budget or cost details"); return "[amount withheld]"; });
        AMOUNT.lastIndex = 0;
        cats = findProtectedContent(s);
      }
      if (cats.length > 0) { hold(describeProtected(cats)); continue; }
      kept.push(s);
    }
    if (kept.length > 0) out.push(kept.join(" "));
  }
  let outbound = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  for (const [ph, name] of Object.entries(placeholders)) if (name.length >= 2) outbound = outbound.replace(new RegExp(`(?<![\\w])${escape(name)}(?![\\w])`, "gi"), ph);

  // 4. The separated text must pass the same screen the outbound gate applies. If it does not, it is not sent.
  const remaining = findProtectedContent(outbound);
  const restricted = wholeBriefRestricted(original);
  return { outbound: restricted ? "" : outbound, withheld: [...counts].map(([label, count]) => ({ label, count })), placeholders, parties: { agency, client }, budget, budgetUnclear, separable: !restricted && remaining.length === 0 && outbound.length > 0, remaining, restricted };
}

/** Placeholders in anything the model returned are turned back into the real names, inside Enginious OS. */
export function restoreNames<T>(value: T, placeholders: Record<string, string>): T {
  if (typeof value === "string") {
    let s: string = value;
    for (const [ph, name] of Object.entries(placeholders)) s = s.split(ph).join(name);
    return s.replace(/\s*\[(?:amount|contact) withheld\]/g, "").trim() as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => restoreNames(v, placeholders)) as unknown as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreNames(v, placeholders)])) as T;
  return value;
}

export const RESTRICTED_BRIEF_MESSAGE = "This brief is marked as restricted (an NDA, confidentiality or internal-only marking that covers the whole text), so I have not sent any of it to the AI model and will not prepare it here. Enter it yourself with the new-enquiry form.";
export const BUDGET_UNCLEAR_NOTE = "A budget is mentioned in the brief, but not one clearly and only the client's, so I left the value and budget note blank for you to fill in.";

export const withheldNote = (p: Pick<PreparedBrief, "withheld" | "placeholders">): string | null => {
  const parts = p.withheld.map((w) => `${w.label} (${w.count})`);
  if (Object.keys(p.placeholders).length > 0) parts.push("the client and agency names (sent as placeholders and matched here)");
  return parts.length === 0 ? null : `Kept inside Enginious OS and not sent to the AI model: ${parts.join("; ")}. Your original brief is kept below and is saved only when you create the enquiry.`;
};
