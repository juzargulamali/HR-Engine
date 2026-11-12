"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, firstIssue, ok, optionalText, refreshProjects, uuid, type ProjectActionState } from "@/lib/projects/action-utils";

/**
 * "Mark as reviewed" on a project's "Review equipment booking" panel (migration 20270102000100). A thin wrapper over proj_resolve_equipment_review: the function, not this
 * file, decides who may do it (whoever manages the project, or the warehouse of its company). It records that someone looked; it changes no reservation and no request date.
 * Changing the booking stays the warehouse's work on the request itself, where conflicts are checked.
 */
export async function resolveEquipmentReview(_prev: ProjectActionState, fd: FormData): Promise<ProjectActionState> {
  const p = z.object({ reviewId: uuid, projectId: uuid, note: optionalText.pipe(z.string().max(500, "Keep the note under 500 characters").optional()) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: firstIssue(p.error) };
  const { error } = await (await createClient()).rpc("proj_resolve_equipment_review", { p_review_id: p.data.reviewId, p_note: p.data.note ?? null });
  if (error) return fail(error.code === "P0002" ? "This review was not found, or you are not allowed to mark it. The Project Manager or the warehouse can." : error.message);
  refreshProjects(p.data.projectId);
  revalidatePath("/operations", "layout");
  return ok(p.data.reviewId);
}
