"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROLES } from "@enginious-hr/domain";
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
    // Read as `{{ .RedirectTo }}` by the project's "Invite user" email
    // template (Supabase Dashboard -> Authentication -> Emails) — that
    // template must link to /auth/confirm?token_hash={{ .TokenHash
    // }}&type=invite&next={{ .RedirectTo }}, not the default {{
    // .ConfirmationURL }}. The default sends a ready-made access_token in
    // the URL hash, which @supabase/ssr's browser client (hardcoded to
    // flowType: "pkce") explicitly rejects as "Not a valid PKCE flow url" —
    // see apps/web/src/app/auth/confirm/route.ts for the exchange this
    // relies on instead.
    ...(siteUrl ? { redirectTo: `${siteUrl.replace(/\/$/, "")}/set-password` } : {}),
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/users");
  return { error: null };
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
