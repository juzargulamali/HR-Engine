"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fileExtension, inspectCrmFileBytes } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const createCompanySchema = z.object({
  legalName: z.string().min(1, "Legal name is required"),
  countryCode: z.string().length(2, "Pick a country"),
  defaultCurrency: z.string().length(3, "3-letter currency code, e.g. AED"),
});

export interface ActionState {
  error: string | null;
  /**
   * Non-blocking, HR-facing follow-up (e.g. updateEmployee()'s Poland
   * termination true-up couldn't be posted automatically) — the action
   * itself still succeeded (error is null), but something needs manual
   * review. Optional and absent/undefined on every action that has no such
   * follow-up to report, so this is backward compatible with every existing
   * ActionState-returning action.
   */
  warning?: string | null;
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

// ---- Issuer details (the company's own profile; quotations read these, nothing is hard-coded) --------------------------------------------

const issuerSchema = z.object({
  companyId: z.string().uuid(),
  legalName: z.string().trim().min(1, "Legal name is required").max(200),
  trn: z.string().trim().max(40, "The TRN can be at most 40 characters"),
  address: z.string().trim().max(500, "The address is too long"),
  phone: z.string().trim().max(60, "The phone number is too long"),
  email: z.string().trim().max(200, "The email is too long").refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "That email address does not look right"),
  website: z.string().trim().max(300, "The website is too long"),
});

/** Legal name, TRN, address, phone, email and website of the issuing company. System Administrator only: `companies_write` refuses anyone else, and so does this check on the rows changed. */
export async function updateCompanyIssuerDetails(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = issuerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  // The issuer columns are not in the generated database types.
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data, error } = await supabase
    .from("companies")
    .update({ legal_name: d.legalName, trn: d.trn || null, address: d.address || null, phone: d.phone || null, email: d.email || null, website: d.website || null })
    .eq("id", d.companyId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a System Administrator can change company details." };
  revalidatePath("/admin/companies");
  return { error: null };
}

/** Under the 1 MB request limit of server actions. */
const LOGO_MAX_BYTES = 900 * 1024;
const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Uploads the company logo (PNG, JPEG or WebP): checked here (type, size, real leading bytes), stored privately under a NEW path (an issued quotation keeps pointing at the logo it was issued with), then recorded by `crm_set_company_logo`, which only a System Administrator may call. */
export async function uploadCompanyLogo(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const companyId = z.string().uuid().safeParse(formData.get("companyId"));
  const file = formData.get("logo");
  if (!companyId.success) return { error: "Missing company." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image file." };
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { error: "The logo must be a PNG, JPEG or WebP image." };
  if (file.size > LOGO_MAX_BYTES) return { error: "The logo must be smaller than 900 KB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bad = inspectCrmFileBytes(bytes, fileExtension(`x.${ext === "jpg" ? "jpg" : ext}`));
  if (bad) return { error: bad };
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: admin } = await supabase.rpc("has_role", { p_role: "sys_admin" });
  if (admin !== true) return { error: "Only a System Administrator can change company details." };
  const path = `${companyId.data}/${crypto.randomUUID()}-logo.${ext}`;
  const storage = createAdminClient().storage.from("company-logos");
  const { error: upErr } = await storage.upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) return { error: "The logo could not be stored. Try again." };
  const { error } = await supabase.rpc("crm_set_company_logo", { p_company: companyId.data, p_path: path });
  if (error) { await storage.remove([path]); return { error: error.message }; }
  revalidatePath("/admin/companies");
  return { error: null };
}
