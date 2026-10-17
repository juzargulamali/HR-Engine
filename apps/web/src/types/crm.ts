/**
 * Row and argument types for Sales & CRM. Hand-written to match
 * supabase/migrations/20261115000000_crm_access_audit_settings.sql through 20261115000300_crm_proposals_files_reminders.sql
 * (see docs/09-extending-the-system.md). Every CRM table is read-only to clients (no INSERT/UPDATE/DELETE policy);
 * all writes are the crm_* functions typed in database.types.ts.
 */
import type { CrmCapability, CrmStageId } from "@enginious-hr/domain";

export type CrmCompanyGrantRow = {
  id: string;
  user_id: string;
  company_id: string;
  capabilities: CrmCapability[];
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  note: string | null;
}

export type CrmAuditLogRow = {
  id: number;
  table_name: string;
  row_id: string | null;
  company_id: string | null;
  action: "insert" | "update" | "delete";
  actor_id: string | null;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  created_at: string;
}

export type CrmCompanySettingsRow = {
  company_id: string;
  reference_code: string;
  default_quote_currency: string;
  response_target_hours: number | null;
  working_calendar: Record<string, unknown> | null;
  duplicate_window_days: number;
  approval_policy: "not_configured" | "not_required" | "required";
  approval_note: string | null;
  owner_email_enabled: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CrmOrganisationKind = "agency" | "client" | "direct";

export type CrmOrganisationRow = {
  id: string;
  name: string;
  name_key: string;
  kind: CrmOrganisationKind;
  place: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export type CrmContactRow = {
  id: string;
  organisation_id: string | null;
  name: string;
  role_title: string | null;
  email: string | null;
  email_key: string | null;
  phone: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export type CrmTechnology = {
  name: string;
  qty: number;
}

export type CrmOpportunityRow = {
  id: string;
  company_id: string;
  reference: string;
  title: string;
  brief: string | null;
  agency_org_id: string | null;
  client_org_id: string | null;
  source: string;
  owner_id: string;
  created_by: string;
  stage: CrmStageId;
  stage_changed_at: string;
  stage_before_hold: CrmStageId | null;
  waiting_on: "client" | "internal" | null;
  first_response_at: string | null;
  currency: string;
  value: number | string | null; // numeric(14,2) arrives as a string from PostgREST
  budget_note: string | null;
  payment_terms: string | null;
  event_start: string | null;
  event_end: string | null;
  install_start: string | null;
  location: string | null;
  technologies: CrmTechnology[];
  scope: string | null;
  exclusions: string | null;
  risks: string[];
  hold_reason: string | null;
  hold_review_date: string | null;
  lost_reason: string | null;
  evidence_type: "purchase_order" | "authorised_email" | null;
  evidence_reference: string | null;
  evidence_date: string | null;
  closed_at: string | null;
  closed_by: string | null;
  availability_state: "unverified" | "awaiting" | "confirmed" | "unavailable";
  availability_by: string | null;
  availability_at: string | null;
  availability_notes: string | null;
  availability_requested_by: string | null;
  availability_requested_at: string | null;
  availability_covers: {
    install_start: string | null;
    event_start: string | null;
    event_end: string | null;
    technologies: CrmTechnology[];
  } | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export type CrmOpportunityContactRow = {
  opportunity_id: string;
  contact_id: string;
  company_id: string;
  role: string | null;
}

export type CrmOpportunityEventRow = {
  id: string;
  opportunity_id: string;
  company_id: string;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
}

export type CrmActivityRow = {
  id: string;
  opportunity_id: string;
  company_id: string;
  kind: "call" | "email" | "meeting" | "note" | "client_response";
  body: string;
  is_internal: boolean;
  occurred_at: string;
  created_by: string;
  created_at: string;
}

export type CrmFollowUpRow = {
  id: string;
  opportunity_id: string;
  company_id: string;
  assigned_to: string;
  title: string;
  kind: "call" | "email" | "meeting" | "proposal" | "other";
  due_at: string;
  status: "open" | "done" | "cancelled";
  completed_at: string | null;
  completed_by: string | null;
  outcome: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type CrmFileRow = {
  id: string;
  opportunity_id: string;
  company_id: string;
  kind: "file" | "link";
  label: string | null;
  original_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  purpose: "proposal" | "purchase_order" | "authorised_email" | "brief" | "other";
  uploaded_by: string;
  created_at: string;
  deleted_at: string | null;
}

export type CrmProposalRow = {
  id: string;
  opportunity_id: string;
  company_id: string;
  version: number;
  status: "draft" | "sent" | "superseded" | "accepted";
  file_id: string | null;
  note: string | null;
  sent_on: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type CrmZohoReferenceRow = {
  opportunity_id: string;
  company_id: string;
  quote_ref: string | null;
  quote_sent_on: string | null;
  invoice_ref: string | null;
  invoice_issued_on: string | null;
  payment_received_on: string | null;
  paid_amount: number | string | null;
  updated_by: string | null;
  updated_at: string;
}

export type CrmApprovalRow = {
  id: string;
  opportunity_id: string;
  company_id: string;
  proposal_id: string | null;
  state: "pending" | "approved" | "changes_requested";
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  instruction: string | null;
}

export type CrmHandoverRow = {
  opportunity_id: string;
  company_id: string;
  pm_user_id: string | null;
  status: "draft" | "ready" | "handed_over";
  notes: string | null;
  prepared_by: string | null;
  prepared_at: string | null;
  handed_over_at: string | null;
  updated_at: string;
}

export type CrmReminderRow = {
  id: string;
  user_id: string;
  company_id: string;
  opportunity_id: string;
  follow_up_id: string | null;
  kind: "follow_up_due" | "follow_up_overdue" | "hold_review_due" | "no_next_action";
  title: string;
  due_at: string | null;
  dedupe_key: string;
  created_at: string;
  read_at: string | null;
  email_status: "not_requested" | "pending" | "sent" | "failed" | "skipped";
  email_attempts: number;
  email_next_attempt_at: string | null;
  email_last_error: string | null;
  email_sent_at: string | null;
}

export type CrmDuplicateCandidateRow = {
  opportunity_id: string;
  company_id: string;
  reference: string;
  title: string;
  stage: string;
  owner_id: string;
  agency_org_id: string | null;
  client_org_id: string | null;
  event_start: string | null;
  event_end: string | null;
  install_start: string | null;
  location: string | null;
  technologies: CrmTechnology[];
  created_at: string;
}

export type CrmReminderEmailClaim = {
  reminder_id: string;
  recipient_email: string;
  recipient_name: string | null;
  title: string;
  kind: string;
  opportunity_reference: string;
  opportunity_title: string;
  due_at: string | null;
  attempt: number;
}

export type CrmReadOnlyTable<Row> = { Row: Row; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };
