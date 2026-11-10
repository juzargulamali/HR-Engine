import "server-only";
import { z } from "zod";
import { crmToday } from "@enginious-hr/domain";
import { classifyRequest, EXCLUSION_MESSAGE } from "../classifier";
import type { EnquiryUpdateCard, UpdateForm, UpdateValues } from "../protocol";
import { UPDATE_FIELDS } from "../protocol";
import { JarvisProviderError } from "../provider/types";
import { JarvisRefusalError, type GenericResult, type JarvisActionDefinition, type JarvisContext } from "../types";
import { enquiryRef, isOwnerOrFounder, LOOKUP_WORDS, readEnquiry, type EnquiryRow } from "./enquiry-read";
import {
  changesOf, currentForm, dbPatch, diffPatch, FIELD_COLUMN, FIELD_LABEL, sanitiseUpdate, UPDATE_INSTRUCTIONS, UPDATE_JSON_SCHEMA, UPDATE_TASK, updateFormSchema, updateValuesSchema, validateUpdate,
} from "./enquiry-update-values";
import { proofRpcArgs } from "../token";
import { rpcOutcome } from "./rpc-outcome";

export const UPDATE_ENQUIRY_ID = "jarvis.sales.enquiry.update";

const inputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("extract"), enquiryId: z.string().uuid(), text: z.string().trim().min(1).max(50_000) }),
  /** The person edited the form on the card: the WHOLE proposed form comes back and is diffed against the enquiry again. */
  z.object({ mode: z.literal("revise"), enquiryId: z.string().uuid(), fields: z.record(z.string().max(40), z.unknown()) }),
]);
export type UpdateEnquiryInput = z.infer<typeof inputSchema>;

const WORDS: Record<string, string> = {
  timeout: "JARVIS took too long to read that. Try again, or edit the enquiry yourself: Sales & CRM is not affected.",
  http: "JARVIS could not read that just now. Try again in a moment, or edit the enquiry yourself: Sales & CRM is not affected.",
  malformed: "JARVIS could not make sense of that. Try again, or edit the enquiry yourself.",
  network: "JARVIS could not be reached just now. Try again in a moment, or edit the enquiry yourself: Sales & CRM is not affected.",
};
const CANNOT = "Only the enquiry's owner or a Sales founder can edit it. You can still add updates and follow-ups.";

/** The enquiry as the person may edit it: visible, in the selected company, not Lost, and theirs (owner) or a founder's: the rule of crm_update_opportunity, read first so the person is told before reviewing. */
async function editable(ctx: JarvisContext, enquiryId: string): Promise<EnquiryRow> {
  const found = await readEnquiry(ctx.supabase, enquiryId, ctx.companyId);
  if (!found.ok) throw new JarvisRefusalError(found.reason === "unreadable" ? "unavailable" : "not_permitted", LOOKUP_WORDS[found.reason]);
  const e = found.row;
  if (e.stage === "lost") throw new JarvisRefusalError("not_permitted", "A lost enquiry can no longer be edited. A founder can reopen it from the enquiry page.");
  const who = await isOwnerOrFounder(ctx.supabase, ctx.userId, e);
  if (who === "error") throw new JarvisRefusalError("unavailable", "Could not check your access just now. Try again in a moment.");
  if (!who) throw new JarvisRefusalError("not_permitted", CANNOT);
  return e;
}

function card(ctx: JarvisContext, e: EnquiryRow, proposed: UpdateForm): { values: UpdateValues; target: { kind: "record"; id: string; version: number }; valid: boolean; card: EnquiryUpdateCard } {
  const current = currentForm(e);
  const patch = diffPatch(current, proposed);
  const problems = validateUpdate({ ...current, ...patch }, patch);
  const values: UpdateValues = { companyId: ctx.companyId, enquiryId: e.id, patch };
  const c: EnquiryUpdateCard = {
    kind: "enquiry.update", enquiry: { ...enquiryRef(e), version: e.version ?? 1 }, changes: changesOf(current, patch), current, proposed: { ...current, ...patch },
    fields: UPDATE_FIELDS.map((key) => ({ key, label: FIELD_LABEL[key] })), values, problems, valid: problems.length === 0,
  };
  return { values, target: { kind: "record", id: e.id, version: e.version ?? 1 }, valid: c.valid, card: c };
}

/**
 * Update an existing enquiry, but ONLY the allowlisted fields (title, brief, event dates, installation, location, technologies, scope, waiting on, budget note). The card shows each
 * change as before -> after; the confirmation is bound to the enquiry, the changed values AND the record's version, which is rechecked at execution (and again by the database
 * function): if anyone changed the enquiry since, a fresh review is required. The write is the ledger-backed wrapper around the existing crm_update_opportunity.
 */
export const updateEnquiry: JarvisActionDefinition<UpdateEnquiryInput, UpdateValues, EnquiryUpdateCard, GenericResult> = {
  id: UPDATE_ENQUIRY_ID,
  module: "sales",
  title: "Update an enquiry",
  description: "Open an enquiry and say what to change (title, dates, location, technologies, scope, who it is waiting on, budget note). JARVIS shows each change as before and after; nothing is saved until you press Save changes. It cannot touch the owner, stage, value, organisations, proposals or files.",
  risk: "write",
  requires: { moduleGrant: "sales" },
  status: { enabled: true },
  usesProvider: true,
  inputSchema,
  valuesSchema: updateValuesSchema,
  /** Exactly what jarvis_update_enquiry receives as its signed payload: the (allowlisted) changed fields, as the database columns. The enquiry and its version are the signed target. */
  wirePayload: (v) => dbPatch(v.patch),
  describe: (v) => `Update ${Object.keys(v.patch).map((k) => FIELD_LABEL[k as keyof typeof FIELD_LABEL] ?? k).join(", ").toLowerCase()} of the enquiry`,

  async propose(ctx, input) {
    const e = await editable(ctx, input.enquiryId);
    const current = currentForm(e);
    if (input.mode === "revise") {
      const form = updateFormSchema.safeParse({ ...current, ...input.fields });
      if (!form.success) throw new JarvisRefusalError("invalid_input", "Those details are not valid.");
      return card(ctx, e, form.data);
    }
    if (input.text.length > ctx.config.maxInputChars) throw new JarvisRefusalError("invalid_input", `That is too long (${input.text.length} characters; the limit is ${ctx.config.maxInputChars}).`);
    if (!classifyRequest(input.text).allowed) throw new JarvisRefusalError("excluded_request", EXCLUSION_MESSAGE);
    if (!ctx.provider) throw new JarvisRefusalError("unavailable", "JARVIS is not available right now. Sales & CRM is not affected.");
    const usage = await ctx.takeUsage();
    if ("error" in usage) throw new JarvisRefusalError("unavailable", "JARVIS could not check your daily allowance. Try again in a moment.");
    if (!usage.allowed) throw new JarvisRefusalError("limit_reached", "You have reached today's JARVIS limit. Sales & CRM works as usual; JARVIS is available again tomorrow (Dubai time).");
    let raw: unknown;
    try {
      // Only: the fixed instructions, today's date, the CURRENT values of the allowlisted fields of this one enquiry and the person's request. No owner, value, organisation or id.
      raw = await ctx.provider.structured({
        task: UPDATE_TASK, sources: ["user_text", "enquiry_update_fields"], instructions: `${UPDATE_INSTRUCTIONS}\nToday (Dubai) is ${crmToday(ctx.now)}.`,
        input: `<current>\n${JSON.stringify({ ...current, budgetNote: undefined }).replace(/<\/?\s*(?:current|request)\s*>/gi, "")}\n</current>\n<request>\n${input.text.replace(/<\/?\s*(?:current|request)\s*>/gi, "")}\n</request>`, inputTag: null,
        guard: "Return the changes only by calling the record_fields tool. Leave out every field the request does not change.",
        jsonSchema: UPDATE_JSON_SCHEMA, maxOutputTokens: ctx.config.maxOutputTokens, timeoutMs: ctx.config.timeoutMs,
      });
    } catch (err) {
      if (err instanceof JarvisRefusalError) throw err;
      throw new JarvisRefusalError("provider_error", WORDS[err instanceof JarvisProviderError ? err.kind : "network"]!);
    }
    const patch = sanitiseUpdate(raw, current);
    return card(ctx, e, { ...current, ...patch });
  },

  /** The rules again at execution, through the person's own session: the enquiry, its version (a fresh review if it changed), who may edit it, and the form's rules. A repeat of a saved confirmation skips this (the database returns the original result). */
  async authorize(ctx, values, target, meta) {
    const known = await ctx.supabase.from("jarvis_action_ledger").select("status").eq("confirmation_id", meta.confirmationId).maybeSingle();
    if (known.error) return { ok: false, code: "needs_review", message: "Could not check just now. Try again in a moment." };
    if (known.data) return { ok: true };
    if (target.kind !== "record" || target.id !== values.enquiryId) return { ok: false, code: "needs_review", message: "This review is not for that enquiry. Review the details again." };
    let e: EnquiryRow;
    try { e = await editable(ctx, values.enquiryId); }
    catch (err) { return err instanceof JarvisRefusalError ? { ok: false, code: err.code === "not_permitted" ? "not_permitted" : "needs_review", message: err.message } : { ok: false, code: "needs_review", message: "Could not check the enquiry just now." }; }
    if ((e.version ?? 1) !== target.version) return { ok: false, code: "needs_review", message: "This enquiry was changed by someone else after you reviewed it. Review the details again before saving." };
    const problems = validateUpdate({ ...currentForm(e), ...values.patch }, values.patch);
    return problems.length > 0 ? { ok: false, code: "needs_review", message: `${problems[0]!.message} Review the details again.` } : { ok: true };
  },

  async execute(ctx, input) {
    if (input.target.kind !== "record" || input.target.version === null) return { kind: "refused", code: "needs_review", message: "This review is not bound to a version of the enquiry. Review the details again." };
    const r = await ctx.supabase.rpc("jarvis_update_enquiry", proofRpcArgs(input.proofFor())).abortSignal(AbortSignal.timeout(20_000));
    return rpcOutcome(r, "The enquiry could not be updated.");
  },

  async verify(ctx, result) {
    const r = await ctx.supabase.from("crm_opportunities").select("id, reference").eq("id", result.resultId).maybeSingle();
    const row = r.data as { id: string; reference: string } | null;
    return { ok: !r.error && !!row && row.reference === result.reference };
  },

  resultView: ({ resultId, reference, extra }) => {
    const fields = Array.isArray(extra?.fields) ? (extra!.fields as string[]) : [];
    const labels = UPDATE_FIELDS.filter((k) => fields.includes(FIELD_COLUMN[k])).map((k) => FIELD_LABEL[k]);
    return { reference, href: `/sales/opportunities/${resultId}`, summary: `${reference} was updated${labels.length ? ` (${labels.join(", ").toLowerCase()})` : ""}, and you approved it.` };
  },
};

