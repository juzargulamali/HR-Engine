import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions/companies";
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
