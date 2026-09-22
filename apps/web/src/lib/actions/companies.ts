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
