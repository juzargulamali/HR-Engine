import "server-only";
import { z } from "zod";
import { crmToday, dubaiDateTimeToIso } from "@enginious-hr/domain";
import { friendlyCrmError } from "@/lib/crm/errors";
import { classifyRequest, EXCLUSION_MESSAGE } from "../classifier";
import type { CardProblem, CardQuestion, EnquiryCard, EnquiryValues, OrgChoice, OrgField } from "../protocol";
import { JarvisProviderError } from "../provider/types";
import { proofRpcArgs } from "../token";
import { proofRefusal } from "./rpc-outcome";
import { JarvisRefusalError, type JarvisActionDefinition, type JarvisContext } from "../types";
import { findDuplicateEnquiries } from "./duplicates";
import { emptyValues, enquiryValuesSchema, LIMITS, questionFor, validateEnquiry } from "./enquiry-values";
import { EXTRACTION_INSTRUCTIONS, EXTRACTION_JSON_SCHEMA, EXTRACTION_TASK, sanitiseExtraction, type Extraction } from "./extraction";
import { findProtectedContent } from "../protected";
import { BUDGET_UNCLEAR_NOTE, prepareBrief, RESTRICTED_BRIEF_MESSAGE, restoreNames, withheldNote } from "./brief-outbound";
import { emptyChoice, lookupOrganisation, OrgLookupError, selectedChoice, verifyOrganisation } from "./organisations";

export const CREATE_FROM_BRIEF_ID = "jarvis.sales.enquiry.create_from_brief";

const typedName = z.string().trim().max(200).nullable().optional();
const inputSchema = z.discriminatedUnion("mode", [
  // `outbound`: the text the person reviewed and edited to be sent instead of the automatic separation (only offered when the brief could not be separated safely).
  z.object({ mode: z.literal("extract"), brief: z.string().min(1).max(50_000), outbound: z.string().min(1).max(50_000).optional() }),
  z.object({
    mode: z.literal("revise"),
    fields: z.record(z.string(), z.unknown()),
    typed: z.object({ agency: typedName, client: typedName }).optional(),
    search: z.object({ agency: typedName, client: typedName }).optional(),
    fromBrief: z.array(z.string().max(40)).max(40).optional(),
  }),
]);
export type CreateFromBriefInput = z.infer<typeof inputSchema>;

const FIELD_KEY: Record<OrgField, "agencyOrgId" | "clientOrgId"> = { agency: "agencyOrgId", client: "clientOrgId" };
const PROVIDER_WORDS: Record<string, string> = {
  timeout: "JARVIS took too long to read that. Try again, or add the enquiry yourself: Sales & CRM is not affected.",
  http: "JARVIS could not read that just now. Try again in a moment, or add the enquiry yourself: Sales & CRM is not affected.",
  malformed: "JARVIS could not make sense of that. Try again, or add the enquiry yourself with the new-enquiry form in Sales.",
  network: "JARVIS could not be reached just now. Try again in a moment, or add the enquiry yourself: Sales & CRM is not affected.",
};

async function companyName(ctx: JarvisContext): Promise<string> {
  const r = await ctx.supabase.from("companies").select("legal_name").eq("id", ctx.companyId).maybeSingle();
  return (r.data as { legal_name?: string } | null)?.legal_name ?? "this company";
}

async function choiceFor(ctx: JarvisContext, f: OrgField, id: string | null, typed: string | null, search: string | null | undefined): Promise<{ choice: OrgChoice; id: string | null; stale: boolean }> {
  if (search !== undefined && search !== null) {
    const c = await lookupOrganisation(ctx.supabase, f, search);
    return { choice: c, id: c.selectedId, stale: false };
  }
  if (id) {
    const v = await verifyOrganisation(ctx.supabase, f, id);
    if (v.ok) return { choice: selectedChoice(f, typed, id, v.name), id, stale: false };
    // A forged or no-longer-visible id is dropped, never trusted.
    return { choice: { ...emptyChoice(f, typed), status: "not_found", guidance: v.reason === "wrong_role" ? "That organisation does not have the right role for this field. Choose another." : "That organisation could not be found. Choose another." }, id: null, stale: true };
  }
  if (typed) { const c = await lookupOrganisation(ctx.supabase, f, typed); return { choice: c, id: c.selectedId, stale: false }; }
  return { choice: emptyChoice(f, null), id: null, stale: false };
}

async function build(ctx: JarvisContext, values: EnquiryValues, agency: OrgChoice, client: OrgChoice, fromBrief: string[]) {
  const problems: CardProblem[] = validateEnquiry(values, crmToday(ctx.now));
  for (const c of [agency, client]) {
    if (!c.selectedId && c.typedName && c.status !== "none") problems.push({ field: FIELD_KEY[c.field], message: c.guidance ?? `Choose the ${c.field === "agency" ? "agency" : "end client"}.` });
  }
  const dup = await findDuplicateEnquiries(ctx.supabase, values);
  if (!dup.ok) problems.push({ field: "duplicates", message: "Could not check for similar enquiries. Press Review changes to try again." });
  const questions: CardQuestion[] = [];
  const seen = new Set<string>();
  for (const p of problems) {
    const q = questionFor(p.field);
    if (q && !seen.has(p.field)) { seen.add(p.field); questions.push({ field: p.field, ...q }); }
  }
  for (const c of [agency, client]) {
    if (!c.selectedId && c.options.length > 0) questions.push({ field: FIELD_KEY[c.field], text: c.guidance ?? "Which organisation?", options: c.options.map((o) => ({ value: o.id, label: o.place ? `${o.name} (${o.place})` : o.name })) });
  }
  const card: EnquiryCard = {
    kind: "enquiry.create", company: { id: ctx.companyId, name: await companyName(ctx) }, values, agency, client, problems, questions,
    duplicates: dup.ok ? dup.matches : [], valid: problems.length === 0, fromBrief,
  };
  return { values, target: { kind: "new" } as const, valid: card.valid, card };
}

export const createEnquiryFromBrief: JarvisActionDefinition<CreateFromBriefInput, EnquiryValues, EnquiryCard, { opportunityId: string; reference: string }> = {
  id: CREATE_FROM_BRIEF_ID,
  module: "sales",
  title: "Create an enquiry from a brief",
  description: "Paste a WhatsApp message, email or rough brief and JARVIS fills in the new-enquiry form for you to review. Nothing is saved until you press Create enquiry.",
  risk: "write",
  requires: { moduleGrant: "sales" },
  status: { enabled: true },
  usesProvider: true,
  inputSchema,
  valuesSchema: enquiryValuesSchema,
  describe: (v) => `Create the enquiry "${v.title}"`,

  /** Exactly what jarvis_create_enquiry receives (and what the proof is signed over): the enquiry's own fields. */
  wirePayload(v) {
    const due = dubaiDateTimeToIso(v.nextDate, v.nextTime);
    if (!due) return null;
    return {
      company_id: v.companyId, title: v.title, source: v.source, next_title: v.nextTitle, next_due: due, next_kind: v.nextKind,
      agency_org_id: v.agencyOrgId, client_org_id: v.clientOrgId, currency: v.currency, value: v.value, budget_note: v.budgetNote, brief: v.brief,
      event_start: v.eventStart, event_end: v.eventEnd, install_start: v.installStart, location: v.location, technologies: v.technologies, scope: v.scope, waiting_on: v.waitingOn,
    };
  },

  async propose(ctx, input) {
    try {
      if (input.mode === "extract") {
        if (input.brief.length > ctx.config.maxInputChars) throw new JarvisRefusalError("invalid_input", `That is too long (${input.brief.length} characters; the limit is ${ctx.config.maxInputChars}). Paste only the part that describes the job.`);
        // The deterministic refusal list runs BEFORE any provider call or usage count: the text never leaves the app.
        if (!classifyRequest(input.brief).allowed) throw new JarvisRefusalError("excluded_request", EXCLUSION_MESSAGE);
        if (!ctx.provider) throw new JarvisRefusalError("unavailable", "JARVIS is not available right now. Sales & CRM is not affected.");
        // The brief is separated LOCALLY first (sales/brief-outbound.ts): pricing, budgets, contacts, personal data, credentials and contract or restricted material never
        // leave; labelled party names go as placeholders. The original stays here for the review card. The outbound gate screens the result again.
        const prepared = prepareBrief(input.brief);
        // A restriction on the WHOLE brief is final: no provider call in any version (an edited outbound text does not lift it). The person uses the form.
        if (prepared.restricted) throw new JarvisRefusalError("protected_content", RESTRICTED_BRIEF_MESSAGE);
        const outbound = input.outbound ?? prepared.outbound;
        if (input.outbound ? findProtectedContent(outbound).length > 0 : !prepared.separable) throw new JarvisRefusalError("protected_content", "This brief mixes details JARVIS keeps inside Enginious OS with the rest, and they could not be separated safely. Review and edit the text that would be sent, or use the new-enquiry form.");
        // The daily allowance is counted only now: a brief that is refused or needs editing made no provider call.
        const usage = await ctx.takeUsage();
        if ("error" in usage) throw new JarvisRefusalError("unavailable", "JARVIS could not check your daily allowance. Try again in a moment.");
        if (!usage.allowed) throw new JarvisRefusalError("limit_reached", "You have reached today's JARVIS limit. Sales & CRM works as usual; JARVIS is available again tomorrow (Dubai time).");
        let raw: unknown = null;
        let fallback = false;
        try {
          // Only the prepared narrative, the fixed instructions and the field schema are sent. No records, no organisations, no other module.
          // The model returns short fields only (the narrative is kept here, not echoed back), with room to answer: a cut-off answer cannot be used at all.
          raw = await ctx.provider.structured({ task: EXTRACTION_TASK, sources: ["user_text"], instructions: `${EXTRACTION_INSTRUCTIONS}\nToday (Dubai) is ${crmToday(ctx.now)}.`, input: outbound, jsonSchema: EXTRACTION_JSON_SCHEMA, maxOutputTokens: Math.min(4000, Math.max(ctx.config.maxOutputTokens, 2500)), timeoutMs: ctx.config.timeoutMs });
        } catch (e) {
          if (e instanceof JarvisRefusalError) throw e;
          // An answer that could not be used is not a dead end: the card is built from what Enginious OS read itself and asks for the rest.
          if (e instanceof JarvisProviderError && e.kind === "malformed") fallback = true;
          else throw new JarvisRefusalError("provider_error", PROVIDER_WORDS[e instanceof JarvisProviderError ? e.kind : "network"]!);
        }
        const ex: { -readonly [K in keyof Extraction]: Extraction[K] } = { ...restoreNames(sanitiseExtraction(raw), prepared.placeholders) };
        // Identities and the budget are resolved inside Enginious OS: the labelled names win over anything the model returned, and the model never saw the budget.
        if (prepared.parties.agency) ex.agencyName = prepared.parties.agency;
        if (prepared.parties.client) ex.clientName = prepared.parties.client;
        if (ex.agencyName && ex.clientName && ex.agencyName === ex.clientName && !prepared.parties.agency) ex.agencyName = null;
        ex.currency = prepared.budget.currency; ex.value = prepared.budget.value; ex.budgetNote = prepared.budget.note;
        // The ORIGINAL brief is what the review card holds (nothing is cut): only a brief longer than the field keeps the summary there, and the card says so.
        const fits = input.brief.trim().length <= LIMITS.brief;
        const notices = [
          fallback ? "The AI model's answer could not be used, so I filled in only what I could read myself. Please complete the rest below, or use the new-enquiry form." : null,
          prepared.budgetUnclear ? BUDGET_UNCLEAR_NOTE : null,
          input.outbound ? "The AI model received the version you reviewed. Your original brief is kept below and is saved only when you create the enquiry." : withheldNote(prepared),
          fits ? null : `Your brief is longer than the Brief field holds (${input.brief.trim().length} of ${LIMITS.brief} characters), so the field has a summary. Nothing was cut from what you pasted: attach the full text to the enquiry after creating it.`,
        ].filter((x): x is string => !!x);
        const agency = await choiceFor(ctx, "agency", null, ex.agencyName, undefined);
        const client = await choiceFor(ctx, "client", null, ex.clientName, undefined);
        const values: EnquiryValues = {
          ...emptyValues(ctx.companyId), title: ex.title ?? "", source: ex.source ?? "", agencyOrgId: agency.id, clientOrgId: client.id, currency: ex.currency, value: ex.value,
          budgetNote: ex.budgetNote, brief: fits ? input.brief.trim() : ex.briefSummary, eventStart: ex.eventStart, eventEnd: ex.eventEnd, installStart: ex.installStart, location: ex.location,
          technologies: ex.technologies, scope: ex.scope, waitingOn: ex.waitingOn, nextTitle: ex.nextTitle ?? "", nextDate: ex.nextDate ?? "", nextKind: ex.nextKind ?? "other",
        };
        const fromBrief = Object.entries(ex).filter(([k, v]) => k !== "agencyName" && k !== "clientName" && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)).map(([k]) => k);
        if (agency.choice.typedName) fromBrief.push("agencyOrgId");
        if (client.choice.typedName) fromBrief.push("clientOrgId");
        if (fits && !fromBrief.includes("briefSummary")) fromBrief.push("briefSummary");
        const built = await build(ctx, values, agency.choice, client.choice, fromBrief);
        return { ...built, card: { ...built.card, notice: notices.join(" ") || null } };
      }
      // revise: the person edited the card (or answered a question). No provider call and no usage: only the same checks again.
      const parsed = enquiryValuesSchema.safeParse({ ...input.fields, companyId: ctx.companyId });
      if (!parsed.success) throw new JarvisRefusalError("invalid_input", "Those details are not valid.");
      const values = { ...parsed.data, companyId: ctx.companyId };
      const agency = await choiceFor(ctx, "agency", values.agencyOrgId, input.typed?.agency ?? null, input.search?.agency);
      const client = await choiceFor(ctx, "client", values.clientOrgId, input.typed?.client ?? null, input.search?.client);
      values.agencyOrgId = agency.id;
      values.clientOrgId = client.id;
      return build(ctx, values, agency.choice, client.choice, input.fromBrief ?? []);
    } catch (e) {
      if (e instanceof OrgLookupError) throw new JarvisRefusalError("unavailable", "Could not read the organisations just now. Try again in a moment.");
      throw e;
    }
  },

  /** The action's own rules again at execution, through the person's own session: required fields, organisations still visible with the right role. */
  async authorize(ctx, values) {
    const problems = validateEnquiry(values, crmToday(ctx.now));
    if (problems.length > 0) return { ok: false, code: "needs_review", message: `${problems[0]!.message} Review the details again.` };
    try {
      for (const [f, id] of [["agency", values.agencyOrgId], ["client", values.clientOrgId]] as const) {
        const v = await verifyOrganisation(ctx.supabase, f, id);
        if (!v.ok) return { ok: false, code: "needs_review", message: "An organisation on this review is no longer available for that role. Review the details again." };
      }
    } catch {
      return { ok: false, code: "needs_review", message: "Could not check the organisations just now. Try again in a moment." };
    }
    return { ok: true };
  },

  async execute(ctx, input) {
    const v = input.values;
    // A repeat of a confirmation the ledger already knows (double click, retry after a timeout, restart) goes straight to the database, which returns the ORIGINAL result:
    // re-running the duplicate check there would find the very enquiry this confirmation created and wrongly refuse the repeat.
    const known = await ctx.supabase.from("jarvis_action_ledger").select("status").eq("confirmation_id", input.confirmationId).maybeSingle();
    if (known.error) return { kind: "ambiguous" };
    if (!known.data) {
      // A likely duplicate must have been acknowledged on the card (by id); a failed check fails closed.
      const dup = await findDuplicateEnquiries(ctx.supabase, v);
      if (!dup.ok) return { kind: "refused", code: "needs_review", message: "Could not check for similar enquiries just now. Press Review changes to try again." };
      const acknowledged = Array.isArray(input.acknowledgements.duplicateIds) ? (input.acknowledgements.duplicateIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
      if (dup.matches.some((m) => m.level === "likely" && !acknowledged.includes(m.id))) return { kind: "refused", code: "needs_review", message: "A similar enquiry now exists. Review the details again and say whether it is the same one." };
    }
    // ONE database call: the proof is verified inside the database first, then the ledger row and the enquiry commit together (jarvis_create_enquiry wraps the existing
    // crm_create_opportunity under this person's identity). The payload text sent is exactly the text the proof was signed over.
    const r = await ctx.supabase.rpc("jarvis_create_enquiry", proofRpcArgs(input.proofFor())).abortSignal(AbortSignal.timeout(20_000));
    if (r.error) {
      const code = (r.error as { code?: string }).code ?? "";
      // A SQLSTATE answer means the database refused and rolled back: nothing was created. Anything else (network, timeout, gateway) is an unknown outcome.
      if (/^[0-9A-Z]{5}$/.test(code) && !code.startsWith("PGRST")) {
        const proof = proofRefusal(code, r.error.message);
        if (proof) return proof;
        return { kind: "refused", code: code === "42501" ? "not_permitted" : "save_failed", message: friendlyCrmError(r.error.message) };
      }
      return { kind: "ambiguous" };
    }
    const d = r.data as { status?: string; opportunity_id?: string; reference?: string; replayed?: boolean; error_message?: string } | null;
    if (!d || typeof d !== "object") return { kind: "ambiguous" };
    if (d.status === "done" && d.opportunity_id && d.reference) return { kind: "done", result: { opportunityId: d.opportunity_id, reference: d.reference }, replayed: !!d.replayed };
    return { kind: "refused", code: "save_failed", message: friendlyCrmError(d.error_message ?? "The enquiry could not be created.") };
  },

  async verify(ctx, result) {
    const r = await ctx.supabase.from("crm_opportunities").select("id, reference").eq("id", result.opportunityId).maybeSingle();
    const row = r.data as { id: string; reference: string } | null;
    return { ok: !r.error && !!row && row.reference === result.reference };
  },
};
