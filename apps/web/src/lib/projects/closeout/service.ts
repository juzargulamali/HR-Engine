import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readJarvisConfig } from "@/lib/jarvis/config";
import { gateProvider } from "@/lib/jarvis/outbound";
import { JarvisProviderError, selectProvider, type JarvisProvider } from "@/lib/jarvis/provider";
import { JarvisRefusalError } from "@/lib/jarvis/types";
import { isNotInstalled } from "@/lib/projects/errors";
import { buildOutbound, evidenceItems, payloadHash, type CloseoutSelection, type EvidenceSnapshot } from "./evidence";
import { CLOSEOUT_GUARD, CLOSEOUT_INSTRUCTIONS, CLOSEOUT_SCHEMA, CLOSEOUT_TASK, factsOnlyDraft, toSourceRefs, validateDraft, type ReportSection, type SourceRef } from "./report";

/**
 * The Project Closeout Report, server side. Three parts with separate responsibilities:
 *   1. EVIDENCE COLLECTOR: the database function proj_closeout_evidence, called with the signed-in person's own session. It checks that they manage the project and reads
 *      only allowlisted columns. This file never reads a project table itself.
 *   2. REPORT WRITER: the AI provider behind the common outbound gate, under the rule "projects.closeout.draft". It receives ONE request holding only the evidence lines the
 *      Project Manager reviewed. It has no database access and no way to act: it returns an object, and only the report's own fields are read from it.
 *   3. VALIDATION and the Project Manager's review: validateDraft checks references and facts; the draft is stored as a draft. Approving it is a separate, explicit step.
 * Generating a draft writes one row in proj_closeout_reports and nothing else. It never completes a project, approves work, sends a message or changes stock.
 */
export const CLOSEOUT_RULE = "projects.closeout.draft";
export const CLOSEOUT_MAX_OUTPUT_TOKENS = 4000;
export const CLOSEOUT_TIMEOUT_MS = 55_000;

export interface CloseoutReportRow {
  id: string; project_id: string; version_no: number; status: "draft" | "approved"; snapshot: EvidenceSnapshot; snapshot_at: string; selection: CloseoutSelection;
  payload_hash: string; generation: "none" | "generated"; provider_kind: string | null; sections: ReportSection[]; source_refs: SourceRef[];
  created_by: string; created_at: string; updated_at: string; approved_by: string | null; approved_at: string | null; version: number;
}

type Db = SupabaseClient;
export type EvidenceResult = { state: "ok"; snapshot: EvidenceSnapshot } | { state: "not_installed" } | { state: "denied" } | { state: "error" };

/** The evidence snapshot of one project, or why it is not available. A failed read is "error": it is never shown as an empty project. */
export async function loadEvidence(db: Db, projectId: string): Promise<EvidenceResult> {
  const { data, error } = await db.rpc("proj_closeout_evidence", { p_project_id: projectId });
  if (error) {
    if (isNotInstalled(error)) return { state: "not_installed" };
    if (error.code === "P0002" || error.code === "42501") return { state: "denied" };
    console.error("[projects] closeout evidence failed", error.message);
    return { state: "error" };
  }
  return data && typeof data === "object" && (data as { project?: unknown }).project ? { state: "ok", snapshot: data as EvidenceSnapshot } : { state: "error" };
}

/** The project's report versions the signed-in person may read (row-level security: managers only). `null` = the read failed. */
export async function loadReports(db: Db, projectId: string): Promise<CloseoutReportRow[] | null> {
  const { data, error } = await db.from("proj_closeout_reports").select("*").eq("project_id", projectId).order("version_no", { ascending: false });
  if (error) { if (!isNotInstalled(error)) console.error("[projects] closeout reports failed", error.message); return null; }
  return (data ?? []) as unknown as CloseoutReportRow[];
}

/** Whether a draft can be written with the AI provider here, and if not, why (in words for the Project Manager). */
export function providerAvailability(env: Record<string, string | undefined> = process.env): { available: boolean; kind: "anthropic" | "simulated" | "none"; note: string | null } {
  const c = readJarvisConfig(env);
  if (c.disabled) return { available: false, kind: "none", note: "The AI provider is switched off in this environment." };
  if (c.providerKind === "none") return { available: false, kind: "none", note: "The AI provider is not set up in this environment." };
  return { available: true, kind: c.providerKind, note: null };
}

export type GenerateResult =
  | { ok: true; reportId: string; reused: boolean; mode: "ai" | "facts"; withheld: number }
  | { ok: false; code: "not_loaded" | "denied" | "changed" | "unavailable" | "provider_failed" | "refused" | "unusable" | "save_failed"; message: string };

const PROVIDER_FAILURE: Record<string, string> = {
  timeout: "The AI provider did not answer in time. Nothing was saved. You can try again.",
  network: "The AI provider could not be reached. Nothing was saved. You can try again.",
  http: "The AI provider returned an error. Nothing was saved. You can try again.",
  malformed: "The AI provider's answer could not be used. Nothing was saved. You can try again.",
};

/**
 * Writes (or rewrites) the project's ONE draft.
 *   - The evidence is taken again here; `reviewedHash` is the fingerprint of what the Project Manager saw on "Review data to be sent". If the content that would be sent
 *     now differs, nothing is sent and they are asked to review again.
 *   - mode "ai": ONE bounded provider call. If the draft already holds a generated result for exactly this content, that draft is returned and nothing is sent again.
 *     A failure or a timeout saves nothing, so a retry cannot leave a second version or a half-written one.
 *   - mode "facts": no provider call at all; the draft is the evidence lines themselves.
 * `provider` is injectable for tests; by default it is the configured provider. It is ALWAYS wrapped by the outbound gate here.
 */
export async function generateCloseoutDraft(db: Db, input: { projectId: string; selection: CloseoutSelection; reviewedHash: string; mode: "ai" | "facts" }, deps: { provider?: JarvisProvider | null; env?: Record<string, string | undefined> } = {}): Promise<GenerateResult> {
  const ev = await loadEvidence(db, input.projectId);
  if (ev.state === "denied") return { ok: false, code: "denied", message: "Only the Project Manager, a temporary project leader or a founder can work on the closeout report." };
  if (ev.state !== "ok") return { ok: false, code: "not_loaded", message: "The project's records could not be loaded, so no report was written. Try again." };
  const snapshot = ev.snapshot;
  const out = buildOutbound(evidenceItems(snapshot), input.selection);
  const hash = payloadHash(out.text);
  if (hash !== input.reviewedHash) return { ok: false, code: "changed", message: "The project's records changed since you reviewed what would be sent. Review the data again." };

  let sections: ReportSection[]; let providerKind: string | null = null; let withheld = 0;
  if (input.mode === "ai") {
    const reports = await loadReports(db, input.projectId);
    if (reports === null) return { ok: false, code: "not_loaded", message: "The report could not be loaded, so nothing was sent. Try again." };
    const draft = reports.find((r) => r.status === "draft");
    if (draft && draft.generation === "generated" && draft.payload_hash === hash) return { ok: true, reportId: draft.id, reused: true, mode: "ai", withheld: 0 };
    let raw: JarvisProvider | null;
    if (deps.provider !== undefined) raw = deps.provider;
    else {
      const avail = providerAvailability(deps.env);
      if (!avail.available) return { ok: false, code: "unavailable", message: `${avail.note} You can still write a facts-only draft: nothing is sent for that.` };
      raw = selectProvider(readJarvisConfig(deps.env), deps.env);
    }
    const provider = gateProvider(raw, CLOSEOUT_RULE);
    if (!provider) return { ok: false, code: "unavailable", message: "The AI provider is not set up in this environment. You can still write a facts-only draft: nothing is sent for that." };
    let answer: unknown;
    try {
      answer = await provider.structured({
        sources: ["project_closeout_evidence"], task: CLOSEOUT_TASK, instructions: CLOSEOUT_INSTRUCTIONS, guard: CLOSEOUT_GUARD,
        input: "<request>\nWrite the internal closeout report from the evidence lines below.\n</request>", inputTag: null, recordText: out.text,
        jsonSchema: CLOSEOUT_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: CLOSEOUT_MAX_OUTPUT_TOKENS, timeoutMs: CLOSEOUT_TIMEOUT_MS,
      });
    } catch (e) {
      if (e instanceof JarvisProviderError) return { ok: false, code: "provider_failed", message: PROVIDER_FAILURE[e.kind] ?? PROVIDER_FAILURE.http! };
      if (e instanceof JarvisRefusalError) return { ok: false, code: "refused", message: `Nothing was sent: the content did not pass the data policy check. ${e.code === "protected_content" ? "Remove optional text that may hold private details and try again, or write a facts-only draft." : "You can write a facts-only draft instead."}` };
      console.error("[projects] closeout generation failed", e instanceof Error ? e.name : "unknown");
      return { ok: false, code: "provider_failed", message: PROVIDER_FAILURE.http! };
    }
    const checked = validateDraft(answer, out.sent, snapshot);
    if (!checked) return { ok: false, code: "unusable", message: PROVIDER_FAILURE.malformed! };
    sections = checked.sections; withheld = checked.withheld; providerKind = provider.kind;
  } else sections = factsOnlyDraft(out.sent);

  const { data, error } = await db.rpc("proj_closeout_save_draft", {
    p_project_id: input.projectId, p_snapshot: snapshot, p_selection: input.selection, p_payload_hash: hash, p_generation: input.mode === "ai" ? "generated" : "none",
    p_provider_kind: providerKind, p_sections: sections, p_source_refs: toSourceRefs(out.sent),
  });
  if (error) {
    if (error.code === "40001") return { ok: false, code: "changed", message: "The project's records changed while the report was being written, so it was not saved. Review the data again." };
    console.error("[projects] closeout save failed", error.message);
    return { ok: false, code: "save_failed", message: "The draft could not be saved. Try again." };
  }
  return { ok: true, reportId: (data as { id: string }).id, reused: false, mode: input.mode, withheld };
}
