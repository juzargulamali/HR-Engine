"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface QueueActionResult { error: string | null }

const schema = z.object({
  kind: z.enum(["contract_end", "probation", "employee_document", "identity_document", "attendance", "recovery_alert"]),
  sourceId: z.string().uuid(),
  sourceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Reload the page and try again."),
  employeeId: z.string().uuid().optional(),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});

/**
 * HR Admin marks one queue item as seen. This records that it was seen and nothing else: the issue is not resolved by it, and the queue keeps listing the item (as Acknowledged, with the same
 * link) for as long as the source record says it is still open. A Recovery Leave alert keeps its own existing acknowledgement; every other kind goes through
 * `acknowledge_hr_queue_item`, which reads the company and the employee from the source record and checks HR Admin of that company itself.
 */
export async function acknowledgeQueueItem(input: z.input<typeof schema>): Promise<QueueActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const session = await getCurrentSession();
  if (!session) return { error: "Sign in to continue." };
  const { kind, sourceId, sourceDate, employeeId, note } = parsed.data;
  const supabase = await createClient();
  const { error } = kind === "recovery_alert"
    ? await supabase.rpc("acknowledge_recovery_alert", { p_alert_id: sourceId, p_note: note || null })
    : await supabase.rpc("acknowledge_hr_queue_item", { p_kind: kind, p_source_id: sourceId, p_source_date: sourceDate, p_note: note || null });
  revalidatePath("/alerts");
  revalidatePath("/");
  if (employeeId) revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}
