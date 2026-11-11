"use server";

import { z } from "zod";
import { getJarvis } from "@/lib/jarvis/runtime";
import type { ActionConfirmResult, ConfirmResult, ContextView, JarvisRefusal, SendContext, SendResult, StatusResult } from "@/lib/jarvis/protocol";

/**
 * JARVIS server actions: the ONLY endpoints the panel calls. Each re-derives the person from their session and re-checks the pilot switches, the company and the module grant on
 * EVERY call (hiding the launcher is not access control). `jarvisConfirm` is the one that can write, and only the review card's "Create enquiry" button calls it: no chat message,
 * and nothing the model returns, can reach it. Raw briefs and model output are never logged and never stored by these functions.
 */
const uuid = z.string().uuid();
const bad = (message: string): JarvisRefusal => ({ ok: false, code: "invalid_input", message });

export async function jarvisContext(input: { companyId: string | null; enquiryId: string | null }): Promise<{ ok: true; view: ContextView } | JarvisRefusal> {
  const p = z.object({ companyId: uuid.nullable(), enquiryId: z.string().max(64).nullable() }).safeParse(input);
  if (!p.success) return bad("Not valid.");
  try { return await getJarvis().context(p.data); } catch { return { ok: false, code: "unavailable", message: "JARVIS is not available right now." }; }
}

const sendContext = z.object({
  // Bounded on purpose: a few recent turns of the general conversation, only to support a follow-up such as "make it shorter". It is not stored and is never permission.
  turns: z.array(z.object({ role: z.enum(["user", "jarvis"]), text: z.string().max(20_000) })).max(12).optional(),
  lastLookup: z.object({ period: z.enum(["all", "last_month", "this_month", "last_7_days", "last_30_days"]) }).nullable().optional(),
  // The QUESTION behind the Sales lookup or summary last shown (never its rows). Size-bounded here; its shape is validated by the action's own schema before anything is read.
  lastQuery: z.object({ kind: z.enum(["lookup", "summary"]), descriptor: z.record(z.string(), z.unknown()).refine((d) => JSON.stringify(d).length <= 600) }).nullable().optional(),
}).nullable().optional();

export async function jarvisSend(input: { companyId: string; text: string; intent?: string | null; enquiryId?: string | null; context?: SendContext | null; briefOutbound?: string | null; screen?: string | null }): Promise<SendResult> {
  const p = z.object({ companyId: uuid, text: z.string().max(60_000), intent: z.string().max(20).nullable().optional(), enquiryId: z.string().max(64).nullable().optional(), context: sendContext, briefOutbound: z.string().max(60_000).nullable().optional(), screen: z.string().max(2000).nullable().optional() }).safeParse(input);
  if (!p.success) return bad("Choose a company and type your message.");
  try { return await getJarvis().send(p.data); } catch { return { ok: false, code: "unavailable", message: "JARVIS is not available right now. Sales & CRM is not affected." }; }
}

const orgText = z.string().trim().max(200).nullable().optional();
export async function jarvisReview(input: { companyId: string; fields: Record<string, unknown>; typed?: { agency?: string | null; client?: string | null }; search?: { agency?: string | null; client?: string | null }; fromBrief?: string[] }): Promise<SendResult> {
  const p = z.object({
    companyId: uuid, fields: z.record(z.string().max(40), z.unknown()),
    typed: z.object({ agency: orgText, client: orgText }).optional(), search: z.object({ agency: orgText, client: orgText }).optional(), fromBrief: z.array(z.string().max(40)).max(40).optional(),
  }).safeParse(input);
  if (!p.success) return bad("Those details are not valid.");
  try { return await getJarvis().review(p.data); } catch { return { ok: false, code: "unavailable", message: "JARVIS is not available right now. Sales & CRM is not affected." }; }
}

export async function jarvisConfirm(input: { companyId: string; token: string; values: unknown; duplicateIds?: string[] }): Promise<ConfirmResult> {
  const p = z.object({ companyId: uuid, token: z.string().max(2000), values: z.unknown(), duplicateIds: z.array(uuid).max(10).optional() }).safeParse(input);
  if (!p.success) return bad("This confirmation is not valid.");
  try { return await getJarvis().confirm(p.data); } catch { return { ok: false, code: "ambiguous", message: "We did not get an answer to the save. Checking the original result: nothing will be created twice." }; }
}

export async function jarvisStatus(confirmationId: string): Promise<StatusResult> {
  try { return await getJarvis().status(confirmationId); } catch { return { ok: false, code: "unavailable", message: "Could not check the result right now. Try again in a moment." }; }
}

/** Propose again for one of the other actions (search, revise, choose): never writes. The action id must be registered and enabled; its own input schema validates `input`. */
export async function jarvisAct(input: { companyId: string; actionId: string; input: unknown }): Promise<SendResult> {
  const p = z.object({ companyId: uuid, actionId: z.string().max(120), input: z.unknown() }).safeParse(input);
  if (!p.success) return bad("That request is not valid.");
  try { return await getJarvis().act(p.data); } catch { return { ok: false, code: "unavailable", message: "JARVIS is not available right now. Sales & CRM is not affected." }; }
}

/** The write endpoint of the other actions. Only a review card's confirm button calls it; the confirmation token, the reviewed values and every permission are checked again here. */
export async function jarvisConfirmAction(input: { companyId: string; actionId: string; token: string; values: unknown; acknowledgements?: Record<string, unknown> }): Promise<ActionConfirmResult> {
  const p = z.object({ companyId: uuid, actionId: z.string().max(120), token: z.string().max(2000), values: z.unknown(), acknowledgements: z.record(z.string().max(40), z.unknown()).optional() }).safeParse(input);
  if (!p.success) return bad("This confirmation is not valid.");
  try { return await getJarvis().confirmAction(p.data); } catch { return { ok: false, code: "ambiguous", message: "We did not get an answer to the save. Checking the original result: nothing will be saved twice." }; }
}

/** What JARVIS remembers for the signed-in person (their own preferences only): list, set one of the fixed choices, or delete. */
export async function jarvisMemory(input: { op: "list" } | { op: "set"; key: string; value: string } | { op: "delete"; key: string }): Promise<SendResult> {
  const p = z.discriminatedUnion("op", [z.object({ op: z.literal("list") }), z.object({ op: z.literal("set"), key: z.string().max(40), value: z.string().max(40) }), z.object({ op: z.literal("delete"), key: z.string().max(40) })]).safeParse(input);
  if (!p.success) return bad("Not valid.");
  try { return await getJarvis().memory(p.data); } catch { return { ok: false, code: "unavailable", message: "Could not reach your saved preferences just now." }; }
}

/** Suggest a correction to a guidance topic: stored for review; it changes no answer until it is reviewed and published through the Map. */
export async function jarvisSuggestCorrection(input: { topicId: string; text: string }): Promise<SendResult> {
  const p = z.object({ topicId: z.string().regex(/^[a-z][a-z0-9-]{2,60}$/), text: z.string().max(2000) }).safeParse(input);
  if (!p.success) return bad("Not valid.");
  try { return await getJarvis().suggestCorrection(p.data); } catch { return { ok: false, code: "unavailable", message: "Could not send your suggestion just now." }; }
}
