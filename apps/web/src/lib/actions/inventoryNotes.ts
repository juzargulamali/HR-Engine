"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, ok, optionalText, refreshInventory, uuid, type InvActionState } from "@/lib/inventory/action-utils";

/**
 * Server actions for dispatch notes and return checklists. Each is a thin wrapper over a database function: the function decides who may answer (the
 * current Project Manager, an acting Project Manager, a Projects founder; for a difference, a warehouse operator at the location that recorded the note), records
 * the capacity, and refuses anyone else. Hidden buttons are cosmetic. Nothing here moves stock, changes availability or custody, writes anything off or deducts
 * anything: an answer is one append-only event beside the note.
 */
const fields = (fd: FormData) => Object.fromEntries(fd) as Record<string, FormDataEntryValue>;

const refresh = (projectId: string) => refreshInventory([`/projects/${projectId}/equipment`, "/"]);

const answerSchema = z.object({
  noteId: uuid,
  projectId: uuid,
  action: z.enum(["acknowledge", "report_difference", "withdraw"], { message: "Choose what to do" }),
  reason: optionalText,
  comment: optionalText,
});

/** The Project Manager's answer: acknowledge the recorded list, report a difference on named lines, or withdraw an open report. */
export async function answerNote(_prev: InvActionState, fd: FormData): Promise<InvActionState> {
  const p = answerSchema.safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  const lines = fd.getAll("line").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  if (d.action === "report_difference") {
    if (!d.reason) return { error: "Say what is different" };
    if (lines.length === 0 && d.reason !== "missing_from_list") return { error: "Tick the line or lines that differ" };
    if (d.reason === "other" && !d.comment) return { error: "Describe the difference in the comment" };
  }
  const db = await createClient();
  const { error } = await db.rpc("inv_ack_project_note", {
    p_note_id: d.noteId, p_action: d.action, p_lines: d.action === "report_difference" ? lines : null, p_comment: d.comment ?? null, p_reason: d.action === "report_difference" ? d.reason ?? null : null,
  });
  if (error) return fail(error.message);
  refresh(d.projectId);
  return ok();
}

const resolveSchema = z.object({
  noteId: uuid,
  projectId: uuid,
  resolution: z.enum(["record_stands", "corrected"], { message: "Choose how the difference is answered" }),
  comment: optionalText,
  movementCode: optionalText,
});

/**
 * The warehouse's answer to a reported difference: "the record stands", or "corrected" naming the movement that corrected the ledger by the existing actions
 * (a correction of the same kind for the same project becomes a NEW note that cites this one; this note and its history are never altered).
 */
export async function resolveDifference(_prev: InvActionState, fd: FormData): Promise<InvActionState> {
  const p = resolveSchema.safeParse(fields(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const d = p.data;
  if (!d.comment) return { error: "Say what the warehouse found, in the comment" };
  const db = await createClient();
  let movementId: string | null = null;
  if (d.resolution === "corrected") {
    const code = (d.movementCode ?? "").trim().toUpperCase();
    if (!code) return { error: "Name the movement that corrected the record: its reference from History, for example ENG-M-00044" };
    const { data: note, error: noteError } = await db.from("inv_project_notes").select("company_id").eq("id", d.noteId).maybeSingle();
    if (noteError) return fail(noteError.message);
    if (!note) return { error: "Note not found" };
    const { data: movement, error: moveError } = await db.from("inv_movements").select("id").eq("company_id", note.company_id).eq("code", code).maybeSingle();
    if (moveError) return fail(moveError.message);
    if (!movement) return { error: `No movement has the reference ${code}. Copy it from History.` };
    movementId = movement.id;
  }
  const { error } = await db.rpc("inv_resolve_note_difference", { p_note_id: d.noteId, p_resolution: d.resolution, p_comment: d.comment, p_linked_movement_id: movementId });
  if (error) return fail(error.message);
  refresh(d.projectId);
  return ok();
}
