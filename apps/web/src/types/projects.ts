/**
 * Row and argument types for Projects & Tasks. Hand-written to match supabase/migrations/20261120000000_proj_access_audit.sql
 * through 20261120000500_proj_feedback_plans_files_completion.sql (see docs/09-extending-the-system.md). Every proj_ table is
 * read-only to clients (no INSERT/UPDATE/DELETE policy); all writes are the proj_* functions typed in database.types.ts.
 */
import type { ProjCapability } from "@enginious-hr/domain";

export type ProjReadOnlyTable<Row> = { Row: Row; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };

export type ProjCompanyGrantRow = {
  id: string; user_id: string; company_id: string; capabilities: ProjCapability[]; note: string | null;
  granted_by: string | null; granted_at: string; revoked_at: string | null; revoked_by: string | null;
}
export type ProjAuditLogRow = {
  id: number; table_name: string; row_id: string | null; company_id: string | null; action: "insert" | "update" | "delete";
  actor_id: string | null; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null; created_at: string;
}
export type ProjCompanySettingsRow = { company_id: string; reference_code: string; updated_by: string | null; created_at: string; updated_at: string }

export type ProjProjectRow = {
  id: string; company_id: string; reference: string; name: string; kind: "client" | "internal"; status: string; priority: string;
  pm_user_id: string; is_ongoing: boolean; start_date: string | null; end_date: string | null; crm_opportunity_id: string | null;
  handover_id: string | null; created_by: string; version: number; created_at: string; updated_at: string; completed_at: string | null; archived_at: string | null;
}
export type ProjProjectDetailsRow = {
  project_id: string; client_name: string | null; location: string | null; site_timezone: string; install_start: string | null;
  event_start: string | null; event_end: string | null; scope: string | null; exclusions: string | null;
  technologies: { name: string; qty: number }[]; risks: unknown[]; hold_reason: string | null; hold_review_date: string | null;
  status_before_hold: string | null; updated_at: string;
}
export type ProjTeamRow = { id: string; project_id: string; name: string; department_id: string | null; head_user_id: string; created_by: string | null; created_at: string; removed_at: string | null }
export type ProjMemberRow = {
  id: string; project_id: string; user_id: string; role: "pm" | "acting_pm" | "member"; team_id: string | null; acting_until: string | null;
  added_by: string | null; added_at: string; removed_at: string | null; removed_by: string | null; removal_reason: string | null;
}
export type ProjSalesLinkRow = { id: string; project_id: string; user_id: string; source: "handover_owner" | "handover_preparer" | "added"; added_by: string | null; added_at: string; removed_at: string | null }
export type ProjHandoverRow = {
  id: string; company_id: string; crm_opportunity_id: string; crm_reference: string; status: string; prepared_by: string; sales_owner_id: string;
  title: string; client_name: string | null; location: string | null; site_timezone: string; install_start: string | null; event_start: string | null; event_end: string | null;
  technologies: { name: string; qty: number }[]; scope: string | null; exclusions: string | null; risks: unknown[]; notes: string | null;
  pm_user_id: string | null; pm_assigned_by: string | null; pm_assigned_at: string | null; clarification_note: string | null; clarification_requested_at: string | null;
  clarification_requested_by: string | null; submitted_at: string | null; accepted_by: string | null; accepted_at: string | null; project_id: string | null;
  revision: number; version: number; created_at: string; updated_at: string;
}
export type ProjMilestoneRow = {
  id: string; project_id: string; title: string; description: string | null; due_date: string | null; is_required: boolean; client_facing: boolean;
  status: string; sort_order: number; accepted_by: string | null; accepted_at: string | null; created_by: string | null; version: number; created_at: string; updated_at: string;
}
export type ProjDeliverableRow = {
  id: string; project_id: string; milestone_id: string | null; team_id: string | null; title: string; description: string | null; due_date: string | null;
  status: string; accepted_by: string | null; accepted_at: string | null; created_by: string | null; version: number; created_at: string; updated_at: string;
}
export type ProjTaskRow = {
  id: string; project_id: string; deliverable_id: string | null; milestone_id: string | null; team_id: string | null; title: string; description: string | null;
  assignee_id: string; priority: string; start_date: string | null; due_date: string | null; status: string; requires_review: boolean;
  blocked_at: string | null; blocked_reason: string | null; unblock_owner_id: string | null; unblock_action: string | null;
  completed_at: string | null; completed_by: string | null; created_by: string; version: number; created_at: string; updated_at: string;
}
export type ProjTaskCollaboratorRow = { task_id: string; user_id: string; project_id: string; added_at: string }
export type ProjTaskDependencyRow = { task_id: string; depends_on_task_id: string; project_id: string }
export type ProjTaskEventRow = { id: number; task_id: string; project_id: string; actor_id: string | null; kind: string; from_value: string | null; to_value: string | null; note: string | null; created_at: string }
export type ProjTaskCommentRow = { id: string; task_id: string; project_id: string; author_id: string; body: string; created_at: string; edited_at: string | null }
export type ProjChangeLogRow = {
  id: number; project_id: string; entity_type: string; entity_id: string; field: string; from_value: string | null; to_value: string | null;
  note: string | null; actor_id: string | null; created_at: string;
}
export type ProjPlanItemRow = {
  id: string; project_id: string; plan: "delivery" | "site"; template_key: string | null; title: string; start_date: string | null; end_date: string | null;
  starts_at: string | null; ends_at: string | null; tz: string | null; status: string; client_facing: boolean; milestone_id: string | null; notes: string | null;
  sort_order: number; created_by: string | null; version: number; created_at: string; updated_at: string;
}
export type ProjExternalDependencyRow = {
  id: string; project_id: string; kind: string; label: string; expected_date: string | null; expected_time: string | null; organisation: string | null;
  contact: string | null; confirmation: string; confirmed_at: string | null; confirmed_by: string | null; milestone_id: string | null; client_facing: boolean;
  notes: string | null; created_by: string | null; version: number; created_at: string; updated_at: string;
}
export type ProjSiteBookingRow = {
  id: string; project_id: string; user_id: string; plan_item_id: string | null; location: string; starts_at: string; ends_at: string; tz: string;
  lead_minutes: number; trail_minutes: number; state: string; confirmed_by: string | null; confirmed_at: string | null; override_reason: string | null;
  override_by: string | null; cancel_reason: string | null; notes: string | null; created_by: string | null; version: number; created_at: string; updated_at: string;
}
export type ProjMessageRow = {
  id: string; seq: number; project_id: string; author_id: string; parent_id: string | null; body: string; client_nonce: string | null;
  created_at: string; edited_at: string | null; deleted_at: string | null; deleted_by: string | null; changed_at: string;
}
export type ProjMessageMentionRow = { message_id: string; user_id: string; project_id: string }
export type ProjMessageTombstoneRow = { message_id: string; project_id: string; original_body: string; deleted_by: string | null; reason: string | null; deleted_at: string }
export type ProjReadStateRow = { project_id: string; user_id: string; last_read_seq: number; last_read_at: string }
export type ProjFileRow = {
  id: string; project_id: string; kind: "file" | "link"; purpose: string; label: string | null; original_name: string | null; storage_path: string | null;
  mime_type: string | null; size_bytes: number | null; url: string | null; restricted: boolean; uploaded_by: string; created_at: string; deleted_at: string | null;
}
export type ProjFeedbackRow = {
  id: string; project_id: string; target_type: string; target_id: string | null; source: string; received_on: string; request_text: string;
  kind: "in_scope_correction" | "proposed_change"; responsible_user_id: string | null; due_date: string | null; status: string; resolution: string | null;
  evidence_note: string | null; resolved_at: string | null; resolved_by: string | null; scope_change_id: string | null; created_by: string | null;
  version: number; created_at: string; updated_at: string;
}
export type ProjScopeChangeRow = {
  id: string; project_id: string; feedback_id: string | null; title: string; original_scope: string | null; base_scope_hash: string; proposed_scope: string;
  effect_on_dates: string | null; status: string; proposed_by: string; proposed_at: string; decided_by: string | null; decided_at: string | null;
  decision_note: string | null; created_at: string;
}
export type ProjScopeChangeCommercialRow = { scope_change_id: string; project_id: string; currency: string | null; amount: number | null; note: string | null; updated_by: string | null; updated_at: string }
export type ProjIssuedPlanRow = {
  id: string; project_id: string; version: number; client_reference: string; title: string; tz: string; payload: Record<string, unknown>; payload_hash: string;
  note: string | null; issued_by: string; issued_at: string; superseded_at: string | null; sent_at: string | null; sent_by: string | null; sent_note: string | null;
  accepted_on: string | null; accepted_recorded_at: string | null; accepted_recorded_by: string | null; accepted_contact: string | null; accepted_note: string | null;
}
export type ProjCompletionRow = {
  id: string; project_id: string; evidence_type: string; evidence_reference: string | null; file_id: string | null; confirmed_on: string | null;
  client_contact: string | null; completion_note: string; resolutions: { kind: string; id: string; action: string; note: string }[]; completed_by: string;
  completed_at: string; reopened_at: string | null; reopened_by: string | null; reopen_reason: string | null;
}

export type ProjDirectoryRow = {
  id: string; company_id: string; reference: string; name: string; kind: "client" | "internal"; status: string; priority: string; is_ongoing: boolean;
  pm_user_id: string; pm_name: string | null; start_date: string | null; end_date: string | null; is_member: boolean; is_sales_linked: boolean;
}
export type ProjPersonRow = { user_id: string; full_name: string | null; email: string | null; company_ids: string[] }
export type ProjProjectPersonRow = { user_id: string; full_name: string | null; role: "pm" | "acting_pm" | "member"; team_id: string | null; is_team_head: boolean; acting_until: string | null }
export type ProjHandoverStatusRow = { handover_id: string; status: string; pm_name: string | null; project_id: string | null; project_reference: string | null; clarification_note: string | null }
export type ProjUploadIntent = {
  id: string; project_id: string; company_id: string; original_name: string; mime_type: string; size_bytes: number; purpose: string; label: string | null;
  restricted: boolean; quarantine_path: string; final_path: string; status: string; expires_at: string;
}
export type ProjMyCalendarRow = {
  kind: string; item_id: string; project_id: string; project_reference: string; project_name: string; title: string; on_date: string | null; end_date: string | null;
  starts_at: string | null; ends_at: string | null; tz: string | null; status: string; detail: string | null;
}
export type ProjCompanyCalendarRow = { project_id: string; reference: string; name: string; kind: string; status: string; start_date: string | null; end_date: string | null }
export type ProjProjectCalendarRow = {
  kind: string; item_id: string; title: string; on_date: string | null; end_date: string | null; starts_at: string | null; ends_at: string | null;
  tz: string | null; status: string; who: string | null; detail: string | null;
}
export type ProjBookingConflictRow = {
  booking_id: string; is_visible: boolean; project_id: string | null; project_reference: string | null; project_name: string | null;
  starts_at: string | null; ends_at: string | null; tz: string | null; state: string | null;
}
export type ProjMessageFeedRow = {
  id: string; seq: number; parent_id: string | null; author_id: string; author_name: string | null; body: string; created_at: string; edited_at: string | null;
  deleted_at: string | null; changed_at: string; mention_ids: string[];
}
export type ProjNotificationRow = { id: string; type: string; payload: Record<string, unknown>; read_at: string | null; created_at: string }
export type ProjCompletionReviewRow = { kind: "task" | "deliverable" | "milestone" | "feedback" | "booking"; item_id: string; title: string; status: string; detail: string | null }
export type ProjTaskAffectedRow = { task_id: string; title: string; assignee_name: string | null; start_date: string | null; due_date: string | null }
export type ProjUnreadRow = { project_id: string; unread: number; mentioned: boolean }
export type ProjMilestoneProgressRow = { accepted_required: number; total_required: number }
