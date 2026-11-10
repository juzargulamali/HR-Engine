import "server-only";
import { z } from "zod";
import { crmToday, dubaiDateTimeToIso } from "@enginious-hr/domain";
import { classifyRequest, EXCLUSION_MESSAGE } from "../classifier";
import type { MeetingCard, MeetingValues } from "../protocol";
import { JarvisProviderError } from "../provider/types";
import { JarvisRefusalError, type GenericResult, type JarvisActionDefinition, type JarvisContext } from "../types";
import { enquiryRef, LOOKUP_WORDS, readEnquiry, type EnquiryRow } from "./enquiry-read";
import { emptyMeeting, MEETING_INSTRUCTIONS, MEETING_JSON_SCHEMA, MEETING_TASK, meetingValuesSchema, questionsFor, sanitiseMeeting, validateMeeting } from "./meeting-values";
import { proofRpcArgs } from "../token";
import { rpcOutcome } from "./rpc-outcome";

export const RECORD_MEETING_ID = "jarvis.sales.meeting.record";

const inputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("extract"), enquiryId: z.string().uuid(), notes: z.string().trim().min(1).max(50_000) }),
  z.object({ mode: z.literal("revise"), enquiryId: z.string().uuid(), fields: z.record(z.string().max(40), z.unknown()) }),
]);
export type RecordMeetingInput = z.infer<typeof inputSchema>;

const WORDS: Record<string, string> = {
  timeout: "JARVIS took too long to read those notes. Try again, or use Add update on the enquiry: Sales & CRM is not affected.",
  http: "JARVIS could not read those notes just now. Try again in a moment, or use Add update on the enquiry: Sales & CRM is not affected.",
  malformed: "JARVIS could not make sense of those notes. Try again, or use Add update on the enquiry.",
  network: "JARVIS could not be reached just now. Try again in a moment, or use Add update on the enquiry: Sales & CRM is not affected.",
};

/** The enquiry as the person may log on it: visible, in the selected company, and not Lost (crm_add_activity refuses a lost enquiry). */
async function loggable(ctx: JarvisContext, enquiryId: string): Promise<EnquiryRow> {
  const found = await readEnquiry(ctx.supabase, enquiryId, ctx.companyId);
  if (!found.ok) throw new JarvisRefusalError(found.reason === "unreadable" ? "unavailable" : "not_permitted", LOOKUP_WORDS[found.reason]);
  if (found.row.stage === "lost") throw new JarvisRefusalError("not_permitted", "A lost enquiry can no longer be updated. A founder can reopen it from the enquiry page.");
  return found.row;
}

function card(ctx: JarvisContext, e: EnquiryRow, v: MeetingValues) {
  const problems = validateMeeting(v, crmToday(ctx.now), e.stage);
  const c: MeetingCard = { kind: "meeting.record", enquiry: enquiryRef(e), values: v, questions: questionsFor(problems), problems, valid: problems.length === 0 };
  return { values: v, target: { kind: "record", id: e.id, version: null } as const, valid: c.valid, card: c };
}

/**
 * Meeting notes -> a proposed activity and a proposed follow-up for an authorised enquiry. ONE confirmation covers both, and they are saved ATOMICALLY by one ledger-backed
 * wrapper (jarvis_record_meeting) that calls the existing crm_add_activity and crm_create_follow_up under the person's identity in one transaction: both or neither, never a hidden
 * half-state. The follow-up is for the person approving it. A follow-up DATE is accepted only if the notes really state it (an exact date or an unambiguous day word); otherwise the
 * card asks. The provider receives only the pasted notes and the fixed instructions: no enquiry data.
 */
export const recordMeeting: JarvisActionDefinition<RecordMeetingInput, MeetingValues, MeetingCard, GenericResult> = {
  id: RECORD_MEETING_ID,
  module: "sales",
  title: "Turn meeting notes into an activity and follow-up",
  description: "Open an enquiry and paste your meeting notes: JARVIS proposes an update for the enquiry's timeline and a follow-up for you, for you to review. Both are saved together when you press Save, or not at all. It never guesses a date.",
  risk: "write",
  requires: { moduleGrant: "sales" },
  status: { enabled: true },
  usesProvider: true,
  inputSchema,
  valuesSchema: meetingValuesSchema,
  /**
   * Exactly what jarvis_record_meeting receives as its signed payload: the activity and the (optional) follow-up. "Occurred on" becomes a timestamp only for a past day, so the text can
   * differ if the review is confirmed on a later Dubai day: the person is then asked to review again (never a silent change).
   */
  wirePayload: (v, ctx) => {
    const today = crmToday(ctx.now);
    const due = v.planFollowUp ? dubaiDateTimeToIso(v.followUpDate, v.followUpTime) : null;
    if (v.planFollowUp && !due) return null;
    const occurred = v.occurredOn && v.occurredOn < today ? dubaiDateTimeToIso(v.occurredOn, "12:00") : null;
    return { activity: { kind: v.kind, body: v.body, occurred_at: occurred, internal: v.internal }, follow_up: v.planFollowUp ? { title: v.followUpTitle, due_at: due, kind: v.followUpKind } : null };
  },
  describe: (v) => `Record a ${v.kind.replace("_", " ")}${v.planFollowUp ? " and a follow-up" : ""} on the enquiry`,

  async propose(ctx, input) {
    const e = await loggable(ctx, input.enquiryId);
    const base = emptyMeeting(ctx.companyId, e.id);
    if (input.mode === "revise") {
      const parsed = meetingValuesSchema.safeParse({ ...base, ...input.fields, companyId: ctx.companyId, enquiryId: e.id });
      if (!parsed.success) throw new JarvisRefusalError("invalid_input", "Those details are not valid.");
      return card(ctx, e, { ...parsed.data, companyId: ctx.companyId, enquiryId: e.id });
    }
    if (input.notes.length > ctx.config.maxInputChars) throw new JarvisRefusalError("invalid_input", `Those notes are too long (${input.notes.length} characters; the limit is ${ctx.config.maxInputChars}). Paste only the part that matters.`);
    if (!classifyRequest(input.notes).allowed) throw new JarvisRefusalError("excluded_request", EXCLUSION_MESSAGE);
    if (!ctx.provider) throw new JarvisRefusalError("unavailable", "JARVIS is not available right now. Sales & CRM is not affected.");
    const usage = await ctx.takeUsage();
    if ("error" in usage) throw new JarvisRefusalError("unavailable", "JARVIS could not check your daily allowance. Try again in a moment.");
    if (!usage.allowed) throw new JarvisRefusalError("limit_reached", "You have reached today's JARVIS limit. Sales & CRM works as usual; JARVIS is available again tomorrow (Dubai time).");
    const today = crmToday(ctx.now);
    let raw: unknown;
    try {
      // Only the fixed instructions, today's date and the person's pasted notes: no enquiry record, no organisation, no id.
      raw = await ctx.provider.structured({
        task: MEETING_TASK, sources: ["user_text"], instructions: `${MEETING_INSTRUCTIONS}\nToday (Dubai) is ${today}.`, input: input.notes.replace(/<\/?\s*notes\s*>/gi, ""), inputTag: "notes",
        jsonSchema: MEETING_JSON_SCHEMA, maxOutputTokens: ctx.config.maxOutputTokens, timeoutMs: ctx.config.timeoutMs,
      });
    } catch (err) {
      if (err instanceof JarvisRefusalError) throw err;
      throw new JarvisRefusalError("provider_error", WORDS[err instanceof JarvisProviderError ? err.kind : "network"]!);
    }
    const values = sanitiseMeeting(raw, input.notes, today, base);
    // A closed enquiry takes the activity but no follow-up: say so instead of proposing one the database would refuse.
    return card(ctx, e, e.stage === "won" ? { ...values, planFollowUp: false } : values);
  },

  /** The rules again at execution, through the person's own session. A repeat of a saved confirmation skips this (the database returns the original result). */
  async authorize(ctx, values, target, meta) {
    const known = await ctx.supabase.from("jarvis_action_ledger").select("status").eq("confirmation_id", meta.confirmationId).maybeSingle();
    if (known.error) return { ok: false, code: "needs_review", message: "Could not check just now. Try again in a moment." };
    if (known.data) return { ok: true };
    if (target.kind !== "record" || target.id !== values.enquiryId) return { ok: false, code: "needs_review", message: "This review is not for that enquiry. Review the details again." };
    let e: EnquiryRow;
    try { e = await loggable(ctx, values.enquiryId); }
    catch (err) { return err instanceof JarvisRefusalError ? { ok: false, code: err.code === "not_permitted" ? "not_permitted" : "needs_review", message: err.message } : { ok: false, code: "needs_review", message: "Could not check the enquiry just now." }; }
    const problems = validateMeeting(values, crmToday(ctx.now), e.stage);
    return problems.length > 0 ? { ok: false, code: "needs_review", message: `${problems[0]!.message} Review the details again.` } : { ok: true };
  },

  async execute(ctx, input) {
    const r = await ctx.supabase.rpc("jarvis_record_meeting", proofRpcArgs(input.proofFor())).abortSignal(AbortSignal.timeout(20_000));
    return rpcOutcome(r, "The meeting could not be recorded.");
  },

  async verify(ctx, result) {
    const r = await ctx.supabase.from("crm_opportunities").select("id, reference").eq("id", result.resultId).maybeSingle();
    const row = r.data as { id: string; reference: string } | null;
    return { ok: !r.error && !!row && row.reference === result.reference };
  },

  resultView: ({ resultId, reference, extra }) => ({
    reference, href: `/sales/opportunities/${resultId}`,
    summary: `${reference}: the activity${extra?.follow_up_id ? " and the follow-up were" : " was"} recorded together, and you approved ${extra?.follow_up_id ? "them" : "it"}.`,
  }),
};
