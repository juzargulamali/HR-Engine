import "server-only";
import { z } from "zod";
import { cleanText, normaliseCountry, normaliseName, normaliseWebsite, ORGANISATION_ROLES, ROLE_LABEL, websiteDomain } from "@/lib/crm/clients-agencies/normalise";
import type { CardProblem, OrgMatchView, OrgRegisterCard, OrgRole, OrgValues } from "../protocol";
import { JarvisRefusalError, type GenericResult, type JarvisActionDefinition, type JarvisContext } from "../types";
import { proofRpcArgs } from "../token";
import { rpcOutcome } from "./rpc-outcome";
import type { SupabaseClient } from "@supabase/supabase-js";

export const REGISTER_ORG_ID = "jarvis.sales.organisation.register";

const LIMITS = { name: 200, country: 80, website: 300, place: 200, note: 2000 } as const;
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullable()).catch(null);

/** Shape only: unknown keys dropped, strings trimmed and length-limited. The rules are in `validateOrg`. */
export const orgValuesSchema: z.ZodType<OrgValues> = z.object({
  companyId: z.string().uuid(),
  name: z.preprocess((v) => (typeof v === "string" ? v : ""), z.string().trim().max(LIMITS.name)).catch(""),
  roles: z.preprocess((v) => (Array.isArray(v) ? [...new Set(v)].filter((r) => (ORGANISATION_ROLES as readonly unknown[]).includes(r)) : []), z.array(z.enum(ORGANISATION_ROLES)).max(4)).catch([]),
  country: text(LIMITS.country),
  website: text(LIMITS.website),
  place: text(LIMITS.place),
  note: text(LIMITS.note),
}) as unknown as z.ZodType<OrgValues>;

const typedName = z.string().trim().min(1).max(LIMITS.name);
const inputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("search"), name: typedName }),
  /** "details": first from the search card ("register it as a new organisation", with the name), then again on every change the person makes on the details card. */
  z.object({ mode: z.literal("details"), name: z.string().trim().max(LIMITS.name).optional(), fields: z.record(z.string().max(40), z.unknown()).optional() }),
]);
export type RegisterOrgInput = z.infer<typeof inputSchema>;

export const emptyOrgValues = (companyId: string, name = ""): OrgValues => ({ companyId, name, roles: [], country: null, website: null, place: null, note: null });

export function validateOrg(v: OrgValues): CardProblem[] {
  const out: CardProblem[] = [];
  if (!v.name.trim()) out.push({ field: "name", message: "Enter the organisation's name." });
  if (v.roles.length === 0) out.push({ field: "roles", message: "Choose what kind of organisation it is (agency, direct client, end client or technology company)." });
  if (cleanText(v.country) && !normaliseCountry(v.country)) out.push({ field: "country", message: "That country is not recognised. Use its name or two-letter code." });
  return out;
}

type Row = { id: string; name: string; roles: string[] | null; place: string | null; country_code: string | null; website: string | null; name_key: string; website_domain: string | null };
const COLS = "id, name, roles, place, country_code, website, name_key, website_domain";

/** Existing organisations this one could be, as the person's own session sees them: same normalised name, same website domain, or a similar name. Never writes. */
export async function findOrganisationMatches(supabase: SupabaseClient, name: string, website: string | null): Promise<OrgMatchView[]> {
  const key = normaliseName(name);
  const domain = websiteDomain(website);
  const found = new Map<string, { row: Row; reasons: Set<OrgMatchView["reasons"][number]> }>();
  const add = (rows: Row[] | null, reason: OrgMatchView["reasons"][number]) => { for (const r of rows ?? []) { const e = found.get(r.id) ?? { row: r, reasons: new Set() }; e.reasons.add(reason); found.set(r.id, e); } };
  if (key.length >= 2) {
    const r = await supabase.from("crm_organisations").select(COLS).is("archived_at", null).eq("name_key", key).limit(10);
    if (r.error) throw new JarvisRefusalError("unavailable", "Could not read the organisations just now. Try again in a moment.");
    add(r.data as Row[] | null, "same name");
  }
  if (domain) {
    const r = await supabase.from("crm_organisations").select(COLS).is("archived_at", null).eq("website_domain", domain).limit(10);
    if (r.error) throw new JarvisRefusalError("unavailable", "Could not read the organisations just now. Try again in a moment.");
    add(r.data as Row[] | null, "same website");
  }
  const word = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).sort((a, b) => b.length - a.length)[0];
  if (key.length >= 3 && word) {
    const r = await supabase.from("crm_organisations").select(COLS).is("archived_at", null).ilike("name_key", `%${word.replace(/[%_\\]/g, "")}%`).limit(25);
    if (r.error) throw new JarvisRefusalError("unavailable", "Could not read the organisations just now. Try again in a moment.");
    add(((r.data ?? []) as Row[]).filter((o) => o.name_key.length >= 4 && (o.name_key.includes(key) || (key.length >= 4 && key.includes(o.name_key)))), "similar name");
  }
  return [...found.values()].map(({ row, reasons }) => ({
    id: row.id, name: row.name, roles: row.roles ?? [], place: row.place, country: row.country_code, website: row.website,
    reasons: (["same name", "same website", "similar name"] as const).filter((x) => reasons.has(x) && !(x === "similar name" && (reasons.has("same name") || reasons.has("same website")))),
    binding: reasons.has("same name") || reasons.has("same website"),
  })).sort((a, b) => Number(b.binding) - Number(a.binding) || a.name.localeCompare(b.name)).slice(0, 10);
}

async function companyName(ctx: JarvisContext): Promise<string> {
  const r = await ctx.supabase.from("companies").select("legal_name").eq("id", ctx.companyId).maybeSingle();
  return (r.data as { legal_name?: string } | null)?.legal_name ?? "this company";
}
const roleOptions = ORGANISATION_ROLES.map((id) => ({ id: id as OrgRole, label: ROLE_LABEL[id] }));

async function card(ctx: JarvisContext, stage: "search" | "details", query: string, values: OrgValues) {
  const matches = await findOrganisationMatches(ctx.supabase, values.name || query, normaliseWebsite(values.website).website);
  const problems = stage === "details" ? validateOrg(values) : [];
  const valid = stage === "details" && problems.length === 0;
  const c: OrgRegisterCard = { kind: "org.register", stage, company: { id: ctx.companyId, name: await companyName(ctx) }, query, matches, values, problems, valid, roleOptions };
  return { values, target: { kind: "new" } as const, valid, card: c };
}

/**
 * Register a client or agency. It searches the organisations the person may see (their own session), lets them use an existing one, and only on a SEPARATE details step (the
 * exact type and fields) issues a confirmation to create a NEW one through the existing Clients & Agencies create path, inside the ledger-backed atomic wrapper
 * (jarvis_register_organisation): a retry never creates a second organisation. Same-name or same-website organisations must be named as "different" on the review.
 */
export const registerOrganisation: JarvisActionDefinition<RegisterOrgInput, OrgValues, OrgRegisterCard, GenericResult> = {
  id: REGISTER_ORG_ID,
  module: "sales",
  title: "Register a client or agency",
  description: "Say the organisation's name: JARVIS checks Clients & Agencies for it, and only if you choose to register a new one shows its type and details for you to confirm. Nothing is added until you press Register.",
  risk: "write",
  requires: { moduleGrant: "sales" },
  status: { enabled: true },
  usesProvider: false,
  inputSchema,
  valuesSchema: orgValuesSchema,
  describe: (v) => `Register the organisation "${v.name}"`,

  /** Exactly what jarvis_register_organisation receives as its signed payload. (The acknowledged same-name matches travel separately: see the wrapper's comment.) */
  wirePayload: (v) => ({
    company_id: v.companyId, name: v.name, roles: v.roles, country_code: cleanText(v.country) ? normaliseCountry(v.country) : null, website: normaliseWebsite(v.website).website,
    place: cleanText(v.place), note: cleanText(v.note),
  }),

  async propose(ctx, input) {
    if (input.mode === "search") return card(ctx, "search", input.name, emptyOrgValues(ctx.companyId, input.name));
    const parsed = orgValuesSchema.safeParse({ ...(input.fields ?? {}), companyId: ctx.companyId, ...(input.fields?.name === undefined && input.name ? { name: input.name } : {}) });
    if (!parsed.success) throw new JarvisRefusalError("invalid_input", "Those details are not valid.");
    return card(ctx, "details", parsed.data.name, { ...parsed.data, companyId: ctx.companyId });
  },

  /** The rules again at execution, through the person's own session. */
  async authorize(_ctx, values) {
    const problems = validateOrg(values);
    return problems.length > 0 ? { ok: false, code: "needs_review", message: `${problems[0]!.message} Review the details again.` } : { ok: true };
  },

  async execute(ctx, input) {
    const v = input.values;
    const known = await ctx.supabase.from("jarvis_action_ledger").select("status").eq("confirmation_id", input.confirmationId).maybeSingle();
    if (known.error) return { kind: "ambiguous" };
    const ack = Array.isArray(input.acknowledgements.matchIds) ? (input.acknowledgements.matchIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (!known.data) {
      // A same-name or same-website organisation must have been named as "different" on the card; a failed check fails closed. (A repeat of a saved confirmation skips this: it would
      // find the very organisation that confirmation created.)
      let matches: OrgMatchView[];
      try { matches = await findOrganisationMatches(ctx.supabase, v.name, normaliseWebsite(v.website).website); }
      catch { return { kind: "refused", code: "needs_review", message: "Could not check for the same organisation just now. Press Review changes to try again." }; }
      if (matches.some((m) => m.binding && !ack.includes(m.id))) return { kind: "refused", code: "needs_review", message: "An organisation with the same name or website now exists. Review the details again and say whether it is a different one." };
    }
    const r = await ctx.supabase.rpc("jarvis_register_organisation", { ...proofRpcArgs(input.proof), p_ack: ack.filter((x) => /^[0-9a-f-]{36}$/i.test(x)) }).abortSignal(AbortSignal.timeout(20_000));
    return rpcOutcome(r, "The organisation could not be registered.");
  },

  async verify(ctx, result) {
    const r = await ctx.supabase.from("crm_organisations").select("id, name").eq("id", result.resultId).maybeSingle();
    const row = r.data as { id: string; name: string } | null;
    return { ok: !r.error && !!row && row.name.startsWith(result.reference) };
  },

  resultView: ({ resultId, reference, extra }) => ({
    reference,
    href: `/sales/accounts/${resultId}${typeof extra?.company_id === "string" ? `?company=${extra.company_id}` : ""}`,
    summary: `${reference} was added to Clients & Agencies, and you approved it.`,
  }),
};

