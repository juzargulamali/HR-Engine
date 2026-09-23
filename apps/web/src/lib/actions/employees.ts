"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "./companies";
import { validateUploadFile, sanitizeForStoragePath } from "@/lib/uploads";

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
  // Basic/Others breakdown — Others is a single lump allowance figure kept
  // under the `allowances` jsonb column's "other" key, same convention
  // addCompensationVersion() uses for a later promotion/appraisal update.
  basicSalary: z.coerce.number().positive(),
  otherAllowance: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).optional()),
  salaryCurrency: z.string().length(3),
  // Opening balances an incoming employee already carries (a mid-year hire,
  // or a transfer from another entity) — optional, defaulting to none.
  openingAnnualLeaveDays: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).optional()),
  openingCompDays: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).optional()),
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

  const warnings: string[] = [];
  if (contractError) {
    warnings.push(`the initial contract couldn't be saved (${contractError.message})`);
  }

  const { error: compensationError } = await supabase.from("compensation_details").insert({
    employee_id: employee.id,
    effective_from: d.hireDate,
    base_salary: d.basicSalary,
    allowances: d.otherAllowance ? { other: d.otherAllowance } : {},
    currency: d.salaryCurrency.toUpperCase(),
    created_by: user.id,
  });
  if (compensationError) warnings.push(`the salary record couldn't be saved (${compensationError.message})`);

  // Opening balances (a mid-year hire's carried-over annual leave, or comp
  // days already earned elsewhere) — posted the same way any other manual
  // ledger correction is (leave_ledger_insert_hr/comp_ledger_insert_hr
  // already grant this to HR Admin directly, same RLS postLeaveLedgerAdjustment
  // uses), just at onboarding time instead of via the AI-suggestions flow.
  if (d.openingAnnualLeaveDays) {
    const { error: leaveError } = await supabase.from("leave_ledger").insert({
      employee_id: employee.id,
      leave_type_code: "annual",
      txn_date: d.hireDate,
      entry_type: "adjustment",
      amount_days: d.openingAnnualLeaveDays,
      reference_type: "manual_adjustment",
      note: "Opening annual leave balance recorded at onboarding",
      created_by: user.id,
    });
    if (leaveError) warnings.push(`the opening annual leave balance couldn't be posted (${leaveError.message})`);
  }

  if (d.openingCompDays) {
    const { error: compError } = await supabase.from("comp_day_ledger").insert({
      employee_id: employee.id,
      txn_date: d.hireDate,
      entry_type: "earned",
      days: d.openingCompDays,
      source: "opening_balance",
      reference_type: "manual_adjustment",
      created_by: user.id,
    });
    if (compError) warnings.push(`the opening comp-day balance couldn't be posted (${compError.message})`);
  }

  revalidatePath("/employees");

  if (warnings.length > 0) {
    // The employee record exists either way — send them to its page rather
    // than losing that context, with any warning still visible there isn't
    // possible via this return path (redirect always throws), so this is
    // the one case where staying on the form to show the message wins.
    return {
      error: `Employee created, but ${warnings.join(", and ")}. Add it from the employee's page.`,
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

const linkEmployeeUserSchema = z.object({
  employeeId: z.string().uuid(),
  email: z.string().email().optional().or(z.literal("")),
});

/**
 * Connects an employee record to a login — the step nothing else in the
 * app ever does. Inviting someone (Admin -> Users) only creates their
 * auth.users/profiles row; creating their employee record (Employees ->
 * New) never asks for an email. Without this, current_employee_id() never
 * resolves for them and every self-service page ("My Profile", leave,
 * reimbursements) tells a real, logged-in person HR hasn't created their
 * record yet — even after both rows exist. Looks the account up by email
 * via `profiles` (readable by any signed-in user, per profiles_select) and
 * reports a clear error if nobody's been invited yet, rather than a raw
 * constraint violation, when the email doesn't resolve to anyone. Clearing
 * the field unlinks the employee (sets user_id back to null).
 */
export async function linkEmployeeToUser(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = linkEmployeeUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();

  let userId: string | null = null;
  if (d.email) {
    const { data: profile } = await supabase.from("profiles").select("id").ilike("email", d.email).maybeSingle();
    if (!profile) {
      return { error: `No account found for ${d.email} — invite them from Admin → Users first, then link them here.` };
    }
    userId = profile.id;
  }

  const { error } = await supabase.from("employees").update({ user_id: userId }).eq("id", d.employeeId);
  if (error) {
    return {
      error: error.message.includes("employees_user_id_unique")
        ? "That account is already linked to a different employee record."
        : error.message,
    };
  }

  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/profile");
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

export async function softDeleteEmployee(employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("employees")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
    .eq("id", employeeId);
  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}

export async function restoreEmployee(employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("employees").update({ deleted_at: null, deleted_by: null }).eq("id", employeeId);
  revalidatePath("/employees");
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
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
  // "Others" is one lump allowance figure (housing/transport/etc. combined)
  // rather than itemized — kept in the same `allowances` jsonb column
  // resolve_policy-style features elsewhere use, under a single "other" key,
  // since nothing downstream needs it broken out further than the
  // Basic/Others/Total split requested for end-of-service settlement math.
  otherAllowance: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).optional()),
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
      allowances: d.otherAllowance ? { other: d.otherAllowance } : {},
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
  documentType: z.string().min(1),
  documentNumber: z.string().min(1),
  expiryDate: z.string().optional(),
});

export async function addIdentityDocument(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addIdentityDocumentSchema.safeParse({
    employeeId: formData.get("employeeId"),
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

  // The storage RLS for this bucket (schema.sql) only checks the path's
  // company-id segment against the caller's own hr_admin grant — it never
  // verifies the path's employee-id segment actually belongs to that
  // company. Trusting the client-submitted companyId here would let an
  // HR Admin plant a file under an arbitrary employee (any company) that
  // then sits in storage un-linked to any row once the table insert below
  // rejects the real mismatch. Deriving it from the employee record itself
  // closes that gap the same way letters.ts/reimbursements.ts already do.
  const { data: employee } = await supabase.from("employees").select("company_id").eq("id", d.employeeId).single();
  if (!employee) return { error: "Employee not found." };

  let filePath: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const validationError = validateUploadFile(file);
    if (validationError) return { error: validationError };

    filePath = `${employee.company_id}/${d.employeeId}/${sanitizeForStoragePath(d.documentType)}/${Date.now()}-${sanitizeForStoragePath(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("identity-documents")
      .upload(filePath, file, { contentType: file.type });
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

  if (error) {
    // The scan (if any) was already uploaded above — without this, a
    // failed row insert leaves it orphaned in Storage with nothing ever
    // pointing at it.
    if (filePath) await supabase.storage.from("identity-documents").remove([filePath]);
    return { error: error.message };
  }

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

/**
 * identity_documents has no soft-delete column (unlike employee_documents),
 * so this is a real delete — row plus its storage object, same
 * remove-then-delete order as deleteLetter() so a failed storage remove
 * still leaves the row (and its download link) rather than orphaning a
 * file with nothing left to serve it.
 */
export async function deleteIdentityDocument(documentId: string, employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: doc } = await supabase.from("identity_documents").select("file_path").eq("id", documentId).maybeSingle();
  if (doc?.file_path) {
    await supabase.storage.from("identity-documents").remove([doc.file_path]);
  }

  const { error } = await supabase.from("identity_documents").delete().eq("id", documentId);
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}

const addEmployeeDocumentSchema = z.object({
  employeeId: z.string().uuid(),
  documentType: z.string().min(1),
  expiryDate: z.string().optional(),
});

/** employee_documents (Phase 5) — same employee-documents bucket/path convention Phase 1 set up, HR Admin only. */
export async function addEmployeeDocument(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addEmployeeDocumentSchema.safeParse({
    employeeId: formData.get("employeeId"),
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
  const validationError = validateUploadFile(file);
  if (validationError) return { error: validationError };

  const supabase = await createClient();

  // Same reasoning as addIdentityDocument() above: derive the real company
  // from the employee row rather than trusting the client-submitted one,
  // since this bucket's storage RLS doesn't cross-check the two itself.
  const { data: employee } = await supabase.from("employees").select("company_id").eq("id", d.employeeId).single();
  if (!employee) return { error: "Employee not found." };

  const filePath = `${employee.company_id}/${d.employeeId}/${sanitizeForStoragePath(d.documentType)}/${Date.now()}-${sanitizeForStoragePath(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from("employee-documents")
    .upload(filePath, file, { contentType: file.type });
  if (uploadError) return { error: `Upload failed: ${uploadError.message}` };

  const { error } = await supabase.from("employee_documents").insert({
    employee_id: d.employeeId,
    document_type: d.documentType,
    file_path: filePath,
    expiry_date: d.expiryDate || null,
  });
  if (error) {
    // The file was already uploaded above — without this, a failed row
    // insert leaves it orphaned in Storage with nothing ever pointing at it.
    await supabase.storage.from("employee-documents").remove([filePath]);
    return { error: error.message };
  }

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

/**
 * Soft-delete, same as employees' own restore/remove pattern — the storage
 * file is deliberately left in place (deleted_at is what "recovery" means
 * here; the row's own select policy already hides it from the employee
 * while HR Admin keeps seeing it, same as employees_select).
 */
export async function deleteEmployeeDocument(documentId: string, employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("employee_documents").update({ deleted_at: new Date().toISOString() }).eq("id", documentId);
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}

export async function restoreEmployeeDocument(documentId: string, employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("employee_documents").update({ deleted_at: null }).eq("id", documentId);
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}

const addInsurancePolicySchema = z.object({
  employeeId: z.string().uuid(),
  insuranceName: z.string().min(1),
  policyNumber: z.string().min(1),
  expiryDate: z.string().optional(),
});

/** employee_insurance_policies — same visibility/write pattern as identity documents, HR Admin only. */
export async function addInsurancePolicy(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addInsurancePolicySchema.safeParse({
    employeeId: formData.get("employeeId"),
    insuranceName: formData.get("insuranceName"),
    policyNumber: formData.get("policyNumber"),
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

  // Same reasoning as addIdentityDocument() above: derive the real company
  // from the employee row rather than trusting a client-submitted one,
  // since this bucket's storage RLS doesn't cross-check the two itself.
  const { data: employee } = await supabase.from("employees").select("company_id").eq("id", d.employeeId).single();
  if (!employee) return { error: "Employee not found." };

  let filePath: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const validationError = validateUploadFile(file);
    if (validationError) return { error: validationError };

    filePath = `${employee.company_id}/${d.employeeId}/${Date.now()}-${sanitizeForStoragePath(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("insurance-documents")
      .upload(filePath, file, { contentType: file.type });
    if (uploadError) return { error: `Upload failed: ${uploadError.message}` };
  }

  const { error } = await supabase.from("employee_insurance_policies").insert({
    employee_id: d.employeeId,
    insurance_name: d.insuranceName,
    policy_number: d.policyNumber,
    expiry_date: d.expiryDate || null,
    file_path: filePath,
    created_by: user.id,
  });

  if (error) {
    // The contract scan (if any) was already uploaded above — without
    // this, a failed row insert leaves it orphaned in Storage with nothing
    // ever pointing at it.
    if (filePath) await supabase.storage.from("insurance-documents").remove([filePath]);
    return { error: error.message };
  }

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

/**
 * Real delete, same remove-then-delete order as deleteIdentityDocument() so
 * a failed storage remove still leaves the row (and its download link)
 * rather than orphaning a file with nothing left to serve it.
 */
export async function deleteInsurancePolicy(policyId: string, employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: policy } = await supabase.from("employee_insurance_policies").select("file_path").eq("id", policyId).maybeSingle();
  if (policy?.file_path) {
    await supabase.storage.from("insurance-documents").remove([policy.file_path]);
  }

  const { error } = await supabase.from("employee_insurance_policies").delete().eq("id", policyId);
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}

const addLoanSchema = z.object({
  employeeId: z.string().uuid(),
  loanType: z.enum(["loan", "cash_advance"]),
  amount: z.coerce.number().positive(),
  currency: z.string().length(3),
  issuedDate: z.string().min(1),
  note: z.string().optional(),
});

/** employee_loans — same visibility/write tier as compensation, HR Admin or Finance. */
export async function addLoan(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = addLoanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("employee_loans").insert({
    employee_id: d.employeeId,
    loan_type: d.loanType,
    amount: d.amount,
    currency: d.currency.toUpperCase(),
    issued_date: d.issuedDate,
    note: d.note || null,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

export async function deleteLoan(loanId: string, employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("employee_loans").delete().eq("id", loanId);
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}

const recordCareerEventSchema = z.object({
  employeeId: z.string().uuid(),
  effectiveDate: z.string().min(1),
  newJobTitle: z.string().optional(),
  newBasicSalary: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().positive().optional()),
  newOtherAllowance: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).optional()),
  note: z.string().optional(),
});

/**
 * The one place HR records a promotion, a title change, a salary change,
 * or a promotion that's both at once — career_events_insert restricts this
 * to HR Admin, distinct from Finance's own addCompensationVersion() above
 * (still available for routine adjustments — bank details, a currency
 * correction — that aren't career events worth logging here). Whichever
 * fields actually changed decide the event_type; this also applies the
 * change itself (employees.job_title and/or a new compensation_details
 * version), so employee_career_events stays a pure audit trail, never a
 * second source of truth for the current title/salary.
 */
export async function recordCareerEvent(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = recordCareerEventSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: employee } = await supabase.from("employees").select("job_title, company_id").eq("id", d.employeeId).single();
  if (!employee) return { error: "Employee not found." };

  const { data: currentComp } = await supabase
    .from("compensation_details")
    .select("id, base_salary, allowances, currency")
    .eq("employee_id", d.employeeId)
    .eq("is_current", true)
    .maybeSingle();
  const currentOther = typeof currentComp?.allowances?.other === "number" ? currentComp.allowances.other : 0;

  const titleChanged = Boolean(d.newJobTitle && d.newJobTitle !== employee.job_title);
  const salaryChanged =
    (d.newBasicSalary !== undefined && d.newBasicSalary !== Number(currentComp?.base_salary ?? NaN)) ||
    (d.newOtherAllowance !== undefined && d.newOtherAllowance !== currentOther);

  if (!titleChanged && !salaryChanged) {
    return { error: "Nothing changed — enter a new title and/or a new salary." };
  }

  const eventType = titleChanged && salaryChanged ? "promotion" : titleChanged ? "title_change" : "salary_change";

  const { error: eventError } = await supabase.from("employee_career_events").insert({
    employee_id: d.employeeId,
    event_type: eventType,
    effective_date: d.effectiveDate,
    previous_job_title: employee.job_title,
    new_job_title: titleChanged ? d.newJobTitle : null,
    previous_base_salary: currentComp ? Number(currentComp.base_salary) : null,
    new_base_salary: salaryChanged ? (d.newBasicSalary ?? Number(currentComp?.base_salary ?? 0)) : null,
    previous_allowances: currentComp?.allowances ?? null,
    new_allowances: salaryChanged ? { other: d.newOtherAllowance ?? currentOther } : null,
    currency: currentComp?.currency ?? null,
    note: d.note || null,
    created_by: user.id,
  });
  if (eventError) return { error: eventError.message };

  const warnings: string[] = [];

  if (titleChanged) {
    const { error } = await supabase.from("employees").update({ job_title: d.newJobTitle }).eq("id", d.employeeId);
    if (error) warnings.push(`the title update failed (${error.message})`);
  }

  if (salaryChanged) {
    let currency = currentComp?.currency;
    if (!currency) {
      const { data: company } = await supabase.from("companies").select("default_currency").eq("id", employee.company_id).single();
      currency = company?.default_currency ?? "AED";
    }

    const { data: newVersion, error: compError } = await supabase
      .from("compensation_details")
      .insert({
        employee_id: d.employeeId,
        effective_from: d.effectiveDate,
        base_salary: d.newBasicSalary ?? Number(currentComp?.base_salary ?? 0),
        allowances: (d.newOtherAllowance ?? currentOther) ? { other: d.newOtherAllowance ?? currentOther } : {},
        currency,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (compError || !newVersion) {
      warnings.push(`the salary update failed (${compError?.message ?? "unknown error"})`);
    } else if (currentComp?.id) {
      await supabase.from("compensation_details").update({ is_current: false, superseded_by: newVersion.id }).eq("id", currentComp.id);
    }
  }

  revalidatePath(`/employees/${d.employeeId}`);

  if (warnings.length > 0) {
    return { error: `Career event logged, but ${warnings.join(", and ")}.` };
  }
  return { error: null };
}
