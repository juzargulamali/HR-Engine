import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/actions/companies";
import { isNotInstalled } from "@/lib/projects/errors";

/** Shared by every Inventory server action: form parsing helpers, plain-English failures, revalidation. */
export type InvActionState = ActionState & { id?: string; code?: string; replayed?: boolean; detail?: Record<string, unknown> };

export const uuid = z.string().uuid();
export const optionalText = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().optional());
export const optionalUuid = z.preprocess((v) => (v === "" || v == null ? undefined : v), uuid.optional());
export const optionalLocal = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, "Use a valid date and time").optional());
export const qtyField = z.coerce.number({ message: "Enter a quantity" }).positive("The quantity must be more than zero").max(1_000_000_000);
export const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
export const movementKey = z.string().regex(/^[A-Za-z0-9._:-]{8,120}$/, "This form expired. Reload the page and try again.");

export function friendlyInventoryError(message: string): string {
  if (/TimeoutError|AbortError|aborted due to timeout|signal timed out/i.test(message)) {
    return "The save did not finish in time. Use “Check whether it went through” before trying again: the same entry cannot be recorded twice.";
  }
  if (/permission denied|row-level security/i.test(message)) return "You are not allowed to do that.";
  if (/violates check constraint|violates foreign key|invalid input syntax/i.test(message)) return "One of the values is not allowed. Check the form and try again.";
  if (/duplicate key/i.test(message)) return "That already exists.";
  if (/could not find the (table|function)|schema cache|does not exist/i.test(message)) return "Inventory is not installed in this environment yet.";
  return message;
}

export const fail = (message: string): InvActionState => ({ error: friendlyInventoryError(message) });
export const ok = (extra: Partial<InvActionState> = {}): InvActionState => ({ error: null, ...extra });
export const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form and try again.";

export { isUncertain } from "./uncertain";
export { isNotInstalled };

/** Everything that shows Inventory data is re-read after a change (also the pages of the other modules that embed Inventory). */
export function refreshInventory(extraPaths: string[] = []) {
  revalidatePath("/inventory", "layout");
  for (const p of extraPaths) revalidatePath(p);
}
