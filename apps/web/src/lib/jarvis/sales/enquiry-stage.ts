import "server-only";
import { z } from "zod";
import { crmStageLabel } from "@enginious-hr/domain";
import type { EnquiryStageCard, StageValues } from "../protocol";
import { JarvisRefusalError, type GenericResult, type JarvisActionDefinition, type JarvisContext } from "../types";
import { enquiryRef, isOwnerOrFounder, LOOKUP_WORDS, readEnquiry, type EnquiryRow } from "./enquiry-read";
import { proofRpcArgs } from "../token";
import { rpcOutcome } from "./rpc-outcome";
import { CLOSING_WORDS, ESTIMATE_SENT_NOT_THROUGH_JARVIS, NEVER_THROUGH_JARVIS, stageFromText, transitionsFrom, type Evidence } from "./stage-transitions";

export const CHANGE_STAGE_ID = "jarvis.sales.enquiry.change_stage";

const inputSchema = z.object({ mode: z.literal("propose"), enquiryId: z.string().uuid(), text: z.string().trim().max(500).optional(), to: z.string().max(30).optional() });
export type ChangeStageInput = z.infer<typeof inputSchema>;
const valuesSchema = z.object({ companyId: z.string().uuid(), enquiryId: z.string().uuid(), from: z.string().max(30), to: z.string().max(30) }) as unknown as z.ZodType<StageValues>;

/** What the database gates on, read through the person's own session (a failed read is "unknown": the gated moves stay off, never assumed). */
export async function readEvidence(ctx: JarvisContext, enquiryId: string): Promise<Evidence> {
  const p = await ctx.supabase.from("crm_proposals").select("id").eq("opportunity_id", enquiryId).in("status", ["sent", "accepted"]).limit(1);
  const z = await ctx.supabase.from("crm_zoho_references").select("quote_ref").eq("opportunity_id", enquiryId).maybeSingle();
  const ref = (z.data as { quote_ref: string | null } | null)?.quote_ref;
  return {
    proposalSent: p.error ? "unknown" : ((p.data ?? []) as unknown[]).length > 0,
    zohoQuoteRef: z.error ? "unknown" : typeof ref === "string" && ref.trim().length > 0,
  };
}

async function editable(ctx: JarvisContext, enquiryId: string): Promise<EnquiryRow> {
  const found = await readEnquiry(ctx.supabase, enquiryId, ctx.companyId);
  if (!found.ok) throw new JarvisRefusalError(found.reason === "unreadable" ? "unavailable" : "not_permitted", LOOKUP_WORDS[found.reason]);
  const who = await isOwnerOrFounder(ctx.supabase, ctx.userId, found.row);
  if (who === "error") throw new JarvisRefusalError("unavailable", "Could not check your access just now. Try again in a moment.");
  if (!who) throw new JarvisRefusalError("not_permitted", "Only the enquiry's owner or a Sales founder can change its stage. You can still add updates and follow-ups.");
  return found.row;
}

const EFFECTS = [
  "The enquiry moves to the new stage and the time in stage starts again.",
  "A \"Stage changed\" line is added to its timeline, and a second line says you approved it through JARVIS.",
  "Its open follow-up, owner and details stay exactly as they are.",
];

async function build(ctx: JarvisContext, e: EnquiryRow, to: string | null, extraProblem: string | null) {
  const ev = await readEvidence(ctx, e.id);
  const transitions = transitionsFrom(e.stage, ev);
  const problems: EnquiryStageCard["problems"] = [];
  if (extraProblem) problems.push({ field: "to", message: extraProblem });
  let values: StageValues | null = null;
  const chosen = to ? transitions.find((t) => t.to === to) : undefined;
  if (to && !chosen) problems.push({ field: "to", message: to === e.stage ? "The enquiry is already at that stage." : to === "estimate_sent" ? ESTIMATE_SENT_NOT_THROUGH_JARVIS : "JARVIS cannot move an enquiry to that stage." });
  else if (chosen && !chosen.enabled) problems.push({ field: "to", message: chosen.reason ?? "That move is not available." });
  else if (chosen) values = { companyId: ctx.companyId, enquiryId: e.id, from: e.stage, to: chosen.to };
  if (!to && !extraProblem) problems.push({ field: "to", message: "Choose the stage to move it to." });
  const evidence: EnquiryStageCard["evidence"] = [];
  if (to === "proposal_sent") evidence.push({ label: "A proposal recorded as sent", met: ev.proposalSent === "unknown" ? null : ev.proposalSent, text: ev.proposalSent === true ? "A proposal is recorded as sent." : ev.proposalSent === "unknown" ? "Could not be checked." : "None is recorded." });
  if (to === "quote_sent") evidence.push({ label: "The Zoho Books quote reference", met: ev.zohoQuoteRef === "unknown" ? null : ev.zohoQuoteRef, text: ev.zohoQuoteRef === true ? "The quote reference is recorded." : ev.zohoQuoteRef === "unknown" ? "Could not be checked." : "None is recorded." });
  if (to && to !== "proposal_sent" && to !== "quote_sent" && to !== "estimate_sent") evidence.push({ label: "Evidence", met: true, text: "This move needs no extra evidence." });
  const c: EnquiryStageCard = {
    kind: "enquiry.stage", enquiry: { ...enquiryRef(e), version: e.version ?? 1 }, from: e.stage, fromLabel: crmStageLabel(e.stage),
    to: values ? values.to : to, toLabel: to ? crmStageLabel(to) : null, transitions, evidence, effects: EFFECTS, values, problems, valid: !!values && problems.length === 0,
  };
  return { values: values ?? { companyId: ctx.companyId, enquiryId: e.id, from: e.stage, to: e.stage }, target: { kind: "record", id: e.id, version: e.version ?? 1 } as const, valid: c.valid, card: c };
}

/**
 * Change an enquiry's status, one verified step at a time. No provider: the requested stage is read from the person's words by fixed rules, or chosen on the card. The card shows the
 * current and proposed stage, the evidence the existing gate needs (and whether it is recorded) and what the move does. The confirmation is bound to the enquiry, both stages AND the
 * record version; the write is the ledger-backed wrapper around the EXISTING crm_move_stage, so its refusals (owner/founder, version, closed, the two gates) apply and are shown.
 * Mark Won, closure (Lost), On hold, reopen and handover are NEVER offered here.
 */
export const changeStage: JarvisActionDefinition<ChangeStageInput, StageValues, EnquiryStageCard, GenericResult> = {
  id: CHANGE_STAGE_ID,
  module: "sales",
  title: "Change an enquiry's status",
  description: "Open an enquiry and say which stage to move it to (one step at a time). JARVIS shows the current and new stage, the evidence the stage needs and what changes; nothing moves until you press Move. Won, Lost, On hold, reopening and handover stay on the enquiry page.",
  risk: "write",
  requires: { moduleGrant: "sales" },
  status: { enabled: true },
  usesProvider: false,
  inputSchema,
  valuesSchema,
  /** Exactly what jarvis_change_stage receives as its signed payload: the stage to move to. The enquiry and its version are the signed target. */
  wirePayload: (v) => ({ to: v.to }),
  describe: (v) => `Move the enquiry from ${crmStageLabel(v.from)} to ${crmStageLabel(v.to)}`,

  async propose(ctx, input) {
    const e = await editable(ctx, input.enquiryId);
    if (input.to) return build(ctx, e, input.to, null);
    const text = input.text ?? "";
    if (CLOSING_WORDS.test(text) && !stageFromText(text.replace(CLOSING_WORDS, ""))) return build(ctx, e, null, NEVER_THROUGH_JARVIS);
    return build(ctx, e, stageFromText(text), CLOSING_WORDS.test(text) ? NEVER_THROUGH_JARVIS : null);
  },

  /** The rules again at execution: the enquiry, its version (a fresh review if it changed), who may move it, the move itself and its evidence. A repeat of a saved confirmation skips this. */
  async authorize(ctx, values, target, meta) {
    const known = await ctx.supabase.from("jarvis_action_ledger").select("status").eq("confirmation_id", meta.confirmationId).maybeSingle();
    if (known.error) return { ok: false, code: "needs_review", message: "Could not check just now. Try again in a moment." };
    if (known.data) return { ok: true };
    if (target.kind !== "record" || target.id !== values.enquiryId) return { ok: false, code: "needs_review", message: "This review is not for that enquiry. Review the details again." };
    let e: EnquiryRow;
    try { e = await editable(ctx, values.enquiryId); }
    catch (err) { return err instanceof JarvisRefusalError ? { ok: false, code: err.code === "not_permitted" ? "not_permitted" : "needs_review", message: err.message } : { ok: false, code: "needs_review", message: "Could not check the enquiry just now." }; }
    if ((e.version ?? 1) !== target.version || e.stage !== values.from) return { ok: false, code: "needs_review", message: "This enquiry was changed by someone else after you reviewed it. Review the details again before moving it." };
    const t = transitionsFrom(e.stage, await readEvidence(ctx, e.id)).find((x) => x.to === values.to);
    if (!t || !t.enabled) return { ok: false, code: "needs_review", message: `${t?.reason ?? "That move is not available."} Review the details again.` };
    return { ok: true };
  },

  async execute(ctx, input) {
    if (input.target.kind !== "record" || input.target.version === null) return { kind: "refused", code: "needs_review", message: "This review is not bound to a version of the enquiry. Review the details again." };
    const r = await ctx.supabase.rpc("jarvis_change_stage", proofRpcArgs(input.proofFor())).abortSignal(AbortSignal.timeout(20_000));
    return rpcOutcome(r, "The stage could not be changed.");
  },

  async verify(ctx, result) {
    const r = await ctx.supabase.from("crm_opportunities").select("id, reference").eq("id", result.resultId).maybeSingle();
    const row = r.data as { id: string; reference: string } | null;
    return { ok: !r.error && !!row && row.reference === result.reference };
  },

  resultView: ({ resultId, reference, extra }) => {
    const from = typeof extra?.from === "string" ? crmStageLabel(extra.from) : null;
    const to = typeof extra?.to === "string" ? crmStageLabel(extra.to) : null;
    return { reference, href: `/sales/opportunities/${resultId}`, summary: `${reference} was moved${from && to ? ` from ${from} to ${to}` : ""}, and you approved it.` };
  },
};

