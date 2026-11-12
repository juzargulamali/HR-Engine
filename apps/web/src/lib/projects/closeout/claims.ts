/**
 * The word patterns behind the report's blocking checks, in ONE place. The same patterns are installed in the database (proj_closeout_text_blocks in migration
 * 20270101000100, with \b written as \y), where approval is enforced; a test keeps the two copies identical. They are written without lookbehind so that both
 * regular-expression dialects read them the same way. All are matched case-insensitively, one sentence at a time.
 *
 * What they are: a net for the common ways a narrative can say more than the records do. What they are not: understanding. They lean towards marking too much (a marked
 * sentence costs a rewording). They cannot see a claim made across two sentences, by implication ("we left on good terms"), in numbers written as words, or in another
 * language. The Recorded facts above the narrative are computed from the records and never depend on these patterns.
 */
export const CLAIM_PATTERNS = {
  /** The sentence itself says the thing is NOT so. Only a negation that governs the claim counts: "not only did the client sign off" and "signed off without snags" do not. */
  denies: String.raw`\b(?:not\s+(?:yet\s+)?(?:been\s+)?(?:recorded|signed|accepted|approved|confirmed|given|received|returned|back|completed|closed)|no\s+(?:client\s+|customer\s+|recorded\s+|record\s+of\s+(?:a\s+|any\s+)?)?(?:sign[\s-]?off|acceptance|approval|confirmation|completion)|(?:is|are|was|were|has|have|had|did|does|do|could|can)(?:\s+not|n['’]t)\s+(?!only\b)|unrecorded|awaiting|pending|yet\s+to\s+be|still\s+(?:out|outstanding|open|to\s+be))\b`,
  /** Words that claim a sign-off whoever is named. */
  signoff: String.raw`\bsign(?:ed|s|ing)?[\s-]?off\b|\bsigned\s+(?:the\s+|a\s+|an\s+)?(?:\w+\s+)?(?:handover|completion|certificate|acceptance|form)\b|\b(?:handover|hand-over|completion|acceptance|certificate)\s+(?:was|were|has\s+been|is)\s+(?:signed|accepted|given|granted|received)\b|\bfinal\s+(?:approval|acceptance)\b|\bhanded\s+over\s+to\s+the\s+(?:client|customer)\b|\bgreen\s+light\b|\bblessing\b|\b(?:formally|officially)\s+(?:accepted|approved|closed|handed\s+over)\b`,
  /** Words that claim acceptance when the sentence also names the client (or the recorded client by name). Includes indirect wording that implies it. */
  accept: String.raw`\b(?:accept(?:ed|s|ance)?|approv(?:ed|es|al)|signed|sign(?:s|ing)?|go-?ahead|closed\s+out)\b|\b(?:satisfied|happy|delighted|pleased|content)\s+with\s+(?:the\s+|our\s+)?(?:final\s+|finished\s+|overall\s+|completed\s+)?(?:result|outcome|installation|stand|project|delivery|work|handover|everything)\b|\bhappy\s+to\s+(?:accept|sign|close|approve)\b|\bagree(?:d|s)?\s+(?:that\s+)?(?:the\s+)?(?:work|project|installation|stand|delivery)\s+(?:is|was|were)\s+(?:complete|completed|done|finished)\b|\bno\s+(?:further\s+)?(?:objections?|snags?|comments?)\b|\bconfirmed\s+(?:that\s+)?(?:the\s+)?(?:work|project|installation|stand|delivery|handover)\b`,
  client: String.raw`\b(?:client|customer|end[\s-]client|agency)(?:['’]s)?\b`,
  /** "Everything is back": a word for all of it, with a word for returning. */
  return_all: String.raw`\b(?:all|every(?:thing)?|each|both|fully|completely|complete(?:d)?|entire(?:ly)?|whole|nothing|none|no\s+(?:equipment|hardware|kit|items?|units?|panels?|stock))\b`,
  return_words: String.raw`\b(?:return(?:ed|s)?|back|came\s+back|remain(?:s|ed|ing)?|outstanding|on\s+site|missing|checked\s+in)\b`,
  return_exempt: String.raw`\bstill\s+out\b|\bsome\b|\bpart(?:ly|ial(?:ly)?)\b|\bnot\s+(?:all|yet|been|every)\b|(?:is|are|was|were|has|have|had|does|do|did)n['’]t\b|(?:is|are|was|were|has|have|had|does|do|did)\s+not\b`,
  return_complete: String.raw`\b(?:equipment|hardware|kit)\s+return\s+(?:is|was)\s+complete\b`,
  /** The project itself is said to be completed, closed or wrapped up. A task, a milestone or an installation being done is not this. */
  completion: String.raw`\b(?:project|job|engagement|contract)\s+(?:was|is|has\s+been|had\s+been|were)\s+(?:successfully\s+|fully\s+|formally\s+|officially\s+|now\s+)?(?:completed?|finished|closed(?:\s+out)?|concluded|wrapped\s+up)\b|\b(?:completed|finished|closed\s+out|concluded|wrapped\s+up)\s+the\s+(?:project|job|engagement|contract)\b|\bproject\s+(?:closed|completed|finished|concluded)\b|\b(?:successful|final)\s+(?:project\s+)?(?:completion|close-?out)\b|\bbrought\s+the\s+project\s+to\s+a\s+close\b`,
  /** Quoted words, by quotation style. The captured group is 1, 1 and 2. */
  quote_double: String.raw`["“]([^"”]{2,})["”]`,
  quote_guillemet: String.raw`«\s*([^»]{2,}?)\s*»`,
  quote_single: String.raw`(^|[^A-Za-z0-9])['‘]([^'’]{2,}?)['’]([^A-Za-z0-9]|$)`,
} as const;
export type ClaimPattern = keyof typeof CLAIM_PATTERNS;
const RE = Object.fromEntries(Object.entries(CLAIM_PATTERNS).map(([k, v]) => [k, new RegExp(v, "i")])) as Record<ClaimPattern, RegExp>;
const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const sentencesOf = (text: string) => text.split(/[.!?;]\s+|\n/).filter((x) => x.trim());
/** Text made comparable: lower case, quotation marks removed, white space collapsed. */
export const normText = (x: string) => x.toLowerCase().replace(/[“”"‘’'«»]/g, "").replace(/\s+/g, " ").trim();

/** Does a sentence say the client signed off, accepted or approved the work? `clientName` (the recorded client) counts as "the client". */
export function claimsSignoff(sentence: string, clientName: string | null): boolean {
  if (RE.denies.test(sentence)) return false;
  if (RE.signoff.test(sentence)) return true;
  const name = clientName?.trim() ?? "";
  const namesClient = RE.client.test(sentence) || (name.length >= 3 && new RegExp(escapeRe(name), "i").test(sentence));
  return namesClient && RE.accept.test(sentence);
}
/** Does a sentence say that everything is back? */
export function claimsAllReturned(sentence: string): boolean {
  if (RE.return_exempt.test(sentence)) return false;
  return (RE.return_all.test(sentence) && RE.return_words.test(sentence)) || RE.return_complete.test(sentence);
}
/** Does a sentence say the project itself was completed or closed? */
export function claimsCompletion(sentence: string): boolean {
  return !RE.denies.test(sentence) && RE.completion.test(sentence);
}
/** Every quoted run of words in a text, in any quotation style. */
export function quotedRuns(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(CLAIM_PATTERNS.quote_double, "gi"))) out.push(m[1]!);
  for (const m of text.matchAll(new RegExp(CLAIM_PATTERNS.quote_guillemet, "gi"))) out.push(m[1]!);
  for (const m of text.matchAll(new RegExp(CLAIM_PATTERNS.quote_single, "gi"))) out.push(m[2]!);
  return out;
}
/** Every string held anywhere in a snapshot: the recorded words a quotation must come from. */
export function snapshotStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) snapshotStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) snapshotStrings(v, out);
  return out;
}
