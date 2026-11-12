"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Dismisses one "Handover accepted" notice for the signed-in person. It reuses the existing way a person marks their own project notices as read
 * (proj_mark_notifications_read): the database changes only rows that belong to the caller, so an id that is someone else's notice changes nothing and is
 * reported as not dismissed. Nothing on the handover, the project or anyone else's notice is written.
 */
export async function dismissHandoverNotice(noticeId: string): Promise<{ ok: boolean }> {
  const id = z.string().uuid().safeParse(noticeId);
  if (!id.success) return { ok: false };
  const { data, error } = await (await createClient()).rpc("proj_mark_notifications_read", { p_ids: [id.data] });
  if (error) { console.error("[crm] dismiss handover notice failed", error.message); return { ok: false }; }
  revalidatePath("/sales", "layout");
  revalidatePath("/");
  // 0 rows: already read (dismissed on another device) or not this person's notice. Either way there is nothing left to dismiss for them; the refreshed list decides what shows.
  return { ok: typeof data === "number" };
}
