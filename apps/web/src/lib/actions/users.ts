"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSysAdmin, ROLES } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "./companies";

const inviteUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1, "Name is required"),
});

/**
 * Provisioning a login is the one Phase 0 operation RLS genuinely can't
 * express — there's no row to attach a policy to until the auth user
 * exists. This is the only Server Action in the codebase that touches
 * lib/supabase/admin.ts; the `profiles` row that follows is created
 * automatically by the `handle_new_auth_user` trigger, not by this code.
 */
export async function inviteUser(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getCurrentSession();
  if (!session || !isSysAdmin(session.grants)) {
    return { error: "Only a Sys Admin can invite users." };
  }

  const parsed = inviteUserSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const admin = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
    data: { full_name: parsed.data.fullName },
    // Without this, Supabase falls back to the project's dashboard "Site
    // URL" for the invite email's redirect target. /set-password is a
    // public route (see proxy.ts) built to receive it and turn the
    // one-time invite token into a real password — see
    // set-password-form.tsx for why that page parses the token itself
    // instead of using the Supabase browser client's automatic detection.
    ...(siteUrl ? { redirectTo: `${siteUrl.replace(/\/$/, "")}/set-password` } : {}),
  });

  if (error) {
    return {
      error: error.message.includes("already been registered")
        ? `${parsed.data.email} already has an account — use "Resend invite" next to their name below instead.`
        : error.message,
    };
  }

  revalidatePath("/admin/users");
  return { error: null };
}

const resendInviteSchema = z.object({ email: z.string().email() });

/**
 * Supabase has no direct "resend invite" call — inviteUserByEmail errors
 * once the auth user already exists (exactly the case once someone's been
 * invited but hasn't finished setting a password). resetPasswordForEmail
 * sends the same kind of set-a-password email via the default "Reset
 * Password" template, and works regardless of whether the original invite
 * was ever completed — set-password-form.tsx handles either link the same
 * way, since both deliver the same access_token/refresh_token-in-URL-hash
 * shape.
 */
export async function resendInvite(email: string): Promise<{ error: string | null }> {
  const session = await getCurrentSession();
  if (!session || !isSysAdmin(session.grants)) {
    return { error: "Only a Sys Admin can resend invites." };
  }

  const parsed = resendInviteSchema.safeParse({ email });
  if (!parsed.success) {
    return { error: "Invalid email." };
  }

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    ...(siteUrl ? { redirectTo: `${siteUrl.replace(/\/$/, "")}/set-password` } : {}),
  });

  return { error: error?.message ?? null };
}

const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
  companyId: z.string().uuid().optional().or(z.literal("")),
});

/**
 * Uses the normal user-scoped client — `user_roles_write_sysadmin` already
 * lets a Sys Admin do exactly this, so RLS is the enforcement, same
 * reasoning as lib/actions/companies.ts.
 */
export async function assignRole(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = assignRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
    companyId: formData.get("companyId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_roles").insert({
    user_id: parsed.data.userId,
    role: parsed.data.role,
    company_id: parsed.data.companyId || null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/users");
  return { error: null };
}

export async function revokeRole(roleGrantId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("user_roles").update({ revoked_at: new Date().toISOString() }).eq("id", roleGrantId);
  revalidatePath("/admin/users");
}
