"use server";

import { z } from "zod";
import { getPasswordIssues } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface ForgotPasswordState {
  submitted: boolean;
  error: string | null;
}

const forgotPasswordSchema = z.object({ email: z.string().email() });

/**
 * Always returns the same neutral outcome regardless of whether the email
 * belongs to an account — Supabase's resetPasswordForEmail() already never
 * reveals that itself (it succeeds either way), so the only leak risk here
 * would be this action treating "invalid email" or a lookup miss
 * differently. It doesn't: any input that isn't even a well-formed email
 * still reports `submitted: true`. The one exception is Supabase's own
 * rate-limit response, which is safe to surface — it says nothing about
 * whether the account exists, just that too many requests came from
 * whoever's asking.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  const email = parsed.success ? parsed.data.email : null;

  if (email) {
    const supabase = await createClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      ...(siteUrl ? { redirectTo: `${siteUrl.replace(/\/$/, "")}/reset-password` } : {}),
    });

    if (error?.status === 429 || error?.message?.toLowerCase().includes("rate limit")) {
      return { submitted: false, error: "Too many requests — wait a few minutes and try again." };
    }

    // Best-effort audit trail; never lets a logging failure block the
    // neutral response the visitor sees.
    try {
      await supabase.rpc("log_security_event", { p_action: "password_reset_requested", p_email: email });
    } catch {
      // intentionally ignored
    }
  }

  return { submitted: true, error: null };
}

export interface ChangePasswordState {
  success: boolean;
  error: string | null;
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string(),
  confirmPassword: z.string(),
});

/**
 * Supabase has no standalone "verify this password without starting a new
 * session" call — signInWithPassword() against the signed-in user's own
 * email IS the supported way to confirm they still know their current
 * password before accepting a new one (it just re-establishes the same
 * session, nothing changes hands). Requirement 2's "unless Supabase's
 * secure reauthentication flow requires another supported method" doesn't
 * apply here: reauthentication (supabase.auth.reauthenticate()) is Supabase's
 * mechanism for MFA-protected accounts, which this project doesn't use, so
 * password confirmation is the applicable path.
 */
export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await getCurrentSession();
  if (!session?.email) {
    return { success: false, error: "You must be signed in." };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    return { success: false, error: "New passwords don't match." };
  }
  const issues = getPasswordIssues(newPassword);
  if (issues.length > 0) {
    return { success: false, error: issues[0] ?? "Password doesn't meet the requirements." };
  }
  if (newPassword === currentPassword) {
    return { success: false, error: "Choose a password different from your current one." };
  }

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: session.email,
    password: currentPassword,
  });
  if (verifyError) {
    return { success: false, error: "Current password is incorrect." };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return { success: false, error: updateError.message };
  }

  // "Where supported" — signs out every OTHER session, leaving this one
  // (which just proved it holds the new password) signed in.
  await supabase.auth.signOut({ scope: "others" });
  await supabase.rpc("log_security_event", { p_action: "password_changed" });

  return { success: true, error: null };
}
