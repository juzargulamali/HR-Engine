"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";

const createEmployeeSchema = z.object({
  companyId: z.string().uuid(),
  countryCode: z.string().length(2),
  employeeNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  hireDate: z.string().min(1),
  jobTitle: z.string().optional(),
  contractType: z.enum(["permanent", "fixed_term", "probation", "contractor"]),
  contractStartDate: z.string().min(1),
  noticePeriodDays: z.coerce.number().int().min(0).default(30),
});

/**
 * Creates the employee record and its first contract version as two
 * sequential inserts, not one atomic transaction — supabase-js doesn't
 * expose multi-statement transactions to the client, and both writes are
 * independently RLS-checked against the same HR Admin grant. If the second
 * insert fails, the employee row still exists (a recoverable, visible
 * state — HR sees the employee with no contract on record and can add one
 * manually), never a silent partial success. Acceptable tradeoff for how
 * infrequently this runs; revisit with a Postgres RPC if that ever changes.
 */
export async function createEmployee(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createEmployeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .insert({
      company_id: d.companyId,
      country_code: d.countryCode,
      employee_number: d.employeeNumber,
      first_name: d.firstName,
      last_name: d.lastName,
      hire_date: d.hireDate,
      job_title: d.jobTitle || null,
    })
    .select("id")
    .single();

  if (employeeError || !employee) {
    return { error: employeeError?.message ?? "Could not create employee." };
  }

  const { error: contractError } = await supabase.from("employment_contracts").insert({
    employee_id: employee.id,
    contract_type: d.contractType,
    start_date: d.contractStartDate,
    notice_period_days: d.noticePeriodDays,
    version_no: 1,
    created_by: user.id,
  });

  revalidatePath("/employees");

  if (contractError) {
    // The employee record exists either way — send them to its page rather
    // than losing that context, with the contract error still visible there
    // isn't possible via this return path (redirect always throws), so this
    // is the one case where staying on the form to show the message wins.
    return {
      error: `Employee created, but the initial contract couldn't be saved (${contractError.message}). Add it from the employee's page.`,
    };
  }

  redirect(`/employees/${employee.id}`);
}

const updateEmployeeSchema = z.object({
  employeeId: z.string().uuid(),
  jobTitle: z.string().optional(),
  employmentStatus: z.enum(["active", "on_leave", "suspended", "terminated"]),
  managerId: z.string().uuid().optional().or(z.literal("")),
});

/** HR Admin editing an employee's core record — see employees_update_hr. */
export async function updateEmployee(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = updateEmployeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .update({
      job_title: d.jobTitle || null,
      employment_status: d.employmentStatus,
      manager_id: d.managerId || null,
    })
    .eq("id", d.employeeId);

  if (error) return { error: error.message };

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

/** Self-service: an employee editing their own contact details only. */
const updateContactSchema = z.object({
  employeeId: z.string().uuid(),
  personalEmail: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
});

export async function updateOwnContactInfo(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = updateContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  // Relies entirely on RLS for enforcement: `employees_update_self` only
  // matches the caller's own row, and the `employees_guard_self_update`
  // trigger rejects the write outright if any column other than
  // personal_email/phone changed — this Server Action doesn't duplicate
  // either check, it just reports whatever Postgres decides.
  const { error } = await supabase
    .from("employees")
    .update({ personal_email: d.personalEmail || null, phone: d.phone || null })
    .eq("id", d.employeeId);

  if (error) return { error: error.message };

  revalidatePath("/profile");
  return { error: null };
}

export async function softDeleteEmployee(employeeId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase
    .from("employees")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
    .eq("id", employeeId);
  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId}`);
}

export async function restoreEmployee(employeeId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("employees").update({ deleted_at: null, deleted_by: null }).eq("id", employeeId);
  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId}`);
}

const addContractVersionSchema = z.object({
  employeeId: z.string().uuid(),
  currentContractId: z.string().uuid().optional().or(z.literal("")),
  nextVersionNo: z.coerce.number().int().min(1),
  contractType: z.enum(["permanent", "fixed_term", "probation", "contractor"]),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  noticePeriodDays: z.coerce.number().int().min(0).default(30),
});

/**
 * The versioning pattern from docs/02-database-schema.md §2.3: insert the
 * new version, then flip the previous one's is_current/superseded_by — two
 * writes, not an edit of the old row's terms. Both are HR-Admin-gated by
 * the same RLS policy, so if the second write is denied the first still
 * committed (visible immediately as "two current versions," a state HR can
 * see and fix, never a silent inconsistency).
 */
export async function addContractVersion(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addContractVersionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: newVersion, error: insertError } = await supabase
    .from("employment_contracts")
    .insert({
      employee_id: d.employeeId,
      contract_type: d.contractType,
      start_date: d.startDate,
      end_date: d.endDate || null,
      notice_period_days: d.noticePeriodDays,
      version_no: d.nextVersionNo,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (insertError || !newVersion) {
    return { error: insertError?.message ?? "Could not save the new contract version." };
  }

  if (d.currentContractId) {
    await supabase
      .from("employment_contracts")
      .update({ is_current: false, superseded_by: newVersion.id })
      .eq("id", d.currentContractId);
  }

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

const addCompensationVersionSchema = z.object({
  employeeId: z.string().uuid(),
  currentCompensationId: z.string().uuid().optional().or(z.literal("")),
  effectiveFrom: z.string().min(1),
  baseSalary: z.coerce.number().positive(),
  currency: z.string().length(3),
  bankIban: z.string().optional(),
});

export async function addCompensationVersion(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addCompensationVersionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: newVersion, error: insertError } = await supabase
    .from("compensation_details")
    .insert({
      employee_id: d.employeeId,
      effective_from: d.effectiveFrom,
      base_salary: d.baseSalary,
      currency: d.currency.toUpperCase(),
      bank_iban: d.bankIban || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (insertError || !newVersion) {
    return { error: insertError?.message ?? "Could not save the new compensation record." };
  }

  if (d.currentCompensationId) {
    await supabase
      .from("compensation_details")
      .update({ is_current: false, superseded_by: newVersion.id })
      .eq("id", d.currentCompensationId);
  }

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

const addIdentityDocumentSchema = z.object({
  employeeId: z.string().uuid(),
  companyId: z.string().uuid(),
  documentType: z.string().min(1),
  documentNumber: z.string().min(1),
  expiryDate: z.string().optional(),
});

export async function addIdentityDocument(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addIdentityDocumentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    companyId: formData.get("companyId"),
    documentType: formData.get("documentType"),
    documentNumber: formData.get("documentNumber"),
    expiryDate: formData.get("expiryDate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  let filePath: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    filePath = `${d.companyId}/${d.employeeId}/${d.documentType}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("identity-documents").upload(filePath, file);
    if (uploadError) return { error: `Upload failed: ${uploadError.message}` };
  }

  const { error } = await supabase.from("identity_documents").insert({
    employee_id: d.employeeId,
    document_type: d.documentType,
    document_number: d.documentNumber,
    expiry_date: d.expiryDate || null,
    file_path: filePath,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

const addEmployeeDocumentSchema = z.object({
  employeeId: z.string().uuid(),
  companyId: z.string().uuid(),
  documentType: z.string().min(1),
  expiryDate: z.string().optional(),
});

/** employee_documents (Phase 5) — same employee-documents bucket/path convention Phase 1 set up, HR Admin only. */
export async function addEmployeeDocument(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addEmployeeDocumentSchema.safeParse({
    employeeId: formData.get("employeeId"),
    companyId: formData.get("companyId"),
    documentType: formData.get("documentType"),
    expiryDate: formData.get("expiryDate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "A file is required." };
  }

  const supabase = await createClient();
  const filePath = `${d.companyId}/${d.employeeId}/${d.documentType}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage.from("employee-documents").upload(filePath, file);
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` };

  const { error } = await supabase.from("employee_documents").insert({
    employee_id: d.employeeId,
    document_type: d.documentType,
    file_path: filePath,
    expiry_date: d.expiryDate || null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}
