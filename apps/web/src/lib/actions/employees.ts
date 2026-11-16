"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { employeeNumberErrorMessage } from "@/lib/hr/employee-number";
import type { ActionState } from "./companies";
import { validateUploadFile, sanitizeForStoragePath } from "@/lib/uploads";
import { applyPolandTerminationLeaveTrueUp } from "./polandTermination";

/** createEmployee moved to employeeOnboarding.ts (company-first, retry-safe create). */

const updateEmployeeSchema = z.object({
  employeeId: z.string().uuid(),
  jobTitle: z.string().optional(),
  employmentStatus: z.enum(["active", "on_leave", "suspended", "terminated"]),
  managerId: z.string().uuid().optional().or(z.literal("")),
  dateOfBirth: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  terminationDate: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // Optional HR reference data only — NOT used by
  // computeAnnualLeaveEntitlementToDate. Enginious grants every Poland
  // employee a flat 26 working days of Annual Leave per calendar year as a
  // company benefit, regardless of recognised prior service. Kept on the
  // schema to avoid an unnecessary reversal, not because anything reads it.
  // Irrelevant (harmlessly stored as null) for any employee outside Poland.
  recognisedPriorServiceYears: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).optional()),
  // Optional HR reference data only — NOT used by
  // computeAnnualLeaveEntitlementToDate. Whether this is the employee's
  // first-ever job has no effect on Poland's flat 26-day/year Annual Leave
  // benefit; kept on the schema to avoid an unnecessary reversal, not
  // because anything reads it. "" (unset) is preserved as null, not
  // defaulted to either answer. Irrelevant (harmlessly stored as null) for
  // any employee outside Poland.
  isFirstEverEmployment: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["true", "false"]).optional()),
});

/**
 * HR Admin editing an employee's core record — see employees_update_hr.
 *
 * The '-> terminated' transition specifically goes through terminate_employee()
 * instead of this plain table update: that RPC atomically forfeits any
 * unused internal Recovery Leave in the SAME transaction as the status
 * change, so forfeiture is never a separate step HR could forget to run.
 * Every other status transition is unaffected — still the direct update
 * employees_update_hr already allows.
 */
export async function updateEmployee(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = updateEmployeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();

  if (d.employmentStatus === "terminated") {
    // Needed for the Poland leave true-up below, and to pin the exact same
    // termination date into both terminate_employee() and this system's
    // own entitlement calculation — never let the two drift apart by one
    // resolving "today" a moment later than the other. Checked and stopped
    // on BEFORE calling terminate_employee(): if this lookup fails, we
    // cannot know whether the employee is in Poland, so proceeding would
    // risk silently skipping the Annual Leave true-up for a Poland
    // employee with no warning at all, rather than an explicit error.
    const { data: employeeForTermination, error: employeeLookupError } = await supabase
      .from("employees")
      .select("country_code, hire_date")
      .eq("id", d.employeeId)
      .single();
    if (employeeLookupError || !employeeForTermination) {
      return { error: employeeLookupError?.message ?? "Could not look up this employee before termination." };
    }
    // This employee's own business-local date when HR leaves the
    // termination date blank — the recorded date (and everything the
    // Poland true-up below derives from it) must reflect their own
    // country's calendar day, not the server's UTC one.
    const terminationDate = d.terminationDate || getBusinessDateString(resolveCountryTimeZone(employeeForTermination.country_code));

    const { error } = await supabase.rpc("terminate_employee", {
      p_employee_id: d.employeeId,
      p_termination_date: terminationDate,
    });
    if (error) return { error: error.message };

    // job_title/manager_id/date_of_birth aren't part of terminate_employee()
    // (a termination shouldn't silently also change unrelated fields) — a
    // second, ordinary update covers anything else this form submitted
    // alongside the status change.
    const { error: fieldsError } = await supabase
      .from("employees")
      .update({
        job_title: d.jobTitle || null,
        manager_id: d.managerId || null,
        date_of_birth: d.dateOfBirth || null,
        recognised_prior_service_years: d.recognisedPriorServiceYears ?? null,
        is_first_ever_employment: d.isFirstEverEmployment === undefined ? null : d.isFirstEverEmployment === "true",
      })
      .eq("id", d.employeeId);
    if (fieldsError) return { error: fieldsError.message };

    // Poland only — see polandTermination.ts's own header for why this runs
    // as a separate, deliberately non-blocking step: it never fails the
    // termination itself, only surfaces a warning when the Annual Leave
    // true-up couldn't be posted automatically.
    let warning: string | null = null;
    if (employeeForTermination.country_code === "PL") {
      warning = await applyPolandTerminationLeaveTrueUp(supabase, d.employeeId, employeeForTermination.hire_date, terminationDate);
    }

    revalidatePath(`/employees/${d.employeeId}`);
    return { error: null, warning };
  } else {
    const { error } = await supabase
      .from("employees")
      .update({
        job_title: d.jobTitle || null,
        employment_status: d.employmentStatus,
        manager_id: d.managerId || null,
        date_of_birth: d.dateOfBirth || null,
        recognised_prior_service_years: d.recognisedPriorServiceYears ?? null,
        is_first_ever_employment: d.isFirstEverEmployment === undefined ? null : d.isFirstEverEmployment === "true",
      })
      .eq("id", d.employeeId);
    if (error) return { error: error.message };
  }

  revalidatePath(`/employees/${d.employeeId}`);
  return { error: null };
}

/**
 * The one, explicit, audited HR action that clears a pending
 * excess_requiring_review_days flag on a Poland termination reconciliation
 * — see poland_termination_leave_reconciliations' own migration header
 * comment (supabase/migrations/20261102000000_poland_termination_leave_true_up.sql)
 * for why this can never be inferred or automatic. RLS/the underlying
 * acknowledge_poland_termination_leave_excess() RPC (HR Admin only) is the
 * real enforcement; this action just relays the call and refreshes the
 * employee page so Final Settlement's readiness check re-reads the updated
 * marker immediately.
 */
export async function acknowledgePolandTerminationLeaveExcess(employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_poland_termination_leave_excess", { p_employee_id: employeeId });
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}

/**
 * The escape hatch for when the automatic Poland Annual Leave termination
 * true-up (applyPolandTerminationLeaveTrueUp) couldn't run — HR has already
 * been told, in that warning, to post the correct amount manually via a
 * leave-ledger adjustment; this is HR's explicit, audited confirmation that
 * they've done so for this employee's exact termination_date. RLS/the
 * underlying confirm_poland_termination_leave_manually_reconciled() RPC (HR
 * Admin only) is the real enforcement — this action just relays the call
 * and refreshes the employee page so Final Settlement's readiness check
 * re-reads the newly-created marker immediately. Posts nothing to
 * leave_ledger itself — only the completion marker.
 */
export async function confirmPolandTerminationLeaveManuallyReconciled(employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_poland_termination_leave_manually_reconciled", { p_employee_id: employeeId });
  revalidatePath(`/employees/${employeeId}`);
  return { error: error?.message ?? null };
}

const setTerminationSettlementRateSchema = z.object({
  employeeId: z.string().uuid(),
  leaveEncashmentDailyRate: z.coerce.number().positive(),
});

/**
 * HR/Finance-provided statutory leave-encashment wage basis for a Saudi or
 * Poland termination — final-settlement-section.tsx blocks its leave
 * encashment figure until this exists, rather than guessing basic salary
 * for a country where that would be legally wrong. RLS (termination_settlement_inputs_write)
 * is the real enforcement of who may call this; the trigger-stamped
 * entered_by/entered_at make it auditable regardless of what this form
 * sends.
 */
export async function setTerminationSettlementRate(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = setTerminationSettlementRateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("termination_settlement_inputs")
    .upsert({ employee_id: d.employeeId, leave_encashment_daily_rate: d.leaveEncashmentDailyRate });
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
      return { error: `No account found for ${d.email} — invite them from People & Access first, then link them here.` };
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
  // Employee numbers are one shared series: a removed employee's number may have been given to someone else since. The database says so; show it as a sentence, not as a constraint name.
  if (error) return { error: error.code === "23505" ? employeeNumberErrorMessage(error) : error.message };
  return { error: null };
}

/**
 * Irreversible — see permanently_delete_employee() in schema.sql for the
 * full cascade and its rationale. The employee page itself is gone after
 * this succeeds, so the caller redirects rather than staying on a 404.
 */
export async function permanentlyDeleteEmployee(employeeId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("permanently_delete_employee", { p_employee_id: employeeId });
  if (error) return { error: error.message };
  revalidatePath("/employees");
  redirect("/employees");
}

const addContractVersionSchema = z.object({
  employeeId: z.string().uuid(),
  currentContractId: z.string().uuid().optional().or(z.literal("")),
  nextVersionNo: z.coerce.number().int().min(1),
  contractType: z.enum(["permanent", "fixed_term", "probation", "contractor"]),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  noticePeriodDays: z.coerce.number().int().min(0).default(30),
  // Poland Annual Leave entitlement is prorated by this fraction (1.0 =
  // full-time). Harmless for every other country — the domain calculators
  // only read it for Poland.
  fteFraction: z.coerce.number().gt(0).max(1).default(1),
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
      fte_fraction: d.fteFraction,
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

  // Same reasoning as addDocument() (employeeDocuments.ts): derive the real company
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
