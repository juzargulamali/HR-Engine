/**
 * Project Budget & Expenses: the pure rules. No database, no clock, no I/O.
 *
 * The database is the source of truth for every figure that is stored or decided (see supabase/migrations/20261210*): it rounds with
 * pbx_round() and calculates row totals in a trigger, and `pbx_settlement_summary()` produces the settlement figures. This file
 * is the same arithmetic in TypeScript so a form can show a live total before saving, the page can describe states in words, and the
 * rules are unit-tested; a database test proves both give the same numbers for the same data.
 *
 * Money is never a JavaScript float here. Inputs are read as decimal strings into scaled BigInt integers, multiplied exactly and rounded
 * once, half away from zero, to the currency's own number of decimals. Amounts of different currencies are never added.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------------------------------------------
export const BUDGET_BASES = ["fixed", "per_person", "per_person_day", "per_trip", "per_km", "qty_rate"] as const;
export type BudgetBasis = (typeof BUDGET_BASES)[number];

export const BASIS_LABELS: Record<BudgetBasis, string> = {
  fixed: "Fixed total for the whole period",
  per_person: "Per person",
  per_person_day: "Per person per day",
  per_trip: "Per trip",
  per_km: "Per kilometre",
  qty_rate: "Quantity × rate",
};

/** Only the fields a calculation needs are shown and stored: `people`, `days`, `qty` (trips, kilometres or units), `rate`, `fixed` (an amount). */
export type BasisField = "people" | "days" | "qty" | "rate" | "fixed";
export const BASIS_FIELDS: Record<BudgetBasis, readonly BasisField[]> = {
  fixed: ["fixed"],
  per_person: ["people", "rate"],
  per_person_day: ["people", "days", "rate"],
  per_trip: ["qty", "rate"],
  per_km: ["qty", "rate"],
  qty_rate: ["qty", "rate"],
};

/** What the quantity means for a basis (the label of the `qty` input). */
export const QTY_LABELS: Partial<Record<BudgetBasis, string>> = { per_trip: "Trips", per_km: "Kilometres", qty_rate: "Quantity" };
export const RATE_LABELS: Record<BudgetBasis, string> = {
  fixed: "", per_person: "Rate per person", per_person_day: "Rate per person per day", per_trip: "Rate per trip", per_km: "Rate per km", qty_rate: "Rate",
};

export const ACTIVITIES = ["setup", "show", "dismantling", "other"] as const;
export type BudgetActivity = (typeof ACTIVITIES)[number];
export const ACTIVITY_LABELS: Record<BudgetActivity, string> = { setup: "Setup", show: "Show / event", dismantling: "Dismantling", other: "Other" };

export const DEFAULT_CATEGORIES = [
  { key: "food", label: "Food" },
  { key: "transport", label: "Transport" },
  { key: "badges", label: "Contractor badges / access" },
  { key: "accommodation", label: "Accommodation" },
  { key: "logistics", label: "Truck / logistics" },
  { key: "other", label: "Other expenses" },
] as const;

export const FUNDING_METHODS = ["cash", "bank_transfer", "pluto", "other"] as const;
export type FundingMethod = (typeof FUNDING_METHODS)[number];
export const FUNDING_METHOD_LABELS: Record<FundingMethod, string> = { cash: "Cash", bank_transfer: "Bank transfer", pluto: "Pluto", other: "Other" };

/** Cash, bank transfers and (when Finance says so) other funding are advances held by a person; a Pluto allocation or card limit never is. */
export function fundingIsAdvance(method: FundingMethod, otherIsAdvance?: boolean): boolean {
  if (method === "cash" || method === "bank_transfer") return true;
  if (method === "pluto") return false;
  return otherIsAdvance === true;
}

export const PAID_VIA = ["advance", "company_card", "direct_company", "personal", "existing_claim"] as const;
export type PaidVia = (typeof PAID_VIA)[number];
export const PAID_VIA_LABELS: Record<PaidVia, string> = {
  advance: "Paid from a cash / bank advance",
  company_card: "Company or Pluto card",
  direct_company: "Paid directly by the company",
  personal: "Paid personally, to be reimbursed",
  existing_claim: "Already in an employee claim",
};
/** Which payment sources need to say who paid. */
export const PAID_VIA_NEEDS_PERSON: Record<PaidVia, boolean> = { advance: true, company_card: false, direct_company: false, personal: true, existing_claim: false };

export const PAYMENT_KINDS = ["return", "reimbursement"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = { return: "Money returned to the company", reimbursement: "Reimbursement paid" };

export const RECEIPT_STATUSES = ["not_received", "partial", "received", "exception"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const RECEIPT_LABELS: Record<ReceiptStatus, string> = { not_received: "Not received", partial: "Partly received", received: "All received", exception: "Exception approved" };

export const VERSION_STATUSES = ["draft", "submitted", "returned", "rejected", "approved", "discarded"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: "Draft", submitted: "Waiting for Finance", returned: "Returned for changes", rejected: "Rejected", approved: "Approved", discarded: "Discarded",
};

/** A status pill tone for each state (the words always say the state). */
export function versionStatusTone(s: VersionStatus): "neutral" | "blue" | "amber" | "red" | "green" | "quiet" {
  return s === "draft" ? "neutral" : s === "submitted" ? "blue" : s === "returned" ? "amber" : s === "rejected" ? "red" : s === "approved" ? "green" : "quiet";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------------------------------------------------------------
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
export const CURRENCY_FORMAT = /^[A-Z]{3}$/;

/** Number of decimals of the currency's smallest unit (mirrors pbx_currency_decimals()). */
export function currencyDecimals(code: string): number {
  const c = code.toUpperCase();
  return ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Exact decimal arithmetic (scaled BigInt)
// ---------------------------------------------------------------------------------------------------------------------------------
interface Dec { n: bigint; s: number } // value = n / 10^s

/** A decimal from user input: a finite non-negative number or a plain decimal string. Anything else (blank, NaN, 1e5) is "not entered" (null). */
export function parseDecimal(v: string | number | null | undefined): Dec | null {
  if (v === null || v === undefined) return null;
  const text = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v.trim();
  const plain = /e/i.test(text) && typeof v === "number" ? v.toFixed(12).replace(/0+$/, "").replace(/\.$/, "") : text;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(plain);
  if (!m) return null;
  const frac = m[3] ?? "";
  const n = BigInt(m[2] + frac) * (m[1] === "-" ? -1n : 1n);
  return { n, s: frac.length };
}
const mulDec = (a: Dec, b: Dec): Dec => ({ n: a.n * b.n, s: a.s + b.s });
const pow10 = (e: number): bigint => 10n ** BigInt(e);

/** Rounds to `decimals` places, half away from zero; the result is the amount in the smallest unit (an integer). */
function toMinorUnits(d: Dec, decimals: number): bigint {
  if (d.s <= decimals) return d.n * pow10(decimals - d.s);
  const div = pow10(d.s - decimals);
  const abs = d.n < 0n ? -d.n : d.n;
  const q = abs / div;
  const r = abs % div;
  const up = r * 2n >= div ? q + 1n : q;
  return d.n < 0n ? -up : up;
}
const minorToNumber = (m: bigint, decimals: number): number => Number(m) / 10 ** decimals;

/** The amount rounded to the currency's decimals (the stored value). Invalid input gives null. */
export function roundMoney(v: string | number | null | undefined, currency: string): number | null {
  const d = parseDecimal(v);
  if (!d) return null;
  const dec = currencyDecimals(currency);
  return minorToNumber(toMinorUnits(d, dec), dec);
}

/** Exact sum of already-rounded amounts in the currency's smallest unit, so no float drift accumulates. */
export function sumMoney(values: readonly (number | string | null | undefined)[], currency: string): number {
  const dec = currencyDecimals(currency);
  let total = 0n;
  for (const v of values) {
    const d = parseDecimal(v);
    if (d) total += toMinorUnits(d, dec);
  }
  return minorToNumber(total, dec);
}

/** Subtracts exactly, in the smallest unit. */
export function subMoney(a: number | string, b: number | string, currency: string): number {
  const dec = currencyDecimals(currency);
  const x = parseDecimal(a), y = parseDecimal(b);
  return minorToNumber((x ? toMinorUnits(x, dec) : 0n) - (y ? toMinorUnits(y, dec) : 0n), dec);
}

/** "AED 1,050.00": the currency's own decimals, the code always shown (no symbol that could be mistaken for another currency). */
export function moneyText(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  const dec = currencyDecimals(currency);
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Row totals
// ---------------------------------------------------------------------------------------------------------------------------------
export interface RowInputs {
  basis: BudgetBasis;
  people?: string | number | null;
  days?: string | number | null;
  qty?: string | number | null;
  rate?: string | number | null;
  fixed?: string | number | null;
}

/**
 * The total of one budget row, or null while a field the basis needs is missing or invalid. Examples (AED):
 *   food 3 people × 2 days × 60        per_person_day -> 360
 *   petrol 60 km × 0.50                per_km         -> 30
 *   metro 30 for 20-22 October         fixed          -> 30   (a fixed total covers the whole period; it is never multiplied by days)
 *   truck 3 trips × 350                per_trip       -> 1,050
 */
export function rowTotal(row: RowInputs, currency: string): number | null {
  const need = BASIS_FIELDS[row.basis];
  const vals: Partial<Record<BasisField, Dec>> = {};
  for (const f of need) {
    const d = parseDecimal(row[f]);
    if (!d || d.n < 0n) return null;
    vals[f] = d;
  }
  let acc: Dec;
  if (row.basis === "fixed") acc = vals.fixed!;
  else {
    acc = need.map((f) => vals[f]!).reduce(mulDec);
  }
  const dec = currencyDecimals(currency);
  return minorToNumber(toMinorUnits(acc, dec), dec);
}

/** Inclusive number of calendar days between two ISO dates (a single date, or no end date, is one day). Null when a date is invalid or reversed. */
export function inclusiveDays(from: string | null | undefined, to?: string | null): number | null {
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  const end = to && to !== "" ? to : from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

export interface CategoryRow { category: string; total: number | null }
/** Subtotals per category, in the order the categories are given (unknown categories after, in first-seen order). */
export function categorySubtotals(rows: readonly CategoryRow[], currency: string, order: readonly string[] = DEFAULT_CATEGORIES.map((c) => c.key)): { category: string; total: number; rows: number }[] {
  const seen = new Map<string, (number | null)[]>();
  for (const r of rows) seen.set(r.category, [...(seen.get(r.category) ?? []), r.total]);
  const keys = [...order.filter((k) => seen.has(k)), ...[...seen.keys()].filter((k) => !order.includes(k))];
  return keys.map((k) => ({ category: k, total: sumMoney(seen.get(k)!, currency), rows: seen.get(k)!.length }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Company rates (petrol per km, meal per person)
// ---------------------------------------------------------------------------------------------------------------------------------
export const RATE_KEYS = ["petrol_per_km", "meal_per_person"] as const;
export type RateKey = (typeof RATE_KEYS)[number];
export const RATE_LABELS_BY_KEY: Record<RateKey, string> = { petrol_per_km: "Petrol, per kilometre", meal_per_person: "Meal, per person" };

/**
 * Initial suggestions only, and only for AED, subject to Finance confirmation: the application never applies a number to SAR, EUR or any
 * other currency, and a suggestion is never stored as if Finance had confirmed it.
 */
export function suggestedRate(currency: string, key: RateKey): number | null {
  if (currency.toUpperCase() !== "AED") return null;
  return key === "petrol_per_km" ? 0.5 : key === "meal_per_person" ? 30 : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Variance
// ---------------------------------------------------------------------------------------------------------------------------------
/** Actual − approved budget. Positive is over budget, negative under, zero on budget. */
export function expenseVariance(actual: number, approved: number, currency: string): { amount: number; kind: "over" | "under" | "on" } {
  const amount = subMoney(actual, approved, currency);
  return { amount, kind: amount > 0 ? "over" : amount < 0 ? "under" : "on" };
}
export function varianceLabel(actual: number, approved: number, currency: string): string {
  const v = expenseVariance(actual, approved, currency);
  return v.kind === "on" ? "On budget" : `${v.kind === "over" ? "Over" : "Under"} budget by ${moneyText(Math.abs(v.amount), currency)}`;
}

export const MATERIAL_VARIANCE_PERCENT = 10;
/** A note is asked for when the total differs from the approved budget by more than 10 %, or anything was spent against a zero budget. */
export function requiresVarianceNote(approvedTotal: number, actualTotal: number, currency: string): boolean {
  const dec = currencyDecimals(currency);
  const a = toMinorUnits(parseDecimal(approvedTotal)!, dec), b = toMinorUnits(parseDecimal(actualTotal)!, dec);
  const diff = b > a ? b - a : a - b;
  if (a === 0n) return b > 0n;
  return diff * 100n > a * BigInt(MATERIAL_VARIANCE_PERCENT);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Settlement figures (the same arithmetic as pbx_settlement_summary)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface FundingEntry { recipient: string; amount: number; isAdvance: boolean }
export interface ActualLine { paidVia: PaidVia; paidBy: string | null; amount: number | null }
export interface PaymentEntry { kind: PaymentKind; person: string; amount: number }

export interface PersonSettlement {
  person: string;
  advanceProvided: number;
  advanceSpent: number;
  returned: number;
  /** provided − returned − spent: positive means this person still holds unspent advance money; negative means they spent more than they were given. */
  advanceBalance: number;
  /** What this person still has to return (the positive part of the balance). */
  advanceToReturn: number;
  /** Spending beyond their advance: they paid it themselves, so it is owed back to them. */
  advanceOverspend: number;
  personalSpent: number;
  reimbursementOwed: number;
  reimbursementPaid: number;
  /** owed − paid; negative means more was paid than is owed. */
  reimbursementOutstanding: number;
}

export interface SettlementFigures {
  currency: string;
  approvedActualTotal: number;
  advancesProvided: number;
  cardAllocations: number;
  advanceSpent: number;
  companyCardSpent: number;
  directPaid: number;
  personalSpent: number;
  existingClaimSpent: number;
  returned: number;
  reimbursementOwed: number;
  reimbursementPaid: number;
  advanceToReturn: number;
  reimbursementOutstanding: number;
  perPerson: PersonSettlement[];
  /** Lines still blank (not entered): never counted as zero. */
  blankLines: number;
}

/**
 * Per-source reconciliation. Personal advances, company-card spending, direct company payments and personally paid expenses are four
 * different things, so spending is never simply subtracted from all funding. A Pluto allocation is not an advance and is never owed back.
 * Lines that are already in an employee claim count as project expense but take no part in any balance here.
 */
export function settlementFigures(currency: string, funding: readonly FundingEntry[], actuals: readonly ActualLine[], payments: readonly PaymentEntry[]): SettlementFigures {
  const dec = currencyDecimals(currency);
  const minor = (v: number | null | undefined): bigint => { const d = parseDecimal(v ?? 0); return d ? toMinorUnits(d, dec) : 0n; };
  const people = new Set<string>();
  const map = <T,>(pick: (p: string) => T) => [...people].map(pick);
  for (const f of funding) if (f.isAdvance) people.add(f.recipient);
  for (const a of actuals) if (a.paidBy && (a.paidVia === "advance" || a.paidVia === "personal")) people.add(a.paidBy);
  for (const p of payments) people.add(p.person);

  const sum = (rows: readonly { v: bigint }[]) => rows.reduce((n, r) => n + r.v, 0n);
  const per: PersonSettlement[] = map((p) => {
    const provided = sum(funding.filter((f) => f.isAdvance && f.recipient === p).map((f) => ({ v: minor(f.amount) })));
    const spent = sum(actuals.filter((a) => a.paidVia === "advance" && a.paidBy === p).map((a) => ({ v: minor(a.amount) })));
    const personal = sum(actuals.filter((a) => a.paidVia === "personal" && a.paidBy === p).map((a) => ({ v: minor(a.amount) })));
    const returned = sum(payments.filter((x) => x.kind === "return" && x.person === p).map((x) => ({ v: minor(x.amount) })));
    const paid = sum(payments.filter((x) => x.kind === "reimbursement" && x.person === p).map((x) => ({ v: minor(x.amount) })));
    const balance = provided - returned - spent;
    const over = balance < 0n ? -balance : 0n;
    const owed = personal + over;
    const n = (m: bigint) => minorToNumber(m, dec);
    return {
      person: p, advanceProvided: n(provided), advanceSpent: n(spent), returned: n(returned), advanceBalance: n(balance),
      advanceToReturn: n(balance > 0n ? balance : 0n), advanceOverspend: n(over), personalSpent: n(personal),
      reimbursementOwed: n(owed), reimbursementPaid: n(paid), reimbursementOutstanding: n(owed - paid),
    };
  }).sort((a, b) => a.person.localeCompare(b.person));

  const by = (via: PaidVia) => actuals.filter((a) => a.paidVia === via).map((a) => ({ v: minor(a.amount) }));
  const n = (m: bigint) => minorToNumber(m, dec);
  const sumOf = (pick: (p: PersonSettlement) => number) => sumMoney(per.map(pick), currency);
  return {
    currency,
    approvedActualTotal: n(sum(actuals.map((a) => ({ v: minor(a.amount) })))),
    advancesProvided: n(sum(funding.filter((f) => f.isAdvance).map((f) => ({ v: minor(f.amount) })))),
    cardAllocations: n(sum(funding.filter((f) => !f.isAdvance).map((f) => ({ v: minor(f.amount) })))),
    advanceSpent: n(sum(by("advance"))),
    companyCardSpent: n(sum(by("company_card"))),
    directPaid: n(sum(by("direct_company"))),
    personalSpent: n(sum(by("personal"))),
    existingClaimSpent: n(sum(by("existing_claim"))),
    returned: sumOf((p) => p.returned),
    reimbursementOwed: sumOf((p) => p.reimbursementOwed),
    reimbursementPaid: sumOf((p) => p.reimbursementPaid),
    advanceToReturn: sumOf((p) => p.advanceToReturn),
    reimbursementOutstanding: sumMoney(per.map((p) => (p.reimbursementOutstanding > 0 ? p.reimbursementOutstanding : 0)), currency),
    perPerson: per,
    blankLines: actuals.filter((a) => a.amount === null || a.amount === undefined).length,
  };
}

export interface CloseState {
  hasApprovedActuals: boolean;
  actualsAwaitingDecision: boolean;
  budgetAwaitingDecision: boolean;
  receipts: ReceiptStatus;
  receiptExceptionReason: string | null;
  advanceToReturn: number;
  reimbursementOutstanding: number;
  overpaidReimbursement: boolean;
  settlementClosed: boolean;
}

/** The reasons settlement cannot be closed yet, in plain words (empty when it can). Mirrors pbx_close_settlement. */
export function settlementBlockers(s: CloseState, currency: string): string[] {
  const out: string[] = [];
  if (s.settlementClosed) return ["Settlement is already closed."];
  if (!s.hasApprovedActuals) out.push("The final expenses are not approved yet.");
  if (s.actualsAwaitingDecision) out.push("Final expenses are waiting for a Finance decision.");
  if (s.budgetAwaitingDecision) out.push("A budget request is waiting for a Finance decision.");
  if (s.receipts === "not_received" || s.receipts === "partial") out.push("Finance has not confirmed that the physical receipts were received (or recorded an approved exception).");
  if (s.receipts === "exception" && !(s.receiptExceptionReason ?? "").trim()) out.push("The receipt exception needs a recorded reason.");
  if (s.advanceToReturn > 0) out.push(`${moneyText(s.advanceToReturn, currency)} of advance money has not been returned.`);
  if (s.reimbursementOutstanding > 0) out.push(`${moneyText(s.reimbursementOutstanding, currency)} of reimbursement is still owed.`);
  if (s.overpaidReimbursement) out.push("A reimbursement was paid beyond what is owed: reverse the overpayment.");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Approval routing (the database enforces it; this is the same rule in words and for tests)
// ---------------------------------------------------------------------------------------------------------------------------------
export type ApprovalRoute = "finance" | "executive";
export const APPROVAL_ROUTES = ["finance", "executive"] as const;

/** Fixed when something is submitted: a submitter who holds Finance access for the company (even as the PM) is approved by the company's CEO/CTO approvers; anyone else by Finance. */
export function approvalRouteFor(submitterHoldsFinance: boolean): ApprovalRoute {
  return submitterHoldsFinance ? "executive" : "finance";
}
export const APPROVER_NAME: Record<ApprovalRoute, string> = { finance: "Finance", executive: "the CEO or CTO" };
/** Why the item goes where it goes, in one sentence for the page. */
export function routeExplanation(route: ApprovalRoute): string {
  return route === "executive"
    ? "Submitted by someone with Finance access, so the company's CEO or CTO approver decides it (either one is enough)."
    : "Decided by Finance.";
}
/** The hold message: nobody eligible and independent exists for the route. Nothing is approved or lost. */
export function holdExplanation(route: ApprovalRoute, submitterName: string | null): string {
  const who = submitterName ?? "the submitter";
  return route === "executive"
    ? `On hold: ${who} has Finance access, so a CEO or CTO approver of this company must decide it, and none other than ${who} is authorised yet. The owner needs to give a CEO or CTO approver access for this company.`
    : `On hold: no Finance person other than ${who} is authorised for this company. Nothing was approved or lost; it can be decided once an authorised Finance person exists.`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The next required action (what the page puts first)
// ---------------------------------------------------------------------------------------------------------------------------------
export type Viewer = "pm" | "finance" | "viewer";
export interface BudgetFlowState {
  hasBudget: boolean;
  /** Status of the latest budget version that is not discarded. */
  latestBudget: VersionStatus | null;
  latestBudgetKind: "original" | "addition" | null;
  hasApprovedBaseline: boolean;
  /** An approval is waiting but nobody independent of the submitter can decide it. */
  approvalOnHold: boolean;
  /** Who decides the submission that is waiting (defaults to Finance). */
  approvalRoute?: ApprovalRoute;
  actuals: VersionStatus | null;
  approvedActuals: boolean;
  fundingRecorded: boolean;
  receipts: ReceiptStatus;
  settlementClosed: boolean;
  blockers: string[];
}
export interface NextAction { who: "pm" | "finance" | "executive" | "nobody"; text: string; section: "budget" | "funds" | "actuals" | "settlement" }

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** One sentence naming who has to do what next. Pure and tested; the page highlights the matching section. */
export function nextAction(s: BudgetFlowState): NextAction {
  if (s.settlementClosed) return { who: "nobody", text: "Settlement is closed. Nothing more is needed.", section: "settlement" };
  if (!s.hasBudget || s.latestBudget === null) return { who: "pm", text: "The Project Manager creates the budget.", section: "budget" };
  if (s.latestBudget === "draft") return { who: "pm", text: s.latestBudgetKind === "addition" ? "The Project Manager finishes the additional budget request and submits it to Finance." : "The Project Manager finishes the budget and submits it to Finance.", section: "budget" };
  const approver = s.approvalRoute === "executive" ? "the CEO or CTO approver" : "Finance";
  if (s.latestBudget === "submitted") {
    return s.approvalOnHold
      ? { who: "nobody", text: "On hold: no independent approver is available to decide this budget.", section: "budget" }
      : { who: s.approvalRoute === "executive" ? "executive" : "finance", text: s.latestBudgetKind === "addition" ? `${cap(approver)} decides the additional budget request.` : `${cap(approver)} approves, returns or rejects the budget.`, section: "budget" };
  }
  if ((s.latestBudget === "returned" || s.latestBudget === "rejected") && !s.hasApprovedBaseline) return { who: "pm", text: s.latestBudget === "returned" ? "The Project Manager changes the budget as Finance asked and submits it again." : "The budget was rejected. The Project Manager may prepare a new version.", section: "budget" };
  if (!s.hasApprovedBaseline) return { who: "pm", text: "The Project Manager creates the budget.", section: "budget" };
  if (!s.fundingRecorded && s.actuals === null) return { who: "finance", text: "Finance records the funds provided (if any), or the Project Manager enters the actual expenses after the project.", section: "funds" };
  if (s.actuals === null || s.actuals === "draft" || s.actuals === "returned") return { who: "pm", text: s.actuals === "returned" ? "The Project Manager corrects the actual expenses as Finance asked and submits them again." : "The Project Manager enters the actual expenses and submits them.", section: "actuals" };
  if (s.actuals === "submitted") return s.approvalOnHold ? { who: "nobody", text: "On hold: no independent approver is available to decide the final expenses.", section: "actuals" } : { who: s.approvalRoute === "executive" ? "executive" : "finance", text: `${cap(approver)} reviews and approves (or returns) the final expenses.`, section: "actuals" };
  if (s.receipts === "not_received" || s.receipts === "partial") return { who: "finance", text: "Finance records that the physical receipts were received (or an approved exception).", section: "settlement" };
  return s.blockers.length > 0 ? { who: "finance", text: `Finance settles the difference: ${s.blockers[0]}`, section: "settlement" } : { who: "finance", text: "Finance confirms the reconciliation and closes settlement.", section: "settlement" };
}
