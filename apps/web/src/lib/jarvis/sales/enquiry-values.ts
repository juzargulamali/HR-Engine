import { z } from "zod";
import { CRM_SOURCES, crmToday } from "@enginious-hr/domain";
import type { CardProblem, EnquiryValues } from "../protocol";

/**
 * The create-enquiry field set, exactly as the existing form and `crm_create_opportunity` take it (apps/web/src/lib/actions/crm.ts createOpportunitySchema; documented in
 * docs/enginious-os/modules/sales-enquiries.md section 3). Nothing here is invented: owner is always the approving person (the form's default) and contacts are linked on the
 * enquiry page afterwards.
 */
export const SOURCE_IDS = CRM_SOURCES.map((s) => s.id);
export const NEXT_KINDS = ["call", "email", "meeting", "proposal", "other"] as const;
export const LIMITS = { title: 200, nextTitle: 300, brief: 4000, scope: 4000, budgetNote: 1000, location: 200, techName: 120, techRows: 20 } as const;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullable()).catch(null);
const reqText = (max: number) => z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().trim().max(max)).catch("");
const uuidOrNull = z.preprocess(blank, z.string().uuid().nullable()).catch(null);

/** A real calendar date written YYYY-MM-DD, or null. */
export function calendarDate(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}
const dateOrNull = z.preprocess((v) => calendarDate(blank(v)), z.string().nullable()).catch(null);

/** Shape only: unknown keys dropped, strings trimmed and length-limited, bad values blanked. Business rules are in `validateEnquiry`. */
export const enquiryValuesSchema: z.ZodType<EnquiryValues> = z.object({
  companyId: z.string().uuid(),
  title: reqText(LIMITS.title),
  source: reqText(40),
  agencyOrgId: uuidOrNull,
  clientOrgId: uuidOrNull,
  currency: z.preprocess((v) => { const b = blank(v); return typeof b === "string" ? b.trim().toUpperCase() : b; }, z.string().regex(/^[A-Z]{3}$/).nullable()).catch(null),
  value: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().finite().min(0).max(1e12).nullable()).catch(null),
  budgetNote: text(LIMITS.budgetNote),
  brief: text(LIMITS.brief),
  eventStart: dateOrNull,
  eventEnd: dateOrNull,
  installStart: dateOrNull,
  location: text(LIMITS.location),
  technologies: z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.object({ name: z.string().trim().min(1).max(LIMITS.techName), qty: z.coerce.number().int().min(1).max(100000) }).strip()).max(LIMITS.techRows)).catch([]),
  scope: text(LIMITS.scope),
  waitingOn: z.enum(["client", "internal"]).nullable().catch(null),
  nextTitle: reqText(LIMITS.nextTitle),
  nextDate: z.preprocess((v) => calendarDate(blank(v)) ?? "", z.string()).catch(""),
  nextTime: z.preprocess((v) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : "10:00"), z.string()).catch("10:00"),
  nextKind: z.enum(NEXT_KINDS).catch("other"),
}) as unknown as z.ZodType<EnquiryValues>;

export function emptyValues(companyId: string): EnquiryValues {
  return { companyId, title: "", source: "", agencyOrgId: null, clientOrgId: null, currency: null, value: null, budgetNote: null, brief: null, eventStart: null, eventEnd: null, installStart: null,
    location: null, technologies: [], scope: null, waitingOn: null, nextTitle: "", nextDate: "", nextTime: "10:00", nextKind: "other" };
}

/** The business rules of the existing form and function (message wording follows the form's). `today` is the Dubai day. */
export function validateEnquiry(v: EnquiryValues, today: string = crmToday()): CardProblem[] {
  const out: CardProblem[] = [];
  if (!v.title.trim()) out.push({ field: "title", message: "Give the enquiry a title." });
  if (!v.source) out.push({ field: "source", message: "Choose where the enquiry came from." });
  else if (!SOURCE_IDS.includes(v.source)) out.push({ field: "source", message: "Choose one of the listed sources." });
  if (!v.agencyOrgId && !v.clientOrgId) out.push({ field: "agencyOrgId", message: "Choose an agency, an end client, or both." });
  if (!v.nextTitle.trim()) out.push({ field: "nextTitle", message: "Say what the next action is." });
  if (!v.nextDate) out.push({ field: "nextDate", message: "Choose the date of the next action." });
  else if (v.nextDate < today) out.push({ field: "nextDate", message: "The next action cannot be dated before today." });
  if (v.eventStart && v.eventEnd && v.eventEnd < v.eventStart) out.push({ field: "eventEnd", message: "The show end date cannot be before it starts." });
  return out;
}

/** The question the card asks for a missing required field (the person answers by filling that field). */
export function questionFor(field: string): { text: string; options?: { value: string; label: string }[] } | null {
  switch (field) {
    case "title": return { text: "What should the enquiry be called?" };
    case "source": return { text: "Where did this enquiry come from?", options: CRM_SOURCES.map((s) => ({ value: s.id, label: s.label })) };
    case "nextTitle": return { text: "What is the next action?" };
    case "nextDate": return { text: "When is the next action due?" };
    default: return null;
  }
}
