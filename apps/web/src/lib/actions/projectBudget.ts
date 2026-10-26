"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ACTIVITIES, BUDGET_BASES, FUNDING_METHODS, PAID_VIA, PAYMENT_KINDS, RATE_KEYS, RECEIPT_STATUSES } from "@enginious-hr/domain";
import { createClient } from "@/lib/supabase/server";
import { friendlyBudgetError } from "@/lib/budget/errors";

/**
 * Project Budget & Expenses server actions. Each one validates the shape of its input, makes ONE database function call and returns plain
 * words. The functions in supabase/migrations/20261210* decide everything that matters (who may do it, whether the budget is in the right
 * state, whether the figures are valid, whether a retry or a stale page is being replayed); nothing here recalculates or decides.
 */
export interface BudgetActionResult {
  error: string | null;
  id?: string;
  version?: number;
  status?: string;
}

const uuid = z.string().uuid("That record is not valid.");
const text = (max: number) => z.string().trim().max(max, `Keep this to ${max} characters.`);
const optionalText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v ?? null), text(max).nullable());
const reason = z.string().trim().min(1, "Give the reason.").max(1000, "Keep the reason to 1000 characters.");
/** A decimal typed by a person, kept as TEXT so nothing is rounded on the way to the database. */
const decimal = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const optionalDecimal = z.preprocess((v) => (v === "" || v == null ? null : v), decimal.nullable());
const dateText = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.").nullable());
const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
const version = z.number().int().min(0);

const fail = (message: string, code?: string | null): BudgetActionResult => ({ error: friendlyBudgetError(message, code) });
const issue = (e: z.ZodError): BudgetActionResult => ({ error: e.issues[0]?.message ?? "Invalid input." });

function refresh(projectId?: string) {
  revalidatePath("/finance/project-budgets", "layout");
  if (projectId) revalidatePath(`/projects/${projectId}`, "layout");
}

/** Runs one RPC and shapes its result; `done` turns the returned value into the result fields. */
async function call<T>(projectId: string | undefined, run: (supabase: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ data: T; error: { message: string; code?: string } | null }>, done?: (data: T) => Partial<BudgetActionResult>): Promise<BudgetActionResult> {
  const supabase = await createClient();
  const { data, error } = await run(supabase);
  if (error) return fail(error.message, error.code);
  refresh(projectId);
  return { error: null, ...(done ? done(data) : {}) };
}
const idOf = (data: unknown): Partial<BudgetActionResult> => (typeof data === "string" ? { id: data } : {});
const versionOf = (data: unknown): Partial<BudgetActionResult> => (typeof data === "number" ? { version: data } : {});
const statusOf = (data: unknown): Partial<BudgetActionResult> => (typeof data === "string" ? { status: data } : {});

// ---------------------------------------------------------------------------------------------------------------------------------
// Budget: create, edit, submit, decide, revise
// ---------------------------------------------------------------------------------------------------------------------------------
export async function createBudget(input: { projectId: string; currency: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Choose the expense currency (a 3-letter code, for example AED).") }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_create_budget", { p_project_id: p.data.projectId, p_currency: p.data.currency }), idOf);
}

const budgetRow = z.object({
  category_id: uuid,
  date_from: dateText,
  date_to: dateText,
  activity: z.enum(ACTIVITIES).default("other"),
  description: text(300),
  basis: z.enum(BUDGET_BASES),
  people: optionalDecimal,
  days: optionalDecimal,
  qty: optionalDecimal,
  rate: optionalDecimal,
  fixed: optionalDecimal,
  rate_key: z.preprocess((v) => (v === "" || v == null ? null : v), z.enum(RATE_KEYS).nullable()),
});
export type BudgetRowInput = z.input<typeof budgetRow>;

export async function saveBudgetDraft(input: { projectId: string; versionId: string; expected: number; periodStart: string | null; periodEnd: string | null; people: string[]; note: string | null; rows: BudgetRowInput[] }): Promise<BudgetActionResult> {
  const p = z.object({
    projectId: uuid, versionId: uuid, expected: version, periodStart: dateText, periodEnd: dateText, people: z.array(uuid).max(100), note: optionalText(2000), rows: z.array(budgetRow).max(200, "A budget can have up to 200 rows."),
  }).safeParse(input);
  if (!p.success) return issue(p.error);
  const d = p.data;
  return call(
    d.projectId,
    (s) => s.rpc("pbx_save_budget_draft", { p_version_id: d.versionId, p_expected: d.expected, p_header: { period_start: d.periodStart, period_end: d.periodEnd, people: d.people, note: d.note }, p_rows: d.rows }),
    versionOf,
  );
}

export async function submitBudget(input: { projectId: string; versionId: string; expected: number; requestId: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, versionId: uuid, expected: version, requestId: uuid }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_submit_budget", { p_version_id: p.data.versionId, p_expected: p.data.expected, p_request_id: p.data.requestId }), idOf);
}

export async function decideBudget(input: { projectId?: string; versionId: string; decision: "approve" | "return" | "reject"; note?: string | null }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid.optional(), versionId: uuid, decision: z.enum(["approve", "return", "reject"]), note: optionalText(1000) }).safeParse(input);
  if (!p.success) return issue(p.error);
  if (p.data.decision !== "approve" && !p.data.note) return { error: "Give the reason, so the Project Manager knows what to change." };
  return call(p.data.projectId, (s) => s.rpc("pbx_decide_budget", { p_version_id: p.data.versionId, p_decision: p.data.decision, p_note: p.data.note }), statusOf);
}

export async function reviseBudget(input: { projectId: string; versionId: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, versionId: uuid }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_revise_budget", { p_version_id: p.data.versionId }), idOf);
}

export async function requestAddition(input: { projectId: string; budgetId: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, budgetId: uuid }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_request_addition", { p_budget_id: p.data.budgetId }), idOf);
}

export async function discardDraft(input: { projectId: string; versionId: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, versionId: uuid }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_discard_draft", { p_version_id: p.data.versionId }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Funding
// ---------------------------------------------------------------------------------------------------------------------------------
export async function recordFunding(input: { projectId: string; budgetId: string; recipient: string; fundedOn: string; amount: string; method: string; isAdvance?: boolean | null; reference?: string | null; note?: string | null; requestId: string }): Promise<BudgetActionResult> {
  const p = z.object({
    projectId: uuid, budgetId: uuid, recipient: uuid, fundedOn: requiredDate, amount: decimal, method: z.enum(FUNDING_METHODS, { message: "Choose how the money was provided." }),
    isAdvance: z.boolean().nullish(), reference: optionalText(100), note: optionalText(500), requestId: uuid,
  }).safeParse(input);
  if (!p.success) return issue(p.error);
  const d = p.data;
  const amount = Number(d.amount);
  if (!d.amount || !Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  return call(
    d.projectId,
    (s) => s.rpc("pbx_record_funding", { p_budget_id: d.budgetId, p_recipient: d.recipient, p_funded_on: d.fundedOn, p_amount: amount, p_method: d.method, p_is_advance: d.isAdvance ?? null, p_reference: d.reference, p_note: d.note, p_request_id: d.requestId }),
    idOf,
  );
}

export async function reverseFunding(input: { projectId: string; fundingId: string; reason: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, fundingId: uuid, reason }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_reverse_funding", { p_funding_id: p.data.fundingId, p_reason: p.data.reason }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Actual expenses
// ---------------------------------------------------------------------------------------------------------------------------------
export async function startActuals(input: { projectId: string; budgetId: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, budgetId: uuid }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_start_actuals", { p_budget_id: p.data.budgetId }), idOf);
}

export async function reviseActuals(input: { projectId: string; submissionId: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, submissionId: uuid }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_revise_actuals", { p_submission_id: p.data.submissionId }), idOf);
}

const actualLine = z.object({
  budget_row_id: z.preprocess((v) => (v === "" || v == null ? null : v), uuid.nullable()),
  category_id: z.preprocess((v) => (v === "" || v == null ? null : v), uuid.nullable()),
  description: z.string().trim().max(300).optional(),
  /** null / "" = not entered. "0" = a confirmed zero. */
  actual_amount: optionalDecimal,
  paid_via: z.preprocess((v) => (v === "" || v == null ? null : v), z.enum(PAID_VIA).nullable()),
  paid_by_user_id: z.preprocess((v) => (v === "" || v == null ? null : v), uuid.nullable()),
  claim_id: z.preprocess((v) => (v === "" || v == null ? null : v), uuid.nullable()),
  foreign_currency: z.boolean().default(false),
  foreign_note: optionalText(500),
  note: optionalText(500),
});
export type ActualLineInput = z.input<typeof actualLine>;

export async function saveActualsDraft(input: { projectId: string; submissionId: string; expected: number; completeConfirmed: boolean; varianceNote: string | null; rows: ActualLineInput[] }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, submissionId: uuid, expected: version, completeConfirmed: z.boolean(), varianceNote: optionalText(2000), rows: z.array(actualLine).max(400, "There can be up to 400 lines.") }).safeParse(input);
  if (!p.success) return issue(p.error);
  const d = p.data;
  return call(
    d.projectId,
    (s) => s.rpc("pbx_save_actuals_draft", { p_submission_id: d.submissionId, p_expected: d.expected, p_header: { complete_confirmed: d.completeConfirmed, variance_note: d.varianceNote }, p_rows: d.rows }),
    versionOf,
  );
}

export async function submitActuals(input: { projectId: string; submissionId: string; expected: number; requestId: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, submissionId: uuid, expected: version, requestId: uuid }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_submit_actuals", { p_submission_id: p.data.submissionId, p_expected: p.data.expected, p_request_id: p.data.requestId }), idOf);
}

export async function decideActuals(input: { projectId?: string; submissionId: string; decision: "approve" | "return"; note?: string | null }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid.optional(), submissionId: uuid, decision: z.enum(["approve", "return"]), note: optionalText(1000) }).safeParse(input);
  if (!p.success) return issue(p.error);
  if (p.data.decision === "return" && !p.data.note) return { error: "Give the reason, so the Project Manager knows what to correct." };
  return call(p.data.projectId, (s) => s.rpc("pbx_decide_actuals", { p_submission_id: p.data.submissionId, p_decision: p.data.decision, p_note: p.data.note }), statusOf);
}

export async function returnApprovedActuals(input: { projectId: string; submissionId: string; reason: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, submissionId: uuid, reason }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_return_approved_actuals", { p_submission_id: p.data.submissionId, p_reason: p.data.reason }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Receipts, money returned / reimbursement paid, closing
// ---------------------------------------------------------------------------------------------------------------------------------
export async function recordReceipts(input: { projectId: string; budgetId: string; status: string; receivedOn?: string | null; exceptionReason?: string | null }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, budgetId: uuid, status: z.enum(RECEIPT_STATUSES, { message: "Choose the receipt status." }), receivedOn: dateText, exceptionReason: optionalText(1000) }).safeParse(input);
  if (!p.success) return issue(p.error);
  if (p.data.status === "exception" && !p.data.exceptionReason) return { error: "An exception needs a recorded reason." };
  return call(p.data.projectId, (s) => s.rpc("pbx_record_receipts", { p_budget_id: p.data.budgetId, p_status: p.data.status, p_received_on: p.data.receivedOn, p_exception_reason: p.data.exceptionReason }));
}

/** An independent CEO / CTO approver confirms the receipts of a settlement whose final expenses were submitted by someone with Finance access. */
export async function confirmReceipts(input: { projectId: string; budgetId: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, budgetId: uuid }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_confirm_receipts", { p_budget_id: p.data.budgetId }));
}

export async function recordPayment(input: { projectId: string; budgetId: string; kind: string; person: string; amount: string; paidOn: string; method: string; reference?: string | null; note?: string | null; requestId: string }): Promise<BudgetActionResult> {
  const p = z.object({
    projectId: uuid, budgetId: uuid, kind: z.enum(PAYMENT_KINDS, { message: "Choose whether this is money returned or a reimbursement." }), person: uuid, amount: decimal, paidOn: requiredDate,
    method: z.enum(FUNDING_METHODS, { message: "Choose how it was paid." }), reference: optionalText(100), note: optionalText(500), requestId: uuid,
  }).safeParse(input);
  if (!p.success) return issue(p.error);
  const d = p.data;
  const amount = Number(d.amount);
  if (!d.amount || !Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  return call(
    d.projectId,
    (s) => s.rpc("pbx_record_payment", { p_budget_id: d.budgetId, p_kind: d.kind, p_person: d.person, p_amount: amount, p_paid_on: d.paidOn, p_method: d.method, p_reference: d.reference, p_note: d.note, p_request_id: d.requestId }),
    idOf,
  );
}

export async function reversePayment(input: { projectId: string; paymentId: string; reason: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, paymentId: uuid, reason }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_reverse_payment", { p_payment_id: p.data.paymentId, p_reason: p.data.reason }));
}

export async function closeSettlement(input: { projectId: string; budgetId: string; note?: string | null }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, budgetId: uuid, note: optionalText(1000) }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_close_settlement", { p_budget_id: p.data.budgetId, p_note: p.data.note }));
}

export async function reopenSettlement(input: { projectId: string; budgetId: string; reason: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid, budgetId: uuid, reason }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_reopen_settlement", { p_budget_id: p.data.budgetId, p_reason: p.data.reason }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Finance set-up: rates and categories
// ---------------------------------------------------------------------------------------------------------------------------------
export async function setBudgetRate(input: { projectId?: string; companyId: string; currency: string; rateKey: string; amount: string; note?: string | null }): Promise<BudgetActionResult> {
  const p = z.object({
    projectId: uuid.optional(), companyId: uuid, currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code."), rateKey: z.enum(RATE_KEYS, { message: "Choose the rate." }), amount: decimal, note: optionalText(300),
  }).safeParse(input);
  if (!p.success) return issue(p.error);
  const amount = Number(p.data.amount);
  if (!p.data.amount || !Number.isFinite(amount) || amount < 0) return { error: "Enter the rate as a number, zero or more." };
  return call(p.data.projectId, (s) => s.rpc("pbx_set_rate", { p_company_id: p.data.companyId, p_currency: p.data.currency, p_rate_key: p.data.rateKey, p_amount: amount, p_note: p.data.note }), idOf);
}

export async function addBudgetCategory(input: { projectId?: string; companyId: string; label: string }): Promise<BudgetActionResult> {
  const p = z.object({ projectId: uuid.optional(), companyId: uuid, label: z.string().trim().min(2, "Give the category a name.").max(60, "Keep the name to 60 characters.") }).safeParse(input);
  if (!p.success) return issue(p.error);
  return call(p.data.projectId, (s) => s.rpc("pbx_add_category", { p_company_id: p.data.companyId, p_label: p.data.label }), idOf);
}
