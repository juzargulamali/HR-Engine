/**
 * Row types for Inventory. Hand-written to match supabase/migrations/20261201000000_inv_access_audit_settings.sql through
 * 20261201000200_inv_planning_tables.sql (see docs/09-extending-the-system.md). Every inv_ table is read-only to clients (SELECT
 * policies only); all writes are the inv_* functions typed in database.types.ts.
 */
import type { InvCapability } from "@enginious-hr/domain";

export type InvReadOnlyTable<Row> = { Row: Row; Insert: Record<string, never>; Update: Record<string, never>; Relationships: [] };

export type InvTracking = "individual" | "quantity" | "kit" | "consumable";
export type InvLifecycle = "draft" | "active" | "retired" | "missing";
export type InvCondition = "good" | "fair" | "needs_inspection" | "damaged" | "unserviceable";
export type InvBalanceCondition = "good" | "needs_inspection" | "damaged";
export type InvCustody = "warehouse" | "employee" | "project" | "transit" | "repair" | "kit";

export type InvCompanyGrantRow = {
  id: string; user_id: string; company_id: string; capabilities: InvCapability[]; note: string | null;
  granted_by: string | null; granted_at: string; revoked_at: string | null; revoked_by: string | null;
}
export type InvAuditLogRow = {
  id: number; table_name: string; row_id: string | null; company_id: string | null; action: "insert" | "update" | "delete";
  actor_id: string | null; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null; created_at: string;
}
export type InvCompanySettingsRow = { company_id: string; reference_code: string; is_enabled: boolean; updated_by: string | null; created_at: string; updated_at: string }

export type InvLocationRow = {
  id: string; company_id: string; code: string; name: string; kind: "warehouse" | "office" | "other"; timezone: string;
  address: string | null; is_active: boolean; created_by: string | null; created_at: string; updated_at: string;
}
export type InvBinRow = { id: string; company_id: string; location_id: string; code: string; label: string | null; is_active: boolean; created_at: string }
export type InvOperatorLocationRow = { id: string; company_id: string; user_id: string; location_id: string; assigned_by: string | null; assigned_at: string; removed_at: string | null }
export type InvCategoryRow = { id: string; company_id: string; name: string; parent_id: string | null; sort_order: number; is_active: boolean; created_at: string }
export type InvItemRow = {
  id: string; company_id: string; name: string; category_id: string | null; tracking: InvTracking; unit_of_measure: string; quantity_scale: number;
  manufacturer: string | null; model: string | null; specification: string | null; status: "draft" | "active" | "retired";
  replaced_by_item_id: string | null; notes: string | null; version: number; created_by: string | null; created_at: string; updated_at: string;
}
export type InvRentalRow = {
  id: string; company_id: string; supplier_name: string; external_reference: string; return_deadline: string; project_id: string | null;
  note: string | null; status: "open" | "returned"; created_by: string | null; created_at: string; returned_at: string | null;
}
export type InvTransferRow = {
  id: string; company_id: string; code: string; from_location_id: string; to_location_id: string; status: "in_transit" | "received" | "cancelled";
  carrier: string | null; reference: string | null; dispatched_by: string; dispatched_at: string; expected_at: string | null;
  received_by: string | null; received_at: string | null; note: string | null;
}
export type InvUnitRow = {
  id: string; company_id: string; item_id: string; code: string; serial_number: string | null; ownership: "owned" | "rental"; rental_id: string | null;
  lifecycle: InvLifecycle; condition: InvCondition; custody_kind: InvCustody; location_id: string | null; bin_id: string | null;
  employee_id: string | null; project_id: string | null; transfer_id: string | null; repair_reference: string | null; in_kit_id: string | null;
  expected_return_at: string | null; verified_at: string | null; verified_by: string | null; legacy_asset_id: string | null; notes: string | null;
  version: number; created_by: string | null; created_at: string; updated_at: string; retired_at: string | null;
}
export type InvBalanceRow = {
  id: string; company_id: string; item_id: string; holder_kind: InvCustody; location_id: string | null; bin_id: string | null; employee_id: string | null;
  project_id: string | null; transfer_id: string | null; kit_unit_id: string | null; repair_reference: string | null; rental_id: string | null;
  condition: InvBalanceCondition; qty: number | string; label_code: string | null; expected_return_at: string | null;
  verified_at: string | null; verified_by: string | null; version: number; created_at: string; updated_at: string;
}
export type InvKitContentRow = {
  id: string; company_id: string; kit_unit_id: string; item_id: string; expected_qty: number | string; is_required: boolean;
  status: "present" | "missing" | "substituted"; content_unit_id: string | null; present_qty: number | string; substitute_item_id: string | null;
  note: string | null; updated_at: string;
}
export type InvMovementKind =
  | "opening" | "receipt" | "rental_receipt" | "issue_employee" | "return_employee" | "reassign_employee" | "dispatch_project" | "return_project"
  | "transfer_project" | "transfer_dispatch" | "transfer_receive" | "consume" | "return_unused" | "repair_out" | "repair_in" | "pack_kit"
  | "unpack_kit" | "pool_change" | "condition_check" | "adjust_missing" | "adjust_found" | "adjust_retire" | "count_adjust" | "correction";
export type InvMovementRow = {
  id: string; company_id: string; code: string; kind: InvMovementKind; occurred_at: string; recorded_at: string; performed_by: string;
  recipient_user_id: string | null; recipient_employee_id: string | null; recipient_name: string | null; project_id: string | null; to_project_id: string | null;
  employee_id: string | null; request_id: string | null; transfer_id: string | null; from_location_id: string | null; to_location_id: string | null;
  expected_return_at: string | null; note: string | null; reason: string | null; corrects_movement_id: string | null; idempotency_key: string | null;
}
export type InvMovementLineRow = {
  id: string; movement_id: string; company_id: string; item_id: string; unit_id: string | null; qty: number | string;
  from_kind: string; to_kind: string; from_location_id: string | null; to_location_id: string | null; from_bin_id: string | null; to_bin_id: string | null;
  from_employee_id: string | null; to_employee_id: string | null; from_project_id: string | null; to_project_id: string | null;
  from_balance_id: string | null; to_balance_id: string | null; condition_from: string | null; condition_to: string | null; exception_note: string | null;
}
export type InvCostRow = {
  id: string; company_id: string; item_id: string; unit_id: string | null; movement_id: string | null; purchase_date: string | null;
  unit_cost: number | string | null; currency: string | null; note: string | null; entered_by: string | null; entered_at: string;
}
export type InvLabelPrintRow = { id: string; company_id: string; unit_id: string | null; balance_id: string | null; reason: "first" | "reprint"; printed_by: string | null; printed_at: string }

export type InvTechnologyRow = {
  id: string; company_id: string; name: string; description: string | null; status: "draft" | "complete" | "retired"; version: number;
  created_by: string | null; created_at: string; updated_at: string;
}
export type InvTechnologyComponentRow = {
  id: string; technology_id: string; company_id: string; item_id: string; qty: number | string; alt_group: string | null; is_optional: boolean; note: string | null; sort_order: number;
}
export type InvRequestStatus = "draft" | "submitted" | "in_progress" | "fulfilled" | "cancelled" | "closed";
export type InvRequestRow = {
  id: string; company_id: string; code: string; kind: "project" | "employee"; project_id: string | null; employee_id: string | null; requested_by: string;
  status: InvRequestStatus; title: string | null; destination: string | null; pickup_location_id: string | null; timezone: string;
  plan: Record<string, string | null>; needed_from: string | null; needed_until: string | null; expected_return_at: string | null;
  source: "manual" | "sales_handover"; source_ref: string | null; note: string | null; version: number; submitted_at: string | null;
  cancelled_at: string | null; cancel_reason: string | null; created_at: string; updated_at: string;
}
export type InvRequestLineRow = {
  id: string; request_id: string; company_id: string; item_id: string; qty: number | string; technology_id: string | null;
  technology_snapshot: Record<string, unknown> | null; alt_group: string | null; is_optional: boolean; original_item_id: string | null;
  substitution_status: "none" | "proposed" | "accepted" | "declined"; substitution_by: string | null; substitution_at: string | null;
  substitution_note: string | null; shortage_action: "none" | "need_to_buy" | "need_to_rent"; shortage_note: string | null; rental_reference: string | null;
  status: "open" | "cancelled" | "closed"; note: string | null; sort_order: number; version: number; created_at: string;
}
export type InvReservationRow = {
  id: string; company_id: string; request_line_id: string; item_id: string; unit_id: string | null; location_id: string | null; qty: number | string;
  dispatched_qty: number | string; returned_qty: number | string; reserved_during: string; status: "active" | "released" | "completed";
  released_reason: string | null; made_by: string; made_at: string; released_at: string | null;
}
export type InvAvailabilityCheckRow = {
  id: string; company_id: string; opportunity_id: string; location_id: string | null; requested_by: string; requested_at: string;
  checked_by: string | null; checked_at: string | null; result: "pending" | "available" | "partial" | "short" | "check_required";
  summary: Record<string, unknown>[]; covers: Record<string, unknown> | null; note: string | null; superseded_by: string | null;
}
export type InvCountRow = {
  id: string; company_id: string; code: string; kind: "opening" | "cycle"; location_id: string; status: "open" | "confirmed" | "cancelled";
  note: string | null; started_by: string; started_at: string; confirmed_by: string | null; confirmed_at: string | null;
}
export type InvCountLineRow = {
  id: string; count_id: string; company_id: string; item_id: string; unit_id: string | null; balance_id: string | null; bin_id: string | null;
  condition: string | null; expected_qty: number | string | null; counted_qty: number | string; reason: string | null; note: string | null;
}
export type InvImportLogRow = { id: string; company_id: string; project_id: string | null; source_ref: string | null; outcome: "imported" | "nothing_to_import" | "failed"; detail: string | null; created_at: string }

/** What the Inventory functions return as jsonb: a plain JSON value the page reads field by field. */
export type InvJson = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type InvMyEquipmentRow = {
  kind: string; unit_id: string | null; balance_id: string | null; code: string | null; item_id: string; item_name: string; serial_number: string | null;
  qty: number | string; unit_of_measure: string; issued_at: string | null; expected_return_at: string | null; condition: string; lifecycle: string | null;
  is_overdue: boolean; company_id: string;
}
export type InvOutstandingRow = {
  employee_id: string; display_name: string; employee_number: string; employment_status: string; termination_date: string | null; is_active: boolean;
  is_removed: boolean; holding_kind: string; unit_id: string | null; balance_id: string | null; code: string | null; item_id: string; item_name: string;
  serial_number: string | null; qty: number | string; unit_of_measure: string; issued_at: string | null; expected_return_at: string | null;
  condition: string; lifecycle: string | null; is_overdue: boolean;
}
export type InvLegacyAssetRow = {
  asset_id: string; asset_tag: string; category: string; description: string | null; status: string; purchase_date: string | null; value: number | string | null;
  open_assignment_count: number; employee_id: string | null; employee_name: string | null; employee_number: string | null; employee_active: boolean | null;
  issued_date: string | null; already_linked: boolean; unit_id: string | null; unit_code: string | null;
}
