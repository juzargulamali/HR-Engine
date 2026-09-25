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
 *
 * Returns a raw Supabase error only via `rawError` (server-side use, e.g.
 * console.error, or the compensation logic in reactivateAccount below) —
 * `error` is always a fixed, safe string, never the Admin API's own message
 * text, which can vary by version and isn't meant for an end user.
 */
async function setBan(userId: string, banned: boolean): Promise<{ error: string | null; rawError: string | null }> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: banned ? "876600h" : "none",
  });
  if (!error) return { error: null, rawError: null };
  return {
    error: banned ? "Couldn't block this account from signing in. Try again." : "Couldn't lift the sign-in block. Try again.",
    rawError: error.message,
  };
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
    console.error("deactivateAccount: ban failed", { userId: parsed.data.userId, cause: banResult.rawError });
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
    // admin knows the DB record didn't update and can retry. This message
    // IS safe to show as-is: it's our own set_account_status() guard text
    // (e.g. "A reason is required", "last active System Administrator"),
    // never raw Admin API/Postgres internals.
    return { error: `Account is now blocked from signing in, but recording the reason failed: ${error.message}` };
  }

  revalidatePath("/admin/users");
  return { error: null };
}

/**
 * Reactivation must never report success unless BOTH the profile and the
 * actual sign-in block agree the account is active again. If lifting the
 * ban fails after the profile already flipped to 'active', this attempts a
 * compensating write back to 'deactivated' so the display never lies about
 * an account that's still, in reality, blocked — see the three failure
 * branches below, each covered by account-status.test.ts.
 */
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

  // (a) Profile update fails — nothing else attempted, account stays
  // exactly as it was (still 'deactivated', still banned). Safe: no partial
  // state to compensate for.
  const { error: activateError } = await supabase.rpc("set_account_status", {
    p_user_id: parsed.data.userId,
    p_new_status: "active",
    p_reason: parsed.data.reason,
  });
  if (activateError) {
    return { error: activateError.message };
  }

  const banResult = await setBan(parsed.data.userId, false);
  if (!banResult.error) {
    // Both steps succeeded — consistent, safe to report success.
    revalidatePath("/admin/users");
    return { error: null };
  }

  // (b)/(c) Unban failed after the profile already shows 'active'. Attempt a
  // compensating write back to 'deactivated' rather than leaving the
  // display wrong about whether this account can sign in.
  console.error("reactivateAccount: unban failed, attempting compensation", {
    userId: parsed.data.userId,
    cause: banResult.rawError,
  });
  const compensationReason =
    `System: automatic reactivation reverted after the sign-in block could not be lifted. ` +
    `Original admin-entered reason: ${parsed.data.reason}`.slice(0, 500);
  const { error: compensationError } = await supabase.rpc("set_account_status", {
    p_user_id: parsed.data.userId,
    p_new_status: "deactivated",
    p_reason: compensationReason,
  });

  revalidatePath("/admin/users");

  if (!compensationError) {
    // (b) Compensation succeeded — consistent again (still deactivated,
    // still banned), reported as a failure, never as success.
    return { error: "Reactivation could not be completed; account access remains suspended." };
  }

  // (c) Compensation ALSO failed — profile may now say 'active' while the
  // account is still banned (or some other inconsistent combination).
  // Best-effort flag for a human to resolve; never let a logging failure
  // here hide the manual-reconciliation message itself.
  console.error("reactivateAccount: compensation also failed — manual reconciliation required", {
    userId: parsed.data.userId,
    cause: compensationError.message,
  });
  try {
    await supabase.rpc("log_security_event", {
      p_action: "account_reconciliation_required",
      p_target_user_id: parsed.data.userId,
    });
  } catch {
    // intentionally ignored — the returned error already tells the admin
    // to act, independent of whether this best-effort log succeeded.
  }
  return {
    error:
      "Manual reconciliation required: this account's sign-in status may not match what's displayed. " +
      "Contact another System Administrator immediately.",
  };
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

export interface ReconciliationResult {
  consistent: boolean;
  detail: string;
  error: string | null;
}

/**
 * On-demand, single-account, read-only check that `profiles.account_status`
 * and the real sign-in block (auth.users.banned_until, via the Admin API)
 * agree with each other — exactly the class of drift the reactivation
 * partial-failure paths above try to prevent, but this is the tool for
 * confirming (or catching) it after the fact, for one account a System
 * Administrator is specifically looking at.
 *
 * Deliberately NOT a scan-every-account job: that would be a much bigger,
 * riskier surface (a background job with service-role access iterating the
 * whole user base) for a problem this feature already tries hard to avoid
 * causing in the first place. This is the smallest safe tool that lets an
 * admin verify one account when they have a reason to suspect drift (e.g.
 * after seeing a "manual reconciliation required" or "could not be
 * completed" message).
 *
 * Never returns banned_until itself, or any other raw auth object field —
 * only a boolean and a fixed, safe description.
 */
export async function checkAccountStatusConsistency(userId: string): Promise<ReconciliationResult> {
  const session = await getCurrentSession();
  if (!session || !canManageAccountStatus(session.grants)) {
    return { consistent: false, detail: "", error: "Only a System Administrator can run this check." };
  }

  const parsed = targetUserSchema.safeParse({ userId });
  if (!parsed.success) {
    return { consistent: false, detail: "", error: "Invalid account." };
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("account_status")
    .eq("id", parsed.data.userId)
    .maybeSingle();
  if (!profile) {
    return { consistent: false, detail: "", error: "Account not found." };
  }

  const admin = createAdminClient();
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(parsed.data.userId);
  if (authError || !authUser?.user) {
    return { consistent: false, detail: "", error: "Couldn't look up this account's sign-in status. Try again." };
  }

  const bannedUntil = authUser.user.banned_until;
  const isBanned = !!bannedUntil && new Date(bannedUntil).getTime() > Date.now();
  const showsDeactivated = profile.account_status === "deactivated";

  if (showsDeactivated === isBanned) {
    return {
      consistent: true,
      detail: showsDeactivated
        ? "Consistent: shown as Deactivated, and sign-in is currently blocked."
        : "Consistent: shown as Active/Invited, and sign-in is not blocked.",
      error: null,
    };
  }

  return {
    consistent: false,
    detail: showsDeactivated
      ? "Inconsistent: shown as Deactivated, but sign-in is NOT currently blocked. This account can still log in."
      : "Inconsistent: shown as Active/Invited, but sign-in IS currently blocked. This account cannot log in.",
    error: null,
  };
}
