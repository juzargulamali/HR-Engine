"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/actions/companies";
import { createAdminClient } from "@/lib/supabase/admin";
import { opsTvRpc } from "@/lib/operations-tv/rpc";
import {
  DEFAULT_OFFICE_TZ, DISPLAY_BAN_DURATION, DISPLAY_LABEL_MAX, displayFullName, friendlyDisplayError, generateDisplayPassword, isValidEmail, isValidTimeZone, normaliseEmail,
} from "@/lib/operations-tv/accounts";

/** What the page needs back from creating a display. The password is returned ONCE, in this one answer, and is stored nowhere (not in the database, not in a log). */
export interface CreateDisplayState extends ActionState { created?: { email: string; password: string; label: string } }

const createSchema = z.object({
  companyId: z.string().uuid(),
  label: z.string().trim().min(1, "Name the display, for example “Office TV”.").max(DISPLAY_LABEL_MAX, `Keep the name to ${DISPLAY_LABEL_MAX} characters.`),
  email: z.string().transform(normaliseEmail).refine(isValidEmail, "Enter a valid e-mail address for the display to sign in with."),
  officeTz: z.string().trim().default(DEFAULT_OFFICE_TZ).refine(isValidTimeZone, "Pick a valid office time zone."),
});

/**
 * Sets up one office board display: the sign-in account the TV uses, registered for ONE company.
 *  1. The caller's own session asks the database for this company's displays. That function refuses anyone who is not the company's Operations Manager (or a founder), so nothing is created for anyone else.
 *  2. The service role creates the account with `app_metadata.ops_tv = true` (only the service role can write app metadata, so a person cannot give it to themselves) and no employee record or role.
 *  3. The caller's session registers it for the company. If that fails, the account is deleted again: no orphan sign-in is ever left behind.
 */
export async function createDisplayAccount(_prev: CreateDisplayState, formData: FormData): Promise<CreateDisplayState> {
  const parsed = createSchema.safeParse({ companyId: formData.get("companyId"), label: formData.get("label"), email: formData.get("email") ?? "", officeTz: String(formData.get("officeTz") || DEFAULT_OFFICE_TZ) });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const { companyId, label, email, officeTz } = parsed.data;

  const guard = await opsTvRpc("ops_tv_list_displays", { p_company_id: companyId });
  if (guard.error) return { error: friendlyDisplayError(guard.error, "Couldn’t check your access to the office board. Try again.") };

  const password = generateDisplayPassword();
  const admin = createAdminClient();
  const made = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { ops_tv: true },
    user_metadata: { full_name: displayFullName(label) },
  });
  const userId = made.data?.user?.id;
  if (made.error || !userId) return { error: friendlyDisplayError(made.error ?? undefined, "Couldn’t create the display’s sign-in. Nothing was set up. Try again.") };

  const reg = await opsTvRpc("ops_tv_register_display", { p_user_id: userId, p_company_id: companyId, p_label: label, p_office_tz: officeTz });
  if (reg.error) {
    console.error("[operations-tv] registering display failed", reg.error.message);
    let cleanup = true;
    try { const del = await admin.auth.admin.deleteUser(userId); cleanup = !del.error; } catch { cleanup = false; }
    return { error: friendlyDisplayError(reg.error, "Couldn’t register the display. Nothing was set up. Try again."), warning: cleanup ? null : "The sign-in account was created but could not be removed again. Remove it in the Supabase dashboard (Authentication, Users) before retrying with the same e-mail." };
  }
  revalidatePath("/operations/office-board");
  return { error: null, created: { email, password, label } };
}

const revokeSchema = z.object({ displayId: z.string().uuid(), userId: z.string().uuid() });

/**
 * Revokes a display. The database record is revoked FIRST (every board read checks it, so the very next refresh is refused and the board clears), then the sign-in is blocked at the Auth service. If only the second
 * step fails the display is already revoked and the answer says so; pressing Revoke again is safe and retries the block. Sessions the display already holds cannot be ended by id from here; the database check ends
 * their access to the board at once, and the block stops any new sign-in and any token refresh.
 */
export async function revokeDisplayAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = revokeSchema.safeParse({ displayId: formData.get("displayId"), userId: formData.get("userId") });
  if (!parsed.success) return { error: "That display could not be identified. Reload the page and try again." };
  const { displayId, userId } = parsed.data;

  const res = await opsTvRpc("ops_tv_revoke_display", { p_display_id: displayId });
  // A display that is already revoked (the retry of a failed block) is not an error: the block below is what is being retried.
  if (res.error && !/already revoked/i.test(res.error.message ?? "")) return { error: friendlyDisplayError(res.error, "Couldn’t revoke the display. Try again.") };

  let blocked = true;
  try { const ban = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: DISPLAY_BAN_DURATION }); blocked = !ban.error; } catch { blocked = false; }
  revalidatePath("/operations/office-board");
  return blocked ? { error: null } : { error: null, warning: "The display is revoked and its board will clear on the next refresh, but its sign-in could not be blocked. Press Revoke again to retry the block, or block the user in the Supabase dashboard." };
}
