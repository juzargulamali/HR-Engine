import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sends the invitation email for a new login (the Admin API; no row-level policy can express creating an auth user). The same call People & Access has always made (inviteUser), kept here as a
 * function so the guided onboarding can use it without duplicating the redirect rule. The CALLER decides who may invite (a System Administrator, with an unrestricted grant): this function checks nothing.
 * `alreadyRegistered` means an account with that address exists: nothing was sent, and the caller links the existing account instead of inviting twice.
 */
export async function sendInvitation(email: string, fullName: string): Promise<{ error: string | null; alreadyRegistered: boolean }> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const { error } = await createAdminClient().auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    ...(siteUrl ? { redirectTo: `${siteUrl.replace(/\/$/, "")}/set-password` } : {}),
  });
  if (!error) return { error: null, alreadyRegistered: false };
  if (error.message.includes("already been registered")) return { error: null, alreadyRegistered: true };
  return { error: error.message, alreadyRegistered: false };
}
