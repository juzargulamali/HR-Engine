import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions/companies";
import type { createClient } from "@/lib/supabase/server";
import { friendlyProjectError } from "./errors";

/** Shared by every Projects server action: form parsing helpers, plain-English failures and revalidation. */
export type ProjectActionState = ActionState & { id?: string };

export const uuid = z.string().uuid();
export const optionalText = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().optional());
export const optionalUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());
export const optionalDate = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional());
export const optionalLocal = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, "Use a valid date and time").optional());
export const optionalInt = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().min(0).max(1440).optional());
export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const fail = (message: string): ProjectActionState => ({ error: friendlyProjectError(message) });
export const ok = (id?: string): ProjectActionState => ({ error: null, ...(id ? { id } : {}) });
export const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input.";

/** Revalidates the Projects pages (every one of them reads through RLS, so a change can affect several). */
export function refreshProjects(projectId?: string) {
  revalidatePath("/projects", "layout");
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
}

/** Drops undefined values so a missing form field is "leave alone" and an explicit empty one (null) is "clear". */
export function patchOf(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined));
}

/** A text field that is present in the form but empty means "clear it" (null); an absent field means "leave it alone". */
export function textPatch(fd: FormData, key: string): string | null | undefined {
  if (!fd.has(key)) return undefined;
  const v = String(fd.get(key) ?? "").trim();
  return v === "" ? null : v;
}

const VERSIONED = { project: "proj_projects", task: "proj_tasks", milestone: "proj_milestones", deliverable: "proj_deliverables", plan_item: "proj_plan_items", booking: "proj_site_bookings", dependency: "proj_external_dependencies" } as const;
export type VersionedKind = keyof typeof VERSIONED;
const STALE: Record<VersionedKind, string> = {
  project: "This project was changed by someone else.", task: "This task was changed by someone else.", milestone: "This milestone was changed by someone else.",
  deliverable: "This deliverable was changed by someone else.", plan_item: "This timeline item was changed by someone else.", booking: "This booking was changed by someone else.",
  dependency: "This dependency was changed by someone else.",
};

/**
 * Says at once when a record has moved on since the person loaded it. The database function still makes the real check and refuses, but
 * a refusal there can be slow to come back (see RPC_TIMEOUT_MS in lib/supabase/server.ts), so the ordinary case is answered here, in
 * words, before anything is sent. Null means "no objection": no version was sent, the row is not visible, or the versions agree.
 */
export async function staleMessage(supabase: Awaited<ReturnType<typeof createClient>>, kind: VersionedKind, id: string | null | undefined, expected: number | null | undefined): Promise<string | null> {
  if (!id || expected == null || !Number.isFinite(expected)) return null;
  const { data } = await supabase.from(VERSIONED[kind]).select("version").eq("id", id).maybeSingle();
  return data && data.version !== expected ? `${STALE[kind]} Reload the page to see the latest version, then make your change again.` : null;
}
