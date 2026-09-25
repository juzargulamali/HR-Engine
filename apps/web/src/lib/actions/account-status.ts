"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageAccountStatus } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const setAccountStatusSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required.").max(500),
});

/**
 * Deactivate: bans via the Admin API FIRST, then records it in `profiles`
 * (set_account_status() RPC) — a partial failure here leaves the account
 * banned but still displayed as Active, never the reverse. Reactivate does
 * the two steps in the opposite order for the same reason (see the
 * migration's design note): a partial failure there leaves the account
 * still banned even though it displays as Active again, so it never ends up
 * MORE accessible than intended. `ban_duration` values follow Supabase's Go
 * duration syntax (accepted units: ns/us/ms/s/m/h) — "876600h" is ~100
 * years, "none" lifts a ban immediately.
 */
async function setBan(userId: string, banned: boolean): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banned ? "876600h" : "none",
  });
  return { error: error?.message ?? null };
}

export async function deactivateAccount(userId: string, reason: string): Promise<{ error: string | null }> {
  const session = await getCurrentSession();
  if (!session || !canManageAccountStatus(session.grants)) {
    return { error: "Only a System Administrator can deactivate an account." };
  }

  const parsed = setAccountStatusSchema.safeParse({ userId, reason });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const banResult = await setBan(parsed.data.userId, true);
  if (banResult.error) {
    return { error: banResult.error };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_account_status", {
    p_user_id: parsed.data.userId,
    p_new_status: "deactivated",
    p_reason: parsed.data.reason,
  });
  if (error) {
    // The ban already took effect (fail-safe direction) — surfaced so the
    // admin knows the DB record didn't update and can retry.
    return { error: `Account is now blocked from signing in, but recording the reason failed: ${error.message}` };
  }

  revalidatePath("/admin/users");
  return { error: null };
}

export async function reactivateAccount(userId: string, reason: string): Promise<{ error: string | null }> {
  const session = await getCurrentSession();
  if (!session || !canManageAccountStatus(session.grants)) {
    return { error: "Only a System Administrator can reactivate an account." };
  }

  const parsed = setAccountStatusSchema.safeParse({ userId, reason });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_account_status", {
    p_user_id: parsed.data.userId,
    p_new_status: "active",
    p_reason: parsed.data.reason,
  });
  if (error) {
    return { error: error.message };
  }

  const banResult = await setBan(parsed.data.userId, false);
  if (banResult.error) {
    return { error: `Marked Active, but lifting the sign-in block failed: ${banResult.error}. Try again.` };
  }

  revalidatePath("/admin/users");
  return { error: null };
}

const targetUserSchema = z.object({ userId: z.string().uuid() });

/**
 * "Admin sends a password reset email" for an already-active user —
 * resetPasswordForEmail() is the same supported call resendInvite() already
 * uses; the only difference is the audit label and where the button lives.
 * The admin's own client is never trusted with the target's email — it's
 * re-read from `profiles` server-side.
 */
export async function adminSendPasswordReset(userId: string): Promise<{ error: string | null }> {
  const session = await getCurrentSession();
  if (!session || !canManageAccountStatus(session.grants)) {
    return { error: "Only a System Administrator can send a password reset." };
  }

  const parsed = targetUserSchema.safeParse({ userId });
  if (!parsed.success) {
    return { error: "Invalid account." };
  }

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("email").eq("id", parsed.data.userId).maybeSingle();
  if (!profile) {
    return { error: "Account not found." };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
    ...(siteUrl ? { redirectTo: `${siteUrl.replace(/\/$/, "")}/reset-password` } : {}),
  });
  if (error) {
    return { error: error.message };
  }

  await supabase.rpc("log_security_event", { p_action: "password_reset_sent_by_admin", p_target_user_id: parsed.data.userId });
  return { error: null };
}
