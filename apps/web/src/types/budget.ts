/**
 * Project Budget & Expenses: the shapes the three read functions return (pbx_budget_view, pbx_inbox, pbx_project_access).
 * Money arrives as JSON numbers already rounded by the database to the budget currency; the page only formats it (see moneyText in
 * @enginious-hr/domain) and never recalculates a stored figure.
 */
import type { BudgetBasis, BudgetActivity, FundingMethod, PaidVia, PaymentKind, ReceiptStatus, VersionStatus } from "@enginious-hr/domain";

export type PbxReadOnlyTable<Row> = { Row: Row; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };

export type PbxCompanyGrantRow = {
  id: string; user_id: string; company_id: string; capabilities: string[]; note: string | null;
  granted_by: string | null; granted_at: string; revoked_at: string | null; revoked_by: string | null;
};

export type PbxJson = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface PbxProjectAccess {
  can_open: boolean;
  is_pm?: boolean;
  has_budget?: boolean;
  budget_id?: string | null;
}

export interface PbxViewer {
  user_id: string;
  is_pm: boolean;
  is_finance: boolean;
  is_view_only: boolean;
  /** PM, Finance or a view grantee: everything. False for a former PM who only sees what they submitted. */
  is_full_reader: boolean;
}

export interface PbxProject {
  id: string;
  reference: string;
  name: string;
  company_id: string;
  company_name: string | null;
  pm_user_id: string | null;
  pm_name: string | null;
  location: string | null;
  site_timezone: string | null;
  start: string | null;
  end: string | null;
  install_start: string | null;
  event_start: string | null;
  event_end: string | null;
  status: string;
}

export interface PbxBudgetHeader {
  id: string;
  currency: string;
  receipts_status: ReceiptStatus;
  receipts_received_on: string | null;
  receipts_exception_reason: string | null;
  receipts_recorded_by_name: string | null;
  receipts_recorded_at: string | null;
  settlement_status: "open" | "closed";
  settlement_closed_at: string | null;
  settlement_closed_by_name: string | null;
  settlement_note: string | null;
  row_version: number;
}

export interface PbxBudgetRow {
  id: string;
  sort_no: number;
  category_id: string | null;
  category_key: string;
  category_label: string;
  date_from: string | null;
  date_to: string | null;
  activity: BudgetActivity;
  description: string;
  basis: BudgetBasis;
  people: number | null;
  days: number | null;
  qty: number | null;
  rate: number | null;
  fixed: number | null;
  rate_key: string | null;
  configured_rate: number | null;
  total: number;
}

export interface PbxVersion {
  id: string;
  kind: "original" | "addition";
  seq: number;
  status: VersionStatus;
  parent_version_id: string | null;
  period_start: string | null;
  period_end: string | null;
  note: string | null;
  total: number;
  row_version: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  submitted_by: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  on_hold: boolean;
  i_can_decide: boolean;
  people: { id: string; name: string }[];
  rows: PbxBudgetRow[];
}

export interface PbxActualRow {
  id: string;
  sort_no: number;
  budget_row_id: string | null;
  line_no: number;
  category_key: string;
  category_label: string;
  description: string;
  approved_amount: number;
  /** null = not entered yet. A confirmed zero is 0. */
  actual_amount: number | null;
  paid_via: PaidVia | null;
  paid_by_user_id: string | null;
  paid_by_name: string | null;
  claim_id: string | null;
  foreign_currency: boolean;
  foreign_note: string | null;
  note: string | null;
  unplanned: boolean;
}

export interface PbxActuals {
  id: string;
  seq: number;
  status: VersionStatus;
  parent_submission_id: string | null;
  complete_confirmed: boolean;
  variance_note: string | null;
  total_actual: number;
  total_approved_budget: number;
  reopened_after_approval: boolean;
  row_version: number;
  created_by: string | null;
  created_by_name: string | null;
  submitted_by: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  on_hold: boolean;
  i_can_decide: boolean;
  rows: PbxActualRow[];
}

export interface PbxFunding {
  id: string;
  recipient_user_id: string;
  recipient_name: string;
  funded_on: string;
  amount: number;
  method: FundingMethod;
  is_advance: boolean;
  reference: string | null;
  note: string | null;
  status: "recorded" | "reversed";
  reversal_reason: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
  reversed_by_name: string | null;
  reversed_at: string | null;
}

export interface PbxPayment {
  id: string;
  kind: PaymentKind;
  person_user_id: string;
  person_name: string;
  amount: number;
  paid_on: string;
  method: string;
  reference: string | null;
  note: string | null;
  status: "recorded" | "reversed";
  reversal_reason: string | null;
  recorded_by_name: string | null;
  recorded_at: string;
  reversed_by_name: string | null;
  reversed_at: string | null;
}

export interface PbxPersonSettlement {
  user_id: string;
  name: string;
  advance_provided: number;
  advance_spent: number;
  returned: number;
  advance_balance: number;
  advance_to_return: number;
  advance_overspend: number;
  personal_spent: number;
  reimbursement_owed: number;
  reimbursement_paid: number;
  reimbursement_outstanding: number;
}

export interface PbxSettlement {
  currency: string;
  approved_budget: number;
  has_approved_actuals: boolean;
  approved_actual_total: number;
  advances_provided: number;
  card_allocations: number;
  advance_spent: number;
  company_card_spent: number;
  direct_paid: number;
  personal_spent: number;
  existing_claim_spent: number;
  returned: number;
  reimbursement_owed: number;
  reimbursement_paid: number;
  advance_to_return: number;
  reimbursement_outstanding: number;
  overpaid_reimbursement: boolean;
  per_person: PbxPersonSettlement[];
  blockers: string[];
}

export interface PbxCategory { id: string; key: string; label: string; is_default: boolean }
export interface PbxRate { rate_key: string; amount: number; currency: string }
export interface PbxPerson { id: string; name: string; role: string }

export interface PbxBudgetView {
  viewer: PbxViewer;
  project: PbxProject;
  default_currency: string | null;
  budget: PbxBudgetHeader | null;
  /** Total of the approved original plus approved additions. */
  baseline: number;
  versions: PbxVersion[];
  actuals: PbxActuals[];
  funding: PbxFunding[];
  payments: PbxPayment[];
  /** null for a reader who may not see funds or settlement. */
  settlement: PbxSettlement | null;
  categories: PbxCategory[];
  rates: PbxRate[];
  people: PbxPerson[];
}

export interface PbxInboxBase {
  budget_id: string;
  project_id: string;
  reference: string;
  name: string;
  company_id: string;
  company_name: string;
  currency: string;
  pm_name: string | null;
  site_timezone: string | null;
}
export interface PbxInboxBudget extends PbxInboxBase {
  version_id: string;
  kind: "original" | "addition";
  seq: number;
  total: number;
  submitted_at: string | null;
  submitted_by_name: string | null;
  on_hold: boolean;
  i_can_decide: boolean;
}
export interface PbxInboxActuals extends PbxInboxBase {
  submission_id: string;
  seq: number;
  total_actual: number;
  total_approved_budget: number;
  submitted_at: string | null;
  submitted_by_name: string | null;
  on_hold: boolean;
  i_can_decide: boolean;
}
export interface PbxInboxSettlement extends PbxInboxBase {
  receipts_status: ReceiptStatus;
  approved_budget: string | number | null;
  approved_actual_total: string | number | null;
  has_approved_actuals: boolean;
  advance_to_return: string | number | null;
  reimbursement_outstanding: string | number | null;
  advances_provided: string | number | null;
  next: string;
}
export interface PbxInbox {
  companies: { id: string; name: string; can_decide: boolean }[];
  budget_approvals: PbxInboxBudget[];
  final_expense_approvals: PbxInboxActuals[];
  outstanding_settlement: PbxInboxSettlement[];
  is_finance_anywhere: boolean;
}
