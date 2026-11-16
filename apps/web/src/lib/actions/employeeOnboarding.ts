"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canCreateEmployee } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { computeSetup, remainingSteps } from "@/lib/hr/setup";
import type { ActionState } from "./companies";

/** What the form gets back when the employee was NOT created: the sentence to show. */
export interface CreateEmployeeState extends ActionState {
  /** Kept for callers of the earlier form; no longer set (the number is assigned by the database, so a new hire cannot repeat one). */
  existingEmployeeId?: string;
}

const blank = (v: unknown) => (v === "" || v == null ? undefined : v);
const optionalDate = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").optional());
const optionalNumber = (min: number) => z.preprocess(blank, z.coerce.number().min(min).optional());

const createEmployeeSchema = z.object({
  /** Made once when the form opens, and used as the employee's id: a repeated click or a retry reaches the same record instead of a second one. */
  employeeId: z.string().uuid("Reload the page and try again."),
  companyId: z.string().uuid("Choose a company first."),
  /** Only used when the company has no country of its own; otherwise the company's country is used and this is ignored. */
  countryCode: z.preprocess(blank, z.string().length(2).optional()),
  // There is no employee number here: the database gives every new hire the next number of the one shared series (E001, E002, ...) when the row is saved, the same in every company.
  firstName: z.string().trim().min(1, "Enter the first name."),
  lastName: z.string().trim().min(1, "Enter the last name."),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the hire date."),
  dateOfBirth: optionalDate,
  jobTitle: z.preprocess(blank, z.string().trim().max(120, "Keep the job title under 120 characters.").optional()),
  departmentId: z.preprocess(blank, z.string().uuid().optional()),
  managerId: z.preprocess(blank, z.string().uuid().optional()),
  // Contract: started only when a type is chosen ("Add later" is the empty choice).
  contractType: z.preprocess(blank, z.enum(["permanent", "fixed_term", "probation", "contractor"]).optional()),
  contractStartDate: optionalDate,
  noticePeriodDays: z.preprocess(blank, z.coerce.number().int().min(0).default(30)),
  // Pay: started only when a basic salary is entered.
  basicSalary: z.preprocess(blank, z.coerce.number().positive("Basic salary must be more than zero.").optional()),
  otherAllowance: optionalNumber(0),
  salaryCurrency: z.preprocess(blank, z.string().trim().length(3, "Enter the currency as a 3-letter code.").optional()),
  openingAnnualLeaveDays: optionalNumber(0),
  openingCompDays: optionalNumber(0),
});

const WHAT: Record<string, string> = { contract: "contract", pay: "pay", balances: "balances" };

/**
 * Creates the employee once and opens their profile. The employee row is written first, under the id the form generated; contract, pay and opening balances are
 * optional and written only when the form asked for them. The writes are separate (the data service has no multi-statement transaction for the browser client), so
 * the action never leaves the person on a form after a partial failure: it opens the profile, whose setup checklist reads the real records and shows exactly what
 * remains. A repeated click, a retry or a double submit carries the same id, hits the primary key, and simply opens the existing profile without writing anything
 * else, so a second employee or a second opening balance cannot be created this way.
 */
export async function createEmployee(_prev: CreateEmployeeState, formData: FormData): Promise<CreateEmployeeState> {
  const parsed = createEmployeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;

  const session = await getCurrentSession();
  if (!session) return { error: "Sign in again to continue." };
  if (!canCreateEmployee(session.grants, d.companyId)) return { error: "You cannot add employees to this company." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to continue." };

  const { data: company, error: companyError } = await supabase.from("companies").select("id, country_code, default_currency").eq("id", d.companyId).maybeSingle();
  if (companyError) return { error: "The company could not be read. Try again." };
  if (!company) return { error: "You cannot add employees to this company." };
  const country = company.country_code && company.country_code.length === 2 ? company.country_code : d.countryCode;
  if (!country) return { error: "This company has no country set. Choose the employee's country." };

  if (d.departmentId) {
    const { data: dep } = await supabase.from("departments").select("id").eq("id", d.departmentId).eq("company_id", d.companyId).is("deleted_at", null).maybeSingle();
    if (!dep) return { error: "Choose a department of this company." };
  }
  if (d.managerId) {
    const { data: manager } = await supabase.from("employees").select("id").eq("id", d.managerId).eq("company_id", d.companyId).is("deleted_at", null).maybeSingle();
    if (!manager) return { error: "Choose a manager from this company." };
  }

  const { error: employeeError } = await supabase.from("employees").insert({
    id: d.employeeId,
    company_id: d.companyId,
    country_code: country,
    first_name: d.firstName,
    last_name: d.lastName,
    hire_date: d.hireDate,
    date_of_birth: d.dateOfBirth ?? null,
    job_title: d.jobTitle ?? null,
    department_id: d.departmentId ?? null,
    manager_id: d.managerId ?? null,
  });

  if (employeeError) {
    if (employeeError.code === "23505") {
      // The same form was sent again: open what the first send made, and write nothing more.
      if (/employees_pkey/.test(employeeError.message ?? "")) {
        const { data: existing } = await supabase.from("employees").select("id").eq("id", d.employeeId).maybeSingle();
        if (existing) redirect(`/employees/${existing.id}`);
        return { error: "This employee was already created, but you cannot open the record. Ask an HR Admin of the company." };
      }
      // The number is given out by the database and it skips every number already held, so this is not expected; if two writes ever race for one, nothing was saved and sending again takes the next number.
      return { error: "The employee number could not be assigned. Nothing was saved. Try again." };
    }
    return { error: "The employee could not be created. Nothing was saved. Check the details and try again." };
  }

  const failed: string[] = [];
  let contractSaved = false;
  let paySaved = false;
  let balancesSaved = 0;

  if (d.contractType) {
    const { error } = await supabase.from("employment_contracts").insert({
      employee_id: d.employeeId,
      contract_type: d.contractType,
      // Left empty, the contract starts on the hire date: the same date is not typed twice.
      start_date: d.contractStartDate ?? d.hireDate,
      notice_period_days: d.noticePeriodDays,
      version_no: 1,
      created_by: user.id,
    });
    if (error) failed.push("contract");
    else contractSaved = true;
  }

  if (d.basicSalary !== undefined) {
    const currency = (d.salaryCurrency ?? company.default_currency ?? "").toUpperCase();
    if (currency.length !== 3) failed.push("pay");
    else {
      const { error } = await supabase.from("compensation_details").insert({
        employee_id: d.employeeId,
        effective_from: d.hireDate,
        base_salary: d.basicSalary,
        allowances: d.otherAllowance ? { other: d.otherAllowance } : {},
        currency,
        created_by: user.id,
      });
      if (error) failed.push("pay");
      else paySaved = true;
    }
  }

  // Opening balances are posted once per employee: nothing is written when an opening-balance row already exists, and the database's own unique index
  // (partial, on the opening-balance rows) makes a concurrent second post impossible; its refusal means "already recorded", not a failure.
  if (d.openingAnnualLeaveDays) {
    const { data: already } = await supabase.from("leave_ledger").select("id").eq("employee_id", d.employeeId).eq("leave_type_code", "annual").eq("reference_type", "opening_balance").limit(1);
    if (!already || already.length === 0) {
      const { error } = await supabase.from("leave_ledger").insert({
        employee_id: d.employeeId,
        leave_type_code: "annual",
        txn_date: d.hireDate,
        entry_type: "adjustment",
        amount_days: d.openingAnnualLeaveDays,
        reference_type: "opening_balance",
        note: "Opening annual leave balance recorded at onboarding",
        created_by: user.id,
      });
      if (error && error.code !== "23505") failed.push("balances");
      else balancesSaved += 1;
    } else balancesSaved += 1;
  }
  if (d.openingCompDays) {
    const { data: already } = await supabase.from("comp_day_ledger").select("id").eq("employee_id", d.employeeId).eq("source", "opening_balance").limit(1);
    if (!already || already.length === 0) {
      const { error } = await supabase.from("comp_day_ledger").insert({
        employee_id: d.employeeId,
        txn_date: d.hireDate,
        entry_type: "earned",
        days: d.openingCompDays,
        source: "opening_balance",
        reference_type: "manual_adjustment",
        created_by: user.id,
      });
      if (error && error.code !== "23505") { if (!failed.includes("balances")) failed.push("balances"); }
      else balancesSaved += 1;
    } else balancesSaved += 1;
  }

  revalidatePath("/employees");

  // Which setup step to open first: the same derivation the profile makes, from what was just written.
  const steps = computeSetup({
    employeeId: d.employeeId,
    employmentStatus: "active",
    removed: false,
    counts: { contracts: contractSaved ? 1 : 0, compensation: paySaved ? 1 : 0, identityDocuments: 0, employeeDocuments: 0, openingBalances: balancesSaved },
    linkedUserId: null,
    viewerCanInvite: false,
    viewerCanOpenAccess: false,
  });
  const first = remainingSteps(steps)[0];
  // The profile opens on the tab and form of the first step still to do (`?tab=...&step=...`), with the one-off markers the page reads: created, and what failed.
  // Nothing failed: the profile's Overview opens, with the setup checklist; only after a partial failure does it open the first step that still needs doing.
  const url = new URL(failed.length > 0 && first?.href ? first.href : `/employees/${d.employeeId}`, "https://placeholder.invalid");
  url.searchParams.set("created", "1");
  if (failed.length) url.searchParams.set("notice", [...new Set(failed)].map((f) => WHAT[f] ?? f).join(","));
  redirect(`${url.pathname}${url.search}`);
}
