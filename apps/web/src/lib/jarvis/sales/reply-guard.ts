import { z } from "zod";
import type { ReplyDraftCard } from "../protocol";

/**
 * The checks that run on a drafted client reply, in code, whatever the model says. The model is asked to list what it could not confirm, but its list is never trusted:
 * the draft text is scanned here for prices, dates, availability wording and promises, and anything that is not found in the enquiry facts the person was shown or in the
 * person's own pasted text is added to the "to confirm" list shown ABOVE the draft. Estimates are budgetary: wording that promises a quotation or a reservation is flagged.
 */
export type ToConfirm = ReplyDraftCard["toConfirm"][number];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const CUR = "(?:AED|USD|EUR|GBP|SAR|QAR|KWD|BHD|OMR|INR|CHF|dirhams?|dhs?)";
const MONEY = new RegExp(`(?:\\b${CUR}\\.?\\s*\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:k|m|million|thousand)\\b)?)|(?:\\b\\d[\\d,]*(?:\\.\\d+)?\\s*(?:k\\s*)?${CUR}\\b)|(?:[$€£]\\s?\\d[\\d,]*(?:\\.\\d+)?)`, "gi");
const DATES: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\b(?:,?\\s+\\d{4})?`, "gi"),
  new RegExp(`\\b${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, "gi"),
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,
];
const AVAILABILITY = /\b(?:is|are|will be|remains?|should be)\s+(?:fully\s+|currently\s+|still\s+)?available\b|\bavailab(?:le|ility)\s+(?:on|for|from|during)\b|\bin stock\b|\bwe (?:can|will|are able to) (?:supply|provide|deliver|guarantee|reserve|hold|block|book)\b|\b(?:reserved|booked)\s+for you\b|\bconfirmed (?:booking|availability|reservation)\b|\bguarantee[sd]?\b|\bwe (?:have|hold) (?:them|it|the equipment|the units) (?:ready|reserved|available)\b/i;
const PROMISE = /\b(?:quotation|quote|proposal|estimate)\s+(?:is\s+|are\s+|will be\s+)?(?:attached|enclosed|to follow|coming|ready)\b|\bwe (?:will|shall|'ll) (?:send|issue|share|provide) (?:you )?(?:a|the|our)\s+(?:formal\s+|final\s+|official\s+)?(?:quotation|quote)\b|\bformal (?:quotation|quote)\b|\bfixed price\b/i;

const moneyKey = (m: string): string => {
  const v = Number(m.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(v) || v <= 0) return "";
  const mult = /\d\s?(?:million|m)\b/i.test(m) ? 1e6 : /\d\s?(?:thousand|k)\b/i.test(m) ? 1e3 : 1;
  return String(v * mult);
};

/** Month-day key (MM-DD) of a date mention, or null when it cannot be read. The year is ignored on purpose: "5 December" and "2026-12-05" are the same day to a reader. */
export function dateKey(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.]\d{2,4}$/.exec(t);
  if (m) return `${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`; // day first, as written in the UAE
  const mon = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_RE})`, "i").exec(t);
  if (m) return `${String(mon(m[2]!)).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = new RegExp(`^(${MONTH_RE})\\.?\\s+(\\d{1,2})`, "i").exec(t);
  if (m) return `${String(mon(m[1]!)).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  return null;
}

export function moneyMentions(text: string): string[] { return [...text.matchAll(MONEY)].map((m) => m[0].trim()); }
export function dateMentions(text: string): string[] { return DATES.flatMap((re) => [...text.matchAll(re)].map((m) => m[0].trim())); }

/** Does `value` (a price or a date as written in the draft) appear in `source`? Prices compare by number, dates by day and month. */
export function appearsIn(value: string, source: string): boolean {
  const asMoney = moneyMentions(value);
  if (asMoney.length > 0) { const have = new Set(moneyMentions(source).map(moneyKey)); return asMoney.every((m) => have.has(moneyKey(m))); }
  const k = dateKey(value);
  if (k) { const have = new Set(dateMentions(source).map(dateKey)); return have.has(k); }
  return source.toLowerCase().includes(value.trim().toLowerCase());
}

/** Everything in the draft that is not backed by the enquiry facts or the person's own text, plus availability and promise wording (always flagged: availability is not recorded in the enquiry). */
export function checkDraft(body: string, subject: string, sources: { enquiry: string; yours: string }): ToConfirm[] {
  const text = `${subject}\n${body}`;
  const both = `${sources.enquiry}\n${sources.yours}`;
  const out: ToConfirm[] = [];
  const seen = new Set<string>();
  const add = (kind: ToConfirm["kind"], t: string) => { const k = `${kind}:${t}`; if (!seen.has(k)) { seen.add(k); out.push({ kind, text: t, origin: "check" }); } };
  for (const m of new Set(moneyMentions(text))) if (!appearsIn(m, both)) add("price", `The draft mentions "${m}", which is not in the enquiry or in your text. Confirm the price before sending.`);
  for (const d of new Set(dateMentions(text))) if (!appearsIn(d, both)) add("date", `The draft mentions the date "${d}", which is not in the enquiry or in your text. Confirm it before sending.`);
  const av = AVAILABILITY.exec(text);
  if (av) add("availability", `The draft says "${av[0]}". Equipment availability is not confirmed in Enginious OS: check with the warehouse before sending.`);
  const pr = PROMISE.exec(text);
  if (pr) add("promise", `The draft says "${pr[0]}". Estimates are budgetary: do not promise a quotation, a fixed price or a reservation unless it has been issued.`);
  return out;
}

const text = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string().max(max));
export const REPLY_LIMITS = { subject: 150, body: 4000, item: 300, items: 12, value: 120 } as const;

/** What the model may return for a reply, pruned to exactly these keys; anything else is dropped. */
export const REPLY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: "string", description: "Email subject, at most 150 characters" },
    body: { type: "string", description: "The reply text only (greeting, body, sign-off placeholder). No promises, no invented figures." },
    toConfirm: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "text"], properties: { kind: { type: "string", enum: ["price", "date", "availability", "promise", "other"] }, text: { type: "string" } } }, description: "Every price, date or availability statement in the draft that is NOT in the enquiry facts or the conversation, and anything the sender must confirm." },
    usedValues: { type: "array", items: { type: "object", additionalProperties: false, required: ["value", "source"], properties: { value: { type: "string" }, source: { type: "string", enum: ["enquiry", "conversation"] } } }, description: "Prices and dates the draft uses that are present in the enquiry facts or the conversation, with which one." },
  },
};

export interface ReplyDraft { subject: string; body: string; model: ToConfirm[]; used: { value: string; source: "enquiry" | "conversation" }[] }

export function sanitiseReply(raw: unknown): ReplyDraft | null {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const subject = text(REPLY_LIMITS.subject).safeParse(o.subject);
  const body = text(REPLY_LIMITS.body).safeParse(o.body);
  if (!subject.success || !body.success || !body.data) return null;
  const kinds = ["price", "date", "availability", "promise", "other"] as const;
  const model: ToConfirm[] = (Array.isArray(o.toConfirm) ? o.toConfirm : []).slice(0, REPLY_LIMITS.items).flatMap((x) => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const t = text(REPLY_LIMITS.item).safeParse(r.text);
    const kind = (kinds as readonly unknown[]).includes(r.kind) ? (r.kind as ToConfirm["kind"]) : "other";
    return t.success && t.data ? [{ kind, text: t.data, origin: "model" as const }] : [];
  });
  const used = (Array.isArray(o.usedValues) ? o.usedValues : []).slice(0, 20).flatMap((x) => {
    const r = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const v = text(REPLY_LIMITS.value).safeParse(r.value);
    return v.success && v.data && (r.source === "enquiry" || r.source === "conversation") ? [{ value: v.data, source: r.source as "enquiry" | "conversation" }] : [];
  });
  return { subject: subject.data, body: body.data, model, used };
}
