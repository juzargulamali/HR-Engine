"use server";

import { z } from "zod";
import { getJarvis } from "@/lib/jarvis/runtime";
import type { ConfirmResult, ContextView, JarvisRefusal, SendResult, StatusResult } from "@/lib/jarvis/protocol";

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

export async function jarvisSend(input: { companyId: string; text: string }): Promise<SendResult> {
  const p = z.object({ companyId: uuid, text: z.string().max(60_000) }).safeParse(input);
  if (!p.success) return bad("Choose a company and paste a brief.");
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
