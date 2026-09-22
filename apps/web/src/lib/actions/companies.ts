"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const createCompanySchema = z.object({
  legalName: z.string().min(1, "Legal name is required"),
  countryCode: z.string().length(2, "Pick a country"),
  defaultCurrency: z.string().length(3, "3-letter currency code, e.g. AED"),
});

export interface ActionState {
  error: string | null;
}

/**
 * Uses the normal user-scoped client, not the admin client — creating a
 * company is fully expressible through RLS (`companies_write` requires
 * sys_admin, see supabase/migrations/20260922000000_phase0_foundations.sql),
 * so there's no reason to bypass it. Reach for lib/supabase/admin.ts only
 * when RLS genuinely can't express the operation (see lib/actions/users.ts).
 */
export async function createCompany(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createCompanySchema.safeParse({
    legalName: formData.get("legalName"),
    countryCode: formData.get("countryCode"),
    defaultCurrency: formData.get("defaultCurrency"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("companies").insert({
    legal_name: parsed.data.legalName,
    country_code: parsed.data.countryCode,
    default_currency: parsed.data.defaultCurrency.toUpperCase(),
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/companies");
  return { error: null };
}

/**
 * companies_write (Sys Admin only) already covers this — is_active exists
 * on the table but nothing in the app actually reads it (not even
 * companies_select, which filters on deleted_at); flipping it would be
 * purely cosmetic. deleted_at is the column RLS genuinely enforces, same
 * soft-delete pattern as employees, so that's what "deactivate" uses here.
 */
export async function softDeleteCompany(companyId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("companies")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
    .eq("id", companyId);
  revalidatePath("/admin/companies");
  return { error: error?.message ?? null };
}

export async function restoreCompany(companyId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("companies").update({ deleted_at: null, deleted_by: null }).eq("id", companyId);
  revalidatePath("/admin/companies");
  return { error: error?.message ?? null };
}
