"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";

const createAssetSchema = z.object({
  companyId: z.string().uuid(),
  assetTag: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  purchaseDate: z.string().optional(),
  value: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().nonnegative().optional()),
});

/** Adds a new item to the company's inventory — assets_write is HR Admin only. */
export async function createAsset(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createAssetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("assets").insert({
    company_id: d.companyId,
    asset_tag: d.assetTag,
    category: d.category,
    description: d.description || null,
    purchase_date: d.purchaseDate || null,
    value: d.value ?? null,
  });

  if (error) {
    return {
      error: error.message.includes("duplicate key") ? `Asset tag "${d.assetTag}" is already in use.` : error.message,
    };
  }

  revalidatePath("/assets");
  return { error: null };
}

export async function retireAsset(assetId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("assets").update({ status: "retired" }).eq("id", assetId);
  revalidatePath("/assets");
}

const assignAssetSchema = z.object({
  assetId: z.string().uuid(),
  employeeId: z.string().uuid(),
  issuedDate: z.string().min(1),
  conditionOnIssue: z.string().optional(),
});

/**
 * Issues an available asset to an employee — two sequential writes (not
 * one atomic transaction, same tradeoff as createEmployee's
 * employee+contract insert), both independently RLS-checked against the
 * same HR Admin grant: the assignment row, then flipping the asset's own
 * status to 'issued' so it drops out of the "available to assign" list.
 */
export async function assignAsset(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = assignAssetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error: assignError } = await supabase.from("asset_assignments").insert({
    asset_id: d.assetId,
    employee_id: d.employeeId,
    issued_date: d.issuedDate,
    condition_on_issue: d.conditionOnIssue || null,
    issued_by: user.id,
  });
  if (assignError) return { error: assignError.message };

  const { error: statusError } = await supabase.from("assets").update({ status: "issued" }).eq("id", d.assetId);
  if (statusError) {
    return { error: `Assigned, but couldn't update the asset's status (${statusError.message}).` };
  }

  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/assets");
  return { error: null };
}

const returnAssetSchema = z.object({
  assignmentId: z.string().uuid(),
  assetId: z.string().uuid(),
  employeeId: z.string().uuid(),
  conditionOnReturn: z.string().optional(),
  newStatus: z.enum(["in_stock", "under_repair", "retired"]),
});

/** Closes out an assignment and puts the asset back into circulation (or out of it, if it's damaged/retired). */
export async function returnAsset(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = returnAssetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error: returnError } = await supabase
    .from("asset_assignments")
    .update({ returned_date: new Date().toISOString().slice(0, 10), condition_on_return: d.conditionOnReturn || null })
    .eq("id", d.assignmentId);
  if (returnError) return { error: returnError.message };

  const { error: statusError } = await supabase.from("assets").update({ status: d.newStatus }).eq("id", d.assetId);
  if (statusError) {
    return { error: `Returned, but couldn't update the asset's status (${statusError.message}).` };
  }

  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/assets");
  return { error: null };
}
