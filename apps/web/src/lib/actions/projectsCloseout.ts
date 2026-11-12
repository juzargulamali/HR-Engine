"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, refreshProjects, uuid, type ProjectActionState } from "@/lib/projects/action-utils";
import type { EvidenceSnapshot } from "@/lib/projects/closeout/evidence";
import { blockingFlags, reviewFlags, validateEdits, type ReportSection, type SourceRef } from "@/lib/projects/closeout/report";
import { generateCloseoutDraft } from "@/lib/projects/closeout/service";

/**
 * Project Closeout Report server actions (migration 20270101000100). The database functions decide who may do each of these (whoever manages the project). None of them
 * completes a project, approves work, sends a message or changes stock: they read the project's records and write the report's own row.
 */
type S = ProjectActionState & { notice?: string | null };
const json = (v: unknown): unknown => { try { return JSON.parse(String(v ?? "")); } catch { return null; } };

/** "Send to Anthropic and write the draft" and "Write a facts-only draft". The evidence is taken again on the server; the browser sends only what was selected. */
export async function generateCloseout(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ projectId: uuid, mode: z.enum(["ai", "facts"]), reviewedHash: z.string().min(16).max(128) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const include = z.array(z.string().max(120)).max(400).safeParse(json(fd.get("include")));
  if (!include.success) return { error: "The selection could not be read. Reload the page and try again." };
  const res = await generateCloseoutDraft(await createClient(), { projectId: p.data.projectId, selection: { include: include.data }, reviewedHash: p.data.reviewedHash, mode: p.data.mode });
  if (!res.ok) return { error: res.message };
  refreshProjects(p.data.projectId);
  return {
    error: null, id: res.reportId,
    notice: res.reused ? "This content was already sent and its draft is saved, so nothing was sent again."
      : res.mode === "facts" ? "A facts-only draft was written. Nothing was sent to the AI provider."
      : `The draft was written.${res.withheld > 0 ? ` ${res.withheld} paragraph${res.withheld === 1 ? " was" : "s were"} left out because of the data policy.` : ""} Check it, edit it, then approve it.`,
  };
}

async function loadDraft(reportId: string) {
  const db = await createClient();
  const { data, error } = await db.from("proj_closeout_reports").select("id, project_id, status, version, snapshot, source_refs, sections").eq("id", reportId).maybeSingle();
  return { db, row: data as null | { id: string; project_id: string; status: string; version: number; snapshot: EvidenceSnapshot; source_refs: SourceRef[]; sections: ReportSection[] }, failed: !!error };
}

export async function saveCloseoutEdits(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ reportId: uuid, expectedVersion: z.coerce.number().int() }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { db, row, failed } = await loadDraft(p.data.reportId);
  if (failed) return { error: "The report could not be loaded, so nothing was saved. Try again." };
  if (!row) return { error: "This report was not found. It may have been discarded." };
  const sections = validateEdits(json(fd.get("sections")), row.source_refs, row.snapshot, row.sections);
  if (!sections) return { error: "The report could not be read. Reload the page and try again." };
  const { error } = await db.rpc("proj_closeout_save_edits", { p_report_id: row.id, p_sections: sections, p_expected_version: p.data.expectedVersion });
  if (error) return fail(error.message);
  refreshProjects(row.project_id);
  const blocking = blockingFlags(sections).length;
  return { error: null, id: row.id, notice: blocking > 0 ? `Saved. ${blocking} statement${blocking === 1 ? "" : "s"} still contradict${blocking === 1 ? "s" : ""} the records and must be changed before approval.` : "Saved." };
}

/** The explicit step that makes a version. It is refused while a statement contradicts the records, and needs the Project Manager's tick when statements are marked to check. */
export async function approveCloseout(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ reportId: uuid, expectedVersion: z.coerce.number().int() }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { db, row, failed } = await loadDraft(p.data.reportId);
  if (failed) return { error: "The report could not be loaded, so it was not approved. Try again." };
  if (!row) return { error: "This report was not found. It may have been discarded." };
  if (row.status === "draft") {
    // Flags are recomputed from what is stored, so an old or edited browser copy cannot hide one.
    const current = validateEdits(row.sections, row.source_refs, row.snapshot, row.sections) ?? [];
    if (blockingFlags(current).length > 0) return { error: "Some statements contradict the project's records (they are marked in the draft). Change them, save, then approve." };
    if (reviewFlags(current).length > 0 && fd.get("checked") !== "on") return { error: "Some statements are marked to check. Tick the box to confirm you have checked them, then approve." };
  }
  const { error } = await db.rpc("proj_closeout_approve", { p_report_id: row.id, p_expected_version: p.data.expectedVersion });
  if (error) return fail(error.message);
  refreshProjects(row.project_id);
  return { error: null, id: row.id, notice: "Approved. This version is now fixed and can be downloaded. Nothing was sent to anyone." };
}

export async function discardCloseoutDraft(_prev: S, fd: FormData): Promise<S> {
  const p = z.object({ reportId: uuid, projectId: uuid }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await createClient()).rpc("proj_closeout_discard_draft", { p_report_id: p.data.reportId });
  if (error) return fail(error.message);
  refreshProjects(p.data.projectId);
  return { error: null, notice: "The draft was discarded. Approved versions are kept." };
}
