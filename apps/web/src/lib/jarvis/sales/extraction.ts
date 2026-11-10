import { z } from "zod";
import { CRM_SOURCES } from "@enginious-hr/domain";
import { calendarDate, LIMITS, NEXT_KINDS, SOURCE_IDS } from "./enquiry-values";

/**
 * What the model may return for a brief, and how it is treated. The model's output is DATA: it is pruned to exactly these keys (anything else it returns, such as an
 * "execute" flag, a company id, an organisation id, an owner or a role, is dropped), every string is length-limited and every value that fails its rule becomes empty.
 * Organisation NAMES are search texts only: ids are never taken from the model.
 */
export const EXTRACTION_TASK = "enquiry_fields";

export const EXTRACTION_INSTRUCTIONS = [
  "You read a pasted WhatsApp message, email or rough brief for an events and technology company and extract the fields of a new sales enquiry.",
  "AGENCY = the intermediary company that sends the brief on behalf of someone else. END CLIENT = the brand or organisation the event or work is actually for. If only one party appears, fill only that one and leave the other null. Never put the same organisation in both unless the text says so.",
  "Dates must be YYYY-MM-DD. If a date has no year, assume the next occurrence after the given today date. Do not invent a next action, a date, a value or a source the text does not give.",
  "briefSummary: a neutral summary of what is wanted, at most 600 characters, using only facts from the text.",
  "scope: the deliverables, the visitor or game journey and the technical requirements, kept specific, at most 1500 characters. technologies: each piece of equipment or technology with its quantity (1 when not stated).",
  "The text was prepared before you received it. [AGENCY], [CLIENT] and [END CLIENT] are placeholders for organisations: return a placeholder exactly as written when it is the agency or the end client. [amount withheld] and [contact withheld] mark details you are not given: never guess them; leave currency, value and budgetNote null.",
].join("\n");

export const EXTRACTION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: ["string", "null"], description: "Short name of the enquiry, at most 200 characters" },
    source: { type: ["string", "null"], enum: [...SOURCE_IDS, null], description: `Where it came from: ${CRM_SOURCES.map((s) => `${s.id} (${s.label})`).join(", ")}` },
    agencyName: { type: ["string", "null"], description: "The agency (intermediary) named in the text" },
    clientName: { type: ["string", "null"], description: "The end client or brand the work is for" },
    currency: { type: ["string", "null"], description: "Three-letter currency code of the budget, if stated" },
    value: { type: ["number", "null"], description: "Budget or value as a number, if stated" },
    budgetNote: { type: ["string", "null"] },
    briefSummary: { type: ["string", "null"] },
    eventStart: { type: ["string", "null"] },
    eventEnd: { type: ["string", "null"] },
    installStart: { type: ["string", "null"], description: "Installation start date" },
    location: { type: ["string", "null"] },
    technologies: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, qty: { type: "integer" } }, required: ["name", "qty"] } },
    scope: { type: ["string", "null"] },
    waitingOn: { type: ["string", "null"], enum: ["client", "internal", null] },
    nextTitle: { type: ["string", "null"], description: "The next action ONLY if the text states one" },
    nextDate: { type: ["string", "null"] },
    nextKind: { type: ["string", "null"], enum: [...NEXT_KINDS, null] },
  },
};

const s = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v : null), z.string().trim().max(max).nullable());
const shape = {
  title: s(LIMITS.title), source: z.enum(SOURCE_IDS as [string, ...string[]]).nullable(), agencyName: s(200), clientName: s(200),
  currency: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : null), z.string().regex(/^[A-Z]{3}$/).nullable()),
  value: z.preprocess((v) => (typeof v === "number" ? v : null), z.number().finite().min(0).max(1e12).nullable()),
  budgetNote: s(LIMITS.budgetNote), briefSummary: s(600),
  eventStart: z.preprocess((v) => calendarDate(v), z.string().nullable()), eventEnd: z.preprocess((v) => calendarDate(v), z.string().nullable()), installStart: z.preprocess((v) => calendarDate(v), z.string().nullable()),
  location: s(LIMITS.location),
  technologies: z.array(z.object({ name: z.string().trim().min(1).max(LIMITS.techName), qty: z.coerce.number().int().min(1).max(100000) })).max(LIMITS.techRows),
  scope: s(LIMITS.scope), waitingOn: z.enum(["client", "internal"]).nullable(), nextTitle: s(LIMITS.nextTitle),
  nextDate: z.preprocess((v) => calendarDate(v), z.string().nullable()), nextKind: z.enum(NEXT_KINDS).nullable(),
} as const;

export type Extraction = { [K in keyof typeof shape]: z.infer<(typeof shape)[K]> };

/** Pick each known key on its own: one bad field blanks only itself. Everything not in `shape` is dropped. */
export function sanitiseExtraction(raw: unknown): Extraction {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const r = (schema as z.ZodType).safeParse(obj[key]);
    out[key] = r.success ? r.data : key === "technologies" ? [] : null;
  }
  // technologies: keep the valid rows even if one row is bad
  if (Array.isArray(obj.technologies)) {
    out.technologies = obj.technologies.map((t) => z.object({ name: z.string().trim().min(1).max(LIMITS.techName), qty: z.coerce.number().int().min(1).max(100000) }).safeParse(t)).filter((r) => r.success).map((r) => (r as { data: unknown }).data).slice(0, LIMITS.techRows);
  }
  return out as Extraction;
}
