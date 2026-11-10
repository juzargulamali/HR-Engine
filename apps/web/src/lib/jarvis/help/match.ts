import type { GuidanceEntry } from "./guidance";

/**
 * MATCHING A QUESTION TO THE PUBLISHED GUIDANCE BY MEANING, deterministically (no model, so no invented answers and nothing leaves Enginious OS).
 *
 * A question and a guide are compared as sets of CONCEPTS, not as strings: words are reduced to a stem, and words that mean the same thing in this app share one concept
 * ("exhibition", "trade show", "expo" and "fair" are the event concept; "customer" and "account" are the client concept; "create", "log" and "register" are the add concept).
 * A guide's concepts come from its title, the phrases people use for it, its summary and steps, and the navigation's own name for its screens. Rare concepts count for more
 * than common ones. The screen the person is on favours the guide written for that screen, so the most specific relevant guide wins; two guides that fit about equally
 * well are reported as ambiguous so the person can be asked one short question.
 *
 * Nothing here knows any particular question: adding a guide to the Map (with its `screens`) is all it takes for it to be found.
 */
const CONCEPTS: Record<string, string[]> = {
  event: ["event", "exhibition", "expo", "show", "fair", "tradeshow", "conference", "edition", "calendar"],
  exhibitor: ["exhibitor", "exhibited", "exhibiting", "stand", "booth", "builder"],
  observation: ["observation", "sighting", "spotted", "saw", "noticed"],
  outreach: ["outreach", "prospect", "prospecting", "approach", "cold", "reengage", "engage", "canvass"],
  priority: ["priority", "rating", "rank", "ranking", "rated"],
  enquiry: ["enquiry", "inquiry", "lead", "opportunity", "deal", "brief"],
  followup: ["followup", "follow", "reminder", "todo", "chase", "overdue", "due"],
  client: ["client", "customer", "account", "organisation", "organization", "brand"],
  agency: ["agency", "intermediary"],
  contact: ["contact", "person", "people"],
  estimate: ["estimate", "quote", "quotation", "pricing", "price", "proposal", "costing"],
  stage: ["stage", "status", "pipeline", "board", "qualified", "negotiation", "progress", "move"],
  close: ["won", "win", "lost", "lose", "close", "closed", "handover", "hand", "reopen"],
  activity: ["call", "email", "meeting", "note", "activity", "timeline", "diary", "minutes"],
  report: ["report", "dashboard", "figure", "number", "statistic", "analytic", "result", "performance", "conversion"],
  settings: ["setting", "configuration", "configure", "preference", "option", "setup"],
  importing: ["import", "upload", "bulk", "spreadsheet", "excel", "csv", "template", "file"],
  leave: ["leave", "holiday", "vacation", "absence", "annual", "timeoff", "balance"],
  claim: ["claim", "expense", "reimbursement", "receipt", "reimburse"],
  clock: ["clock", "attendance", "punch", "checkin", "timesheet", "shift"],
  equipment: ["equipment", "inventory", "stock", "warehouse", "kit", "gear", "item", "scan"],
  project: ["project", "task", "milestone"],
  approval: ["approval", "approve", "decision", "authorise", "authorize", "signoff", "waiting"],
  access: ["access", "permission", "role", "module", "allowed"],
  home: ["home", "myday", "homepage"],
  assistant: ["jarvis", "assistant", "chatbot", "ai"],
  memory: ["remember", "memory", "forget", "preference"],
  // what the person wants to DO: weak on their own, but they tell two guides about the same thing apart ("add an enquiry" / "edit an enquiry")
  add: ["add", "create", "new", "log", "register", "record", "enter", "make", "raise", "start", "open", "book", "submit", "request", "ask", "apply", "put", "insert", "set"],
  edit: ["edit", "change", "update", "amend", "modify", "correct", "fix", "rename", "reschedule"],
  find: ["find", "where", "locate", "see", "view", "look", "get", "navigate", "list", "check", "show", "search"],
  remove: ["delete", "remove", "archive", "cancel"],
  assign: ["assign", "assigned", "allocate", "owner", "reassign"],
};
const VERBS = new Set(["add", "edit", "find", "remove", "assign"]);
const STOP = new Set("a an the of to in on at for from by with and or but is are was were be been do does did can could should would will i we you my our your me us it its this that these those there here how what when which who why please tell about into as if so than then some any all more most other also just only very not no yes ok okay thing things something anything way ways use using used need needs want wants like help explain guide tell do does can may one ones work works working good best page screen view tab section form button menu app system enginious os".split(" "));
const BY_WORD = new Map<string, string>();
for (const [concept, words] of Object.entries(CONCEPTS)) for (const w of words) if (!BY_WORD.has(w)) BY_WORD.set(w, concept);

/**
 * Words that ask WHAT SOMETHING IS FOR (its purpose or benefit) rather than naming a subject. They are not a subject of their own: "what is the benefit here?" is a question
 * about the current screen, answered from that screen's guide.
 */
const PURPOSE_WORDS = ["benefit", "benefits", "purpose", "point", "advantage", "advantages", "useful", "usefulness", "value", "reason", "worth", "gain", "goal", "aim", "why"];
/** Every word the matcher knows: the vocabulary a misspelt word is compared with. */
const KNOWN_WORDS = [...BY_WORD.keys(), ...PURPOSE_WORDS].filter((w) => w.length >= 5);

/** Edit distance with adjacent swaps, stopped early above `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [], prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur.push(v); best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length]!;
}

/** An ordinary typo: a word of five or more letters that is one edit (two for long words) from exactly one known word, same first letter. Short words are never guessed. */
export function correctTypo(word: string): string | null {
  if (word.length < 5 || /\d/.test(word)) return null;
  const max = word.length >= 9 ? 2 : 1;
  let found: string | null = null, at = max + 1, tie = false;
  for (const k of KNOWN_WORDS) {
    if (k[0] !== word[0]) continue;
    const d = distance(word, k, max);
    if (d < at) { found = k; at = d; tie = false; } else if (d === at && d <= max && found && BY_WORD.get(k) !== BY_WORD.get(found)) tie = true;
  }
  return found && at <= max && !tie ? found : null;
}

/** Does the question ask what something is for? (Tolerant of typos: "benifit", "purpse".) */
export function asksPurpose(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z]+/g, " ").split(" ").filter(Boolean);
  if (/\b(?:what(?:'s|\s+is|\s+are)?\s+(?:this|it|that|these)\s+(?:for|good\s+for|about)|what\s+does\s+(?:this|it)\s+(?:do|help)|how\s+does\s+(?:this|it)\s+help|why\s+(?:would|should|do)\s+(?:i|we)\s+use|good\s+for)\b/i.test(text)) return true;
  return words.some((w) => PURPOSE_WORDS.includes(w) || PURPOSE_WORDS.includes(correctTypo(w) ?? ""));
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("sses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

/** Text -> the concepts it carries (a known concept name, or the stem itself for a word the list does not know). */
export function concepts(text: string, fuzzy = false): string[] {
  // "show me how ..." is a request, not a trade show
  const words = text.toLowerCase().replace(/\bshow\s+(?:me|us)\b/g, " ").replace(/follow[-\s]?ups?/g, "followup").replace(/trade[-\s]?shows?/g, "tradeshow").replace(/time[-\s]off/g, "timeoff").replace(/check[-\s]in/g, "checkin").replace(/sign[-\s]off/g, "signoff").replace(/my\s+day/g, "myday").replace(/re-?engage/g, "reengage")
    .replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1 && !STOP.has(w));
  const out: string[] = [];
  for (const raw of words) {
    // In a QUESTION (never in the guides' own text) an ordinary typo of a word the matcher knows is read as that word.
    const w = !fuzzy || BY_WORD.has(raw) || BY_WORD.has(stem(raw)) || PURPOSE_WORDS.includes(raw) ? raw : correctTypo(raw) ?? raw;
    if (PURPOSE_WORDS.includes(w)) continue; // asks what something is for: not a subject of its own
    const s = stem(w);
    const c = BY_WORD.get(w) ?? BY_WORD.get(s) ?? (s.length > 2 && !STOP.has(s) ? s : null);
    if (c) out.push(c);
  }
  return out;
}

interface Indexed { entry: GuidanceEntry; weights: Map<string, number>; titleSubjects: string[]; phrases: string[] }
export interface GuidanceIndex { items: Indexed[]; idf: Map<string, number> }

const plain = (t: string) => ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Built once per guidance set. `screenNames`: the navigation's own label for each screen a guide is written for. */
export function buildIndex(guidance: readonly GuidanceEntry[], screenNames: (screen: string) => string | null = () => null): GuidanceIndex {
  const items: Indexed[] = guidance.map((entry) => {
    const weights = new Map<string, number>();
    const add = (text: string, w: number) => { for (const c of concepts(text)) weights.set(c, Math.max(weights.get(c) ?? 0, w)); };
    add(entry.steps.join(" "), 0.5); add(entry.summary, 1);
    for (const s of entry.screens ?? []) { const n = screenNames(s); if (n) add(n, 2.4); }
    for (const k of entry.keywords) add(k, 2.2);
    add(entry.title, 3);
    return { entry, weights, titleSubjects: [...new Set(concepts(entry.title))].filter((c) => !VERBS.has(c) && Object.prototype.hasOwnProperty.call(CONCEPTS, c)), phrases: entry.keywords.map(plain).filter((k) => k.trim().includes(" ")) };
  });
  const idf = new Map<string, number>();
  const all = new Set(items.flatMap((i) => [...i.weights.keys()]));
  for (const c of all) {
    const df = items.filter((i) => (i.weights.get(c) ?? 0) >= 2).length || items.length;
    idf.set(c, (VERBS.has(c) ? 0.4 : 1) * (1 + Math.log(items.length / df)));
  }
  return { items, idf };
}

export type GuidanceMatch =
  | { kind: "answer"; entries: GuidanceEntry[]; score: number }
  | { kind: "ambiguous"; options: GuidanceEntry[]; score: number }
  | { kind: "none" };

const GENERIC = /(?:-overview|-where)$|^my-day$|^jarvis-/;
/** How well a guide must fit before it is given as the answer. */
export const MATCH_THRESHOLD = 0.4;

/**
 * The best guide for a question. `screen`: the approved identifier of the screen the person is on (or null).
 *   - the score is how much of what the question is about the guide covers (rarer concepts count more; a concept in the guide's title counts more than one in its summary),
 *     adjusted by how much of the guide's own subject the question names, a phrase people really use for it, and whether it is the guide for the current screen;
 *   - a question with no subject of its own ("what can I do here?", "how do I add one?") is answered from the guides of the current screen, or not at all without one;
 *   - two guides that fit about equally: together when they are about the same screen, otherwise "ambiguous" so the person is asked which they mean.
 */
export function matchByMeaning(index: GuidanceIndex, question: string, screen: string | null = null): GuidanceMatch {
  const q = [...new Set(concepts(question, true))];
  const subject = q.filter((c) => !VERBS.has(c));
  const here = screen ? index.items.filter((i) => i.entry.screens?.includes(screen)) : [];
  if (subject.length === 0) {
    if (here.length === 0) return { kind: "none" };
    const verbs = q.filter((c) => VERBS.has(c));
    const ranked = here.map((i) => ({ i, v: verbs.filter((c) => (i.weights.get(c) ?? 0) >= 2).length })).sort((a, b) => b.v - a.v);
    return { kind: "answer", entries: ranked.slice(0, 4).map((x) => x.i.entry), score: 1 };
  }
  const text = plain(question);
  // A word no guide knows still counts against the match (so "the capital of France" finds nothing), but less than a concept the guides do know.
  const total = q.reduce((n, c) => n + (index.idf.get(c) ?? (VERBS.has(c) ? 0.4 : 1.5)), 0);
  const scored = index.items.map(({ entry, weights, titleSubjects, phrases }) => {
    let got = 0, subjectHits = 0;
    for (const c of q) {
      const w = weights.get(c) ?? 0;
      if (w === 0) continue;
      got += (index.idf.get(c) ?? 1) * (w / 3);
      if (!VERBS.has(c) && w >= 1) subjectHits += 1;
    }
    if (subjectHits === 0) return { entry, score: 0 };       // a guide must be about the THING asked for, not only share a verb
    let score = got / total;
    const named = titleSubjects.length === 0 ? 1 : titleSubjects.filter((c) => q.includes(c)).length / titleSubjects.length;
    score *= 0.7 + 0.3 * named;                              // prefer the guide whose own subject the question names
    if (phrases.some((k) => text.includes(k))) score += 0.2; // the words people really use for it
    if (GENERIC.test(entry.id)) score *= 0.9;                // an overview yields to a specific guide
    if (screen && entry.screens?.includes(screen)) score = score * 1.2 + 0.05; // the guide for the screen the person is on
    return { entry, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < MATCH_THRESHOLD) return { kind: "none" };
  // Two guides fit but one clearly not: nothing to add. (When NOTHING fits and the person asked about the screen they are on, the caller falls back to that screen's guides:
  // see screenGuides.)
  const close = scored.filter((x) => x.score >= best.score * 0.92 && x.score >= MATCH_THRESHOLD);
  if (close.length > 1) {
    // Exactly one of them is the guide for the screen the person is on: that is the most specific one.
    const onScreen = screen ? close.filter((x) => x.entry.screens?.includes(screen)) : [];
    if (onScreen.length === 1) return { kind: "answer", entries: [onScreen[0]!.entry], score: onScreen[0]!.score };
    const share = close.every((x) => (x.entry.screens ?? []).some((s) => best.entry.screens?.includes(s)));
    if (share) return { kind: "answer", entries: close.slice(0, 2).map((x) => x.entry), score: best.score };
    return { kind: "ambiguous", options: close.slice(0, 3).map((x) => x.entry), score: best.score };
  }
  return { kind: "answer", entries: [best.entry], score: best.score };
}

/** Does the question name a subject of its own (beyond what to do with it)? "What is the benefit here?" and "how do I add one?" do not. */
export function hasSubject(text: string): boolean {
  return concepts(text, true).some((c) => !VERBS.has(c));
}

/**
 * Does the question NAME a subject the app knows: one of the concepts above (an enquiry, a follow-up, leave), beyond what to do with it? Ordinary words the matcher has no
 * concept for ("next", "year", "work") do not name one. Used to decide whether a question that points at the current screen ("here") is about something else.
 */
export function namesKnownSubject(text: string): boolean {
  return concepts(text, true).some((c) => !VERBS.has(c) && Object.prototype.hasOwnProperty.call(CONCEPTS, c));
}

/** The published guides written for a screen, in the Map's order: the fallback for any question about the screen the person is on. */
export function screenGuides(index: GuidanceIndex, screen: string | null): GuidanceEntry[] {
  return screen ? index.items.filter((i) => i.entry.screens?.includes(screen)).map((i) => i.entry) : [];
}
