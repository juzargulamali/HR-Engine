/**
 * PERSONAL MEMORY: the closed set of preferences JARVIS can remember for a person. Structured on purpose: a preference is one of these keys with one of these values, never
 * free text, so memory cannot hold a business record, a credential, a sensitive fact or a piece of a conversation, and what reaches the AI provider is only the fixed sentence
 * written here. The database enforces the same pairs (migration 20261226000100, table jarvis_preferences). Plain data shared by the browser and the server.
 */
export interface PreferenceDef { label: string; options: Record<string, { label: string; sentence: string }> }

export const PREFERENCES = {
  email_length: {
    label: "Email and draft length",
    options: {
      short: { label: "Short", sentence: "Keep emails and drafts short: a few sentences." },
      medium: { label: "Medium", sentence: "Write emails and drafts of medium length." },
      detailed: { label: "Detailed", sentence: "Write detailed emails and drafts." },
    },
  },
  english: {
    label: "English spelling",
    options: {
      british: { label: "British English", sentence: "Use British English spelling." },
      american: { label: "American English", sentence: "Use American English spelling." },
    },
  },
  tone: {
    label: "Tone",
    options: {
      formal: { label: "Formal", sentence: "Use a formal, professional tone." },
      friendly: { label: "Friendly", sentence: "Use a friendly, warm tone." },
      neutral: { label: "Neutral", sentence: "Use a neutral, plain tone." },
    },
  },
  answer_length: {
    label: "Answers",
    options: {
      brief: { label: "Brief", sentence: "Keep answers brief." },
      detailed: { label: "Detailed", sentence: "Give detailed answers." },
    },
  },
} as const satisfies Record<string, PreferenceDef>;

export type PreferenceKey = keyof typeof PREFERENCES;
export const PREFERENCE_KEYS = Object.keys(PREFERENCES) as PreferenceKey[];
export interface PreferenceView { key: PreferenceKey; label: string; value: string; valueLabel: string; options: { value: string; label: string }[] }

export const isPreference = (key: unknown, value: unknown): key is PreferenceKey =>
  typeof key === "string" && typeof value === "string" && Object.prototype.hasOwnProperty.call(PREFERENCES, key) && Object.prototype.hasOwnProperty.call((PREFERENCES as Record<string, PreferenceDef>)[key]!.options, value);

export function preferenceView(key: PreferenceKey, value: string): PreferenceView {
  const def = PREFERENCES[key] as PreferenceDef;
  return { key, label: def.label, value, valueLabel: def.options[value]?.label ?? value, options: Object.entries(def.options).map(([v, o]) => ({ value: v, label: o.label })) };
}

/** Rows as stored -> the valid ones, in the fixed order. Anything that is not a known pair is ignored (never shown, never sent). */
export function toPreferenceViews(rows: readonly { pref_key?: unknown; pref_value?: unknown }[]): PreferenceView[] {
  const by = new Map(rows.filter((r) => isPreference(r.pref_key, r.pref_value)).map((r) => [r.pref_key as PreferenceKey, r.pref_value as string]));
  return PREFERENCE_KEYS.filter((k) => by.has(k)).map((k) => preferenceView(k, by.get(k)!));
}

/** The fixed sentences for the provider. Built only from the closed set above. */
export const preferenceSentences = (views: readonly PreferenceView[]): string[] => views.map((v) => (PREFERENCES[v.key] as PreferenceDef).options[v.value]?.sentence).filter((s): s is string => !!s);

const WRITING = "(?:e-?mails?|drafts?|messages?|replies|writing|letters?|texts?)";
const RULES: { key: PreferenceKey; value: string; re: RegExp }[] = [
  { key: "email_length", value: "short", re: new RegExp(`\\b(?:short|shorter|brief|concise|to the point)\\b[^.]{0,20}\\b${WRITING}\\b|\\b${WRITING}\\b[^.]{0,20}\\b(?:short|brief|concise)\\b`, "i") },
  { key: "email_length", value: "detailed", re: new RegExp(`\\b(?:long|longer|detailed|thorough)\\b[^.]{0,20}\\b${WRITING}\\b|\\b${WRITING}\\b[^.]{0,20}\\b(?:long|detailed|thorough)\\b`, "i") },
  { key: "email_length", value: "medium", re: new RegExp(`\\bmedium(?:[-\\s]length)?\\b[^.]{0,20}\\b${WRITING}\\b`, "i") },
  { key: "english", value: "british", re: /\b(?:british|uk)\s+(?:english|spelling)\b/i },
  { key: "english", value: "american", re: /\b(?:american|us)\s+(?:english|spelling)\b/i },
  { key: "tone", value: "formal", re: /\b(?:formal|professional)\b(?:[^.]{0,15}\btone\b)?/i },
  { key: "tone", value: "friendly", re: /\b(?:friendly|warm|casual|informal)\b(?:[^.]{0,15}\btone\b)?/i },
  { key: "tone", value: "neutral", re: /\bneutral\s+tone\b/i },
  { key: "answer_length", value: "brief", re: /\b(?:short|brief|concise)\s+answers?\b|\banswers?\b[^.]{0,15}\b(?:short|brief|concise)\b/i },
  { key: "answer_length", value: "detailed", re: /\b(?:long|detailed|thorough)\s+answers?\b|\banswers?\b[^.]{0,15}\b(?:detailed|thorough)\b/i },
];

/** "Remember that I prefer short emails in British English" -> [{email_length: short}, {english: british}]. Nothing that is not one of the known pairs is ever returned. */
export function parsePreferences(text: string): { key: PreferenceKey; value: string }[] {
  const out = new Map<PreferenceKey, string>();
  for (const r of RULES) if (!out.has(r.key) && r.re.test(text)) out.set(r.key, r.value);
  return [...out].map(([key, value]) => ({ key, value }));
}

/** Which preference a "forget ..." sentence names (empty = it names none; "everything" = all). */
export function preferenceKeysNamed(text: string): PreferenceKey[] | "all" {
  if (/\b(?:everything|all)\b/i.test(text)) return "all";
  const keys: PreferenceKey[] = [];
  if (/\b(?:length|short|long|detailed)\b.*\b(?:e-?mails?|drafts?)\b|\b(?:e-?mails?|drafts?)\b.*\blength\b/i.test(text)) keys.push("email_length");
  if (/\b(?:english|spelling|british|american)\b/i.test(text)) keys.push("english");
  if (/\b(?:tone|formal|friendly|neutral)\b/i.test(text)) keys.push("tone");
  if (/\banswers?\b/i.test(text)) keys.push("answer_length");
  return keys;
}

export const PREFERENCE_HELP = "I can remember these for you: email and draft length (short, medium, detailed), English spelling (British or American), tone (formal, friendly, neutral) and answer length (brief or detailed). For example: \"Remember that I prefer short emails in British English.\" I do not remember business records, passwords, personal details or conversations.";
