/**
 * Hand-written to match supabase/migrations/20260922000000_phase0_foundations.sql,
 * 20260924000000_phase1_contracts_compensation_identity.sql,
 * 20260925000000_phase2_country_policy_engine.sql, and
 * 20260926000000_phase3_leave_and_approvals.sql,
 * 20260927000000_phase4_reimbursements_projects_timesheets.sql, and
 * 20260928000000_phase5_performance_onboarding_documents_assets.sql, and
 * 20260929000000_phase6_letters_payroll_audit_ai_drafts.sql, and
 * 20261101000000_leave_policy_configuration.sql exactly. Once a real
 * Supabase project exists, regenerate this file with `npm run db:types`
 * (root package.json) instead of hand-editing it — see
 * docs/09-extending-the-system.md "adding a table" checklist, which ends
 * with this regeneration step for exactly that reason.
 *
 * `AppRole` also includes 'cto' ahead of schema.sql's migration for it
 * (schema.sql's `app_role` enum already has the value; the corresponding
 * `alter type app_role add value 'cto'` migration lands separately) — cto
 * is a full peer of ceo everywhere in this system.
 */

export type AppRole = "employee" | "line_manager" | "hr_admin" | "finance" | "ceo" | "cto" | "sys_admin";
export type AccountStatus = "invited" | "active" | "deactivated";
export type EmploymentStatus = "active" | "on_leave" | "suspended" | "terminated";
export type EmploymentType = "full_time" | "part_time" | "contractor" | "intern";
export type ContractType = "permanent" | "fixed_term" | "probation" | "contractor";
export type PolicyType =
  | "leave_rules"
  | "overtime_rules"
  | "notice_period"
  | "probation_rules"
  | "working_week"
  | "end_of_service_benefit";
export type PolicyStatus = "draft" | "active" | "superseded";
export type LeaveLedgerEntryType = "accrual" | "deduction" | "adjustment" | "carryover" | "encashment" | "reversal";
export type CompDayEntryType = "earned" | "redeemed" | "expired" | "adjustment" | "reversal";
export type RequestStatus = "draft" | "submitted" | "pending_approval" | "approved" | "rejected" | "cancelled";
export type ApprovalDecision = "pending" | "approved" | "rejected" | "skipped" | "cancelled";
export type ApprovableEntity =
  | "leave_request"
  | "reimbursement_claim"
  | "timesheet"
  | "generated_letter"
  | "onboarding_task"
  | "offboarding_task"
  | "payroll_export_run"
  | "recovery_credit";
export type RecoveryCreditEventType = "standard" | "overnight" | "window" | "window_top_up" | "window_reduction";
export type RecoveryDayClassification = "normal_day" | "rest_day" | "public_holiday";
export type RecoveryWindowReviewFlag =
  | "business_travel"
  | "multiple_leads"
  | "forgotten_clock_out"
  | "hr_recorded"
  | "unusual_long_work"
  | "leave_conflict"
  | "manual_conflict";
export type RecoveryAlertType = "long_work" | "window_rollover";
export type RecoveryAlertStatus = "open" | "acknowledged" | "obsolete";
export interface RecoverySchedulerStatus {
  windows_policy_active: boolean;
  open_periods: number;
  open_failures: number;
  last_run: {
    started_at: string;
    finished_at: string | null;
    status: "running" | "succeeded" | "partial" | "failed";
    origin: string;
    employees_examined: number;
    employees_failed: number;
  } | null;
  last_success_at: string | null;
  seconds_since_last_success: number | null;
  stale: boolean;
  pg_cron_installed: boolean;
  pg_cron_job: { jobid: number; jobname: string; schedule: string; active: boolean } | null;
  expected_interval_minutes: number;
}

export interface RecoveryLiveSummary {
  linked: boolean;
  as_of?: string;
  timezone?: string;
  country_code?: string;
  clock_status?: "clocked_in" | "clocked_out" | "not_started";
  open_since?: string | null;
  work_mode?: AttendanceWorkMode | null;
  project_name?: string | null;
  windowed?: boolean;
  period?: {
    started_at: string;
    elapsed_seconds: number;
    recorded_seconds: number;
    rest_completes_at: string | null;
    rollover_count: number;
    long_work_warning: boolean;
    alert_work_hours: number;
    rest_gap_hours: number;
  } | null;
  window?: {
    index: number;
    started_at: string;
    ends_at: string;
    recorded_seconds: number;
    closed: boolean;
    classification: RecoveryDayClassification;
    entitlement_days: number;
    review_flags: RecoveryWindowReviewFlag[];
    request_status: RequestStatus | null;
  } | null;
}

export interface AttendanceRegisterRow {
  employee_id: string;
  employee_name: string;
  country_code: string;
  timezone: string;
  clock_status: "clocked_in" | "clocked_out" | "not_started";
  attendance_status: "not_recorded" | "present" | "absent" | "leave" | "partial_day";
  attendance_source: string | null;
  work_modes: AttendanceWorkMode[];
  first_clock_in: string | null;
  last_clock_out: string | null;
  recorded_seconds: string | number;
  is_provisional: boolean;
  open_since: string | null;
  session_count: number;
  recovery_summary: "none" | "awaiting_closure" | "awaiting_approval" | "approved" | "needs_review";
  review_flags: RecoveryWindowReviewFlag[];
  open_alert_count: number;
  presence_conflict: string | null;
  on_leave: boolean;
  hr_recorded: boolean;
  manual_hours: string | null;
}

export type RecoveryCreditApplicantRoute = "employee_lead_then_hr" | "manager_hr_direct" | "hr_admin_ceo_cto_queue" | "self_led_hr_direct";
export type AttendanceWorkMode = "office" | "wfh" | "site_work" | "client_meeting" | "business_travel";
export type AttendanceLocationEvent = "segment_start" | "segment_end";
export type AttendanceLocationPermissionStatus = "granted" | "denied" | "unavailable" | "timeout";
export type DocumentStatus = "valid" | "expiring_soon" | "expired";
export type AssetStatus = "in_stock" | "issued" | "under_repair" | "retired";
export type LetterStatus = "draft" | "pending_approval" | "issued" | "void";
export type AiDraftStatus = "draft" | "authorized" | "rejected" | "discarded";

export interface Database {
  public: {
    Tables: {
      countries: {
        Row: {
          code: string;
          name: string;
          default_currency: string;
          week_start_day: number;
          working_weekdays: number[] | null;
          created_at: string;
        };
        Insert: {
          code: string;
          name: string;
          default_currency: string;
          week_start_day?: number;
          working_weekdays?: number[] | null;
        };
        Update: Partial<Database["public"]["Tables"]["countries"]["Insert"]>;
        Relationships: [];
      };
      companies: {
        Row: {
          id: string;
          legal_name: string;
          country_code: string;
          registration_no: string | null;
          default_currency: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: {
          id?: string;
          legal_name: string;
          country_code: string;
          registration_no?: string | null;
          default_currency: string;
          is_active?: boolean;
          deleted_at?: string | null;
          deleted_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Insert"]>;
        Relationships: [];
      };
      departments: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          parent_department_id: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          parent_department_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["departments"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          locale: string;
          is_active: boolean;
          account_status: AccountStatus;
          status_reason: string | null;
          status_changed_by: string | null;
          status_changed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          locale?: string;
          is_active?: boolean;
          account_status?: AccountStatus;
        };
        // status_reason/status_changed_by/status_changed_at are never set
        // directly by application code — only set_account_status() (a
        // SECURITY DEFINER RPC) writes them, same reasoning as audit_log's
        // Insert type below.
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role: AppRole;
          company_id: string | null;
          country_code: string | null;
          granted_by: string | null;
          granted_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: AppRole;
          company_id?: string | null;
          country_code?: string | null;
          granted_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["user_roles"]["Insert"]> & { revoked_at?: string | null };
        Relationships: [];
      };
      employees: {
        Row: {
          id: string;
          user_id: string | null;
          employee_number: string;
          company_id: string;
          country_code: string;
          department_id: string | null;
          manager_id: string | null;
          first_name: string;
          last_name: string;
          personal_email: string | null;
          phone: string | null;
          date_of_birth: string | null;
          nationality: string | null;
          gender: string | null;
          hire_date: string;
          termination_date: string | null;
          employment_status: EmploymentStatus;
          employment_type: EmploymentType;
          job_title: string | null;
          cost_center: string | null;
          work_location: string | null;
          recognised_prior_service_years: number | null;
          is_first_ever_employment: boolean | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          employee_number: string;
          company_id: string;
          country_code: string;
          department_id?: string | null;
          manager_id?: string | null;
          first_name: string;
          last_name: string;
          personal_email?: string | null;
          phone?: string | null;
          date_of_birth?: string | null;
          nationality?: string | null;
          gender?: string | null;
          hire_date: string;
          termination_date?: string | null;
          employment_status?: EmploymentStatus;
          employment_type?: EmploymentType;
          job_title?: string | null;
          cost_center?: string | null;
          work_location?: string | null;
          recognised_prior_service_years?: number | null;
          is_first_ever_employment?: boolean | null;
        };
        Update: Partial<Database["public"]["Tables"]["employees"]["Insert"]> & {
          deleted_at?: string | null;
          deleted_by?: string | null;
        };
        Relationships: [];
      };
      employment_contracts: {
        Row: {
          id: string;
          employee_id: string;
          contract_type: ContractType;
          start_date: string;
          end_date: string | null;
          notice_period_days: number;
          probation_end_date: string | null;
          document_file_path: string | null;
          is_current: boolean;
          superseded_by: string | null;
          version_no: number;
          fte_fraction: number;
          created_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          contract_type: ContractType;
          start_date: string;
          end_date?: string | null;
          notice_period_days?: number;
          probation_end_date?: string | null;
          document_file_path?: string | null;
          is_current?: boolean;
          superseded_by?: string | null;
          version_no: number;
          fte_fraction?: number;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["employment_contracts"]["Insert"]>;
        Relationships: [];
      };
      compensation_details: {
        Row: {
          id: string;
          employee_id: string;
          effective_from: string;
          effective_to: string | null;
          base_salary: string;
          currency: string;
          allowances: Record<string, unknown>;
          payment_method: string | null;
          bank_name: string | null;
          bank_iban: string | null;
          bank_swift: string | null;
          is_current: boolean;
          superseded_by: string | null;
          created_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          effective_from: string;
          effective_to?: string | null;
          base_salary: number;
          currency: string;
          allowances?: Record<string, unknown>;
          payment_method?: string | null;
          bank_name?: string | null;
          bank_iban?: string | null;
          bank_swift?: string | null;
          is_current?: boolean;
          superseded_by?: string | null;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["compensation_details"]["Insert"]>;
        Relationships: [];
      };
      employee_career_events: {
        Row: {
          id: string;
          employee_id: string;
          event_type: "promotion" | "title_change" | "salary_change";
          effective_date: string;
          previous_job_title: string | null;
          new_job_title: string | null;
          previous_base_salary: string | null;
          new_base_salary: string | null;
          previous_allowances: Record<string, unknown> | null;
          new_allowances: Record<string, unknown> | null;
          currency: string | null;
          note: string | null;
          created_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          event_type: "promotion" | "title_change" | "salary_change";
          effective_date: string;
          previous_job_title?: string | null;
          new_job_title?: string | null;
          previous_base_salary?: number | null;
          new_base_salary?: number | null;
          previous_allowances?: Record<string, unknown> | null;
          new_allowances?: Record<string, unknown> | null;
          currency?: string | null;
          note?: string | null;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["employee_career_events"]["Insert"]>;
        Relationships: [];
      };
      employee_loans: {
        Row: {
          id: string;
          employee_id: string;
          loan_type: "loan" | "cash_advance";
          amount: string;
          currency: string;
          issued_date: string;
          note: string | null;
          created_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          loan_type: "loan" | "cash_advance";
          amount: number;
          currency: string;
          issued_date: string;
          note?: string | null;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["employee_loans"]["Insert"]>;
        Relationships: [];
      };
      identity_documents: {
        Row: {
          id: string;
          employee_id: string;
          document_type: string;
          document_number: string;
          issuing_country: string | null;
          issue_date: string | null;
          expiry_date: string | null;
          file_path: string | null;
          is_current: boolean;
          created_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          document_type: string;
          document_number: string;
          issuing_country?: string | null;
          issue_date?: string | null;
          expiry_date?: string | null;
          file_path?: string | null;
          is_current?: boolean;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["identity_documents"]["Insert"]>;
        Relationships: [];
      };
      employee_insurance_policies: {
        Row: {
          id: string;
          employee_id: string;
          insurance_name: string;
          policy_number: string;
          expiry_date: string | null;
          file_path: string | null;
          created_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          insurance_name: string;
          policy_number: string;
          expiry_date?: string | null;
          file_path?: string | null;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["employee_insurance_policies"]["Insert"]>;
        Relationships: [];
      };
      policy_versions: {
        Row: {
          id: string;
          country_code: string;
          policy_type: PolicyType;
          version_no: number;
          effective_from: string;
          effective_to: string | null;
          status: PolicyStatus;
          payload: Record<string, unknown>;
          created_by: string;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
          activation_record: Record<string, unknown> | null;
        };
        Insert: {
          id?: string;
          country_code: string;
          policy_type: PolicyType;
          version_no: number;
          effective_from: string;
          effective_to?: string | null;
          status?: PolicyStatus;
          payload: Record<string, unknown>;
          created_by: string;
        };
        Update: {
          status?: PolicyStatus;
          payload?: Record<string, unknown>;
          effective_to?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
        };
        Relationships: [];
      };
      policy_leave_types: {
        Row: {
          id: string;
          policy_version_id: string;
          leave_type_code: string;
          name: string;
          accrual_method: string;
          accrual_rate_per_period: string | null;
          max_balance_days: string | null;
          carryover_max_days: string | null;
          carryover_expiry_months: number | null;
          min_service_days_to_accrue: number | null;
          requires_medical_cert_after_days: number | null;
          approval_levels_required: number;
          gender_restricted: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          policy_version_id: string;
          leave_type_code: string;
          name: string;
          accrual_method: string;
          accrual_rate_per_period?: number | null;
          max_balance_days?: number | null;
          carryover_max_days?: number | null;
          carryover_expiry_months?: number | null;
          min_service_days_to_accrue?: number | null;
          requires_medical_cert_after_days?: number | null;
          approval_levels_required?: number;
          gender_restricted?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["policy_leave_types"]["Insert"]>;
        Relationships: [];
      };
      public_holidays: {
        Row: {
          id: string;
          country_code: string;
          holiday_date: string;
          name: string;
          is_paid: boolean;
          updated_at: string;
        };
        Insert: {
          id?: string;
          country_code: string;
          holiday_date: string;
          name: string;
          is_paid?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["public_holidays"]["Insert"]>;
        Relationships: [];
      };
      leave_requests: {
        Row: {
          id: string;
          employee_id: string;
          leave_type_code: string;
          start_date: string;
          end_date: string;
          half_day_start: boolean;
          half_day_end: boolean;
          total_days: string;
          reason: string | null;
          status: RequestStatus;
          submitted_at: string;
          decided_at: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          leave_type_code: string;
          start_date: string;
          end_date: string;
          half_day_start?: boolean;
          half_day_end?: boolean;
          total_days: number;
          reason?: string | null;
        };
        Update: { status?: RequestStatus; decided_at?: string | null };
        Relationships: [];
      };
      leave_ledger: {
        Row: {
          id: string;
          employee_id: string;
          leave_type_code: string;
          txn_date: string;
          entry_type: LeaveLedgerEntryType;
          amount_days: string;
          reference_type: string | null;
          reference_id: string | null;
          reversal_of_id: string | null;
          note: string | null;
          created_by: string;
          created_at: string;
          idempotency_key: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          leave_type_code: string;
          txn_date: string;
          entry_type: LeaveLedgerEntryType;
          amount_days: number;
          reference_type?: string | null;
          reference_id?: string | null;
          reversal_of_id?: string | null;
          note?: string | null;
          created_by: string;
          idempotency_key?: string | null;
        };
        Update: Record<string, never>; // append-only — no UPDATE policy exists
        Relationships: [];
      };
      comp_day_ledger: {
        Row: {
          id: string;
          employee_id: string;
          txn_date: string;
          entry_type: CompDayEntryType;
          days: string;
          source: string | null;
          expiry_date: string | null;
          reference_type: string | null;
          reference_id: string | null;
          reversal_of_id: string | null;
          created_by: string;
          created_at: string;
          idempotency_key: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          txn_date: string;
          entry_type: CompDayEntryType;
          days: number;
          source?: string | null;
          expiry_date?: string | null;
          reference_type?: string | null;
          reference_id?: string | null;
          reversal_of_id?: string | null;
          created_by: string;
          idempotency_key?: string | null;
        };
        Update: Record<string, never>; // append-only — no UPDATE policy exists
        Relationships: [];
      };
      deduction_priority_rules: {
        Row: {
          id: string;
          company_id: string | null;
          country_code: string | null;
          leave_type_code: string;
          source_ledger: "comp_day" | "leave_ledger";
          priority_order: number;
          effective_from: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          country_code?: string | null;
          leave_type_code: string;
          source_ledger: "comp_day" | "leave_ledger";
          priority_order: number;
          effective_from?: string;
        };
        Update: Partial<Database["public"]["Tables"]["deduction_priority_rules"]["Insert"]>;
        Relationships: [];
      };
      approval_workflows: {
        Row: {
          id: string;
          company_id: string | null;
          country_code: string | null;
          entity_type: ApprovableEntity;
          name: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          country_code?: string | null;
          entity_type: ApprovableEntity;
          name: string;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["approval_workflows"]["Insert"]>;
        Relationships: [];
      };
      approval_workflow_steps: {
        Row: {
          id: string;
          workflow_id: string;
          step_order: number;
          approver_type: string;
          condition: Record<string, unknown> | null;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          step_order: number;
          approver_type: string;
          condition?: Record<string, unknown> | null;
        };
        Update: Partial<Database["public"]["Tables"]["approval_workflow_steps"]["Insert"]>;
        Relationships: [];
      };
      approvals: {
        Row: {
          id: string;
          entity_type: ApprovableEntity;
          entity_id: string;
          workflow_id: string | null;
          step_order: number;
          approver_id: string | null;
          queue_roles: AppRole[] | null;
          decision: ApprovalDecision;
          decided_at: string | null;
          comments: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          entity_type: ApprovableEntity;
          entity_id: string;
          workflow_id?: string | null;
          step_order: number;
          approver_id?: string | null;
          queue_roles?: AppRole[] | null;
          decision?: ApprovalDecision;
          comments?: string | null;
        };
        Update: Record<string, never>; // no UPDATE policy — only decide_leave_approval() writes decisions
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          company_id: string;
          code: string;
          name: string;
          client_name: string | null;
          is_billable: boolean;
          is_active: boolean;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          code: string;
          name: string;
          client_name?: string | null;
          is_billable?: boolean;
          is_active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
      project_allocations: {
        Row: {
          id: string;
          employee_id: string;
          project_id: string;
          allocation_percent: string;
          start_date: string;
          end_date: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          project_id: string;
          allocation_percent: number;
          start_date: string;
          end_date?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["project_allocations"]["Insert"]>;
        Relationships: [];
      };
      reimbursement_claims: {
        Row: {
          id: string;
          employee_id: string;
          claim_date: string;
          currency: string;
          total_amount: string;
          status: RequestStatus;
          submitted_at: string | null;
          decided_at: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          claim_date?: string;
          currency: string;
        };
        Update: { status?: RequestStatus; submitted_at?: string | null; decided_at?: string | null };
        Relationships: [];
      };
      reimbursement_claim_lines: {
        Row: {
          id: string;
          claim_id: string;
          line_no: number;
          expense_date: string;
          category: string;
          amount: string;
          description: string | null;
          project_id: string | null;
          cost_center: string | null;
          receipt_file_path: string | null;
        };
        Insert: {
          id?: string;
          claim_id: string;
          line_no: number;
          expense_date: string;
          category: string;
          amount: number;
          description?: string | null;
          project_id?: string | null;
          cost_center?: string | null;
          receipt_file_path?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["reimbursement_claim_lines"]["Insert"]>;
        Relationships: [];
      };
      timesheets: {
        Row: {
          id: string;
          employee_id: string;
          period_start: string;
          period_end: string;
          status: RequestStatus;
          submitted_at: string | null;
          decided_at: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          period_start: string;
          period_end: string;
        };
        Update: { status?: RequestStatus; submitted_at?: string | null; decided_at?: string | null };
        Relationships: [];
      };
      timesheet_entries: {
        Row: {
          id: string;
          timesheet_id: string;
          work_date: string;
          project_id: string | null;
          task_description: string | null;
          hours: string;
          is_billable: boolean;
        };
        Insert: {
          id?: string;
          timesheet_id: string;
          work_date: string;
          project_id?: string | null;
          task_description?: string | null;
          hours: number;
          is_billable?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["timesheet_entries"]["Insert"]>;
        Relationships: [];
      };
      attendance_records: {
        Row: {
          id: string;
          employee_id: string;
          work_date: string;
          clock_in: string | null;
          clock_out: string | null;
          hours_worked: string | null;
          status: string;
          work_mode: string | null;
          source: string;
          completed_normal_scheduled_day: boolean | null;
          active_hours_after_midnight: string | null;
          presence_conflict: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          work_date: string;
          clock_in?: string | null;
          clock_out?: string | null;
          hours_worked?: number | null;
          status?: string;
          work_mode?: string | null;
          source?: string;
          completed_normal_scheduled_day?: boolean | null;
          active_hours_after_midnight?: number | null;
          presence_conflict?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["attendance_records"]["Insert"]>;
        Relationships: [];
      };
      attendance_sessions: {
        Row: {
          id: string;
          employee_id: string;
          clock_in_at: string;
          clock_out_at: string | null;
          status: "open" | "closed";
          hr_closed_by: string | null;
          hr_closed_at: string | null;
          hr_closed_reason: string | null;
          created_at: string;
          recovery_model: "legacy" | "windowed";
          recorded_by_hr: boolean;
          recorded_by_hr_by: string | null;
          recorded_by_hr_at: string | null;
          recorded_by_hr_reason: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
        };
        Update: Record<string, never>; // no UPDATE policy — clock_out()/hr_close_attendance_session() (both SECURITY DEFINER) are the only mutators
        Relationships: [];
      };
      attendance_segments: {
        Row: {
          id: string;
          session_id: string;
          employee_id: string;
          work_mode: AttendanceWorkMode;
          project_name: string | null;
          project_lead_employee_id: string | null;
          segment_start: string;
          segment_end: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          employee_id: string;
          work_mode: AttendanceWorkMode;
          project_name?: string | null;
          project_lead_employee_id?: string | null;
          segment_start?: string;
        };
        Update: Record<string, never>; // no UPDATE policy — clock_in()/switch_work_segment()/clock_out()/hr_close_attendance_session() are the only mutators
        Relationships: [];
      };
      attendance_locations: {
        Row: {
          id: string;
          segment_id: string;
          event: AttendanceLocationEvent;
          latitude: string | null;
          longitude: string | null;
          accuracy_meters: string | null;
          permission_status: AttendanceLocationPermissionStatus;
          captured_at: string;
        };
        Insert: {
          id?: string;
          segment_id: string;
          event: AttendanceLocationEvent;
          latitude?: number | null;
          longitude?: number | null;
          accuracy_meters?: number | null;
          permission_status: AttendanceLocationPermissionStatus;
        };
        Update: Record<string, never>; // no UPDATE policy — record_attendance_location() (SECURITY DEFINER) is the only mutator
        Relationships: [];
      };
      recovery_credit_requests: {
        Row: {
          id: string;
          employee_id: string;
          attendance_record_id: string | null;
          segment_id: string | null;
          work_date: string;
          event_type: RecoveryCreditEventType;
          proposed_days: string;
          status: RequestStatus;
          submitted_at: string;
          decided_at: string | null;
          created_by: string;
          comp_day_ledger_id: string | null;
          created_at: string;
          correction_reason: string | null;
          checked_with: string | null;
          corrected_by: string | null;
          corrected_at: string | null;
          work_mode: string | null;
          project_name: string | null;
          project_lead_employee_id: string | null;
          applicant_route: RecoveryCreditApplicantRoute | null;
          awaiting_project_lead: boolean;
          needs_policy_review: boolean;
          routing_issue: string | null;
          recovery_window_id: string | null;
          window_revision_no: number | null;
          adjusts_request_id: string | null;
          consumption_ack_by: string | null;
          consumption_ack_at: string | null;
          consumption_ack_note: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          attendance_record_id?: string | null;
          segment_id?: string | null;
          work_date: string;
          event_type: RecoveryCreditEventType;
          proposed_days: number;
          status?: RequestStatus;
          created_by: string;
          work_mode?: string | null;
          project_name?: string | null;
          project_lead_employee_id?: string | null;
          applicant_route?: RecoveryCreditApplicantRoute | null;
          awaiting_project_lead?: boolean;
          needs_policy_review?: boolean;
          routing_issue?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["recovery_credit_requests"]["Insert"]> & {
          decided_at?: string | null;
          comp_day_ledger_id?: string | null;
          correction_reason?: string | null;
          checked_with?: string | null;
          corrected_by?: string | null;
          corrected_at?: string | null;
        };
        Relationships: [];
      };
      // ---- Recovery Leave windows redesign (migration 20261108000000). Read-only
      // for every signed-in user: all writes are SECURITY DEFINER functions.
      recovery_periods: {
        Row: {
          id: string;
          employee_id: string;
          company_id: string;
          country_code: string;
          timezone: string;
          policy_version_id: string;
          rules: Record<string, unknown>;
          started_at: string;
          last_work_end_at: string;
          has_open_session: boolean;
          rest_completes_at: string | null;
          status: "open" | "ended" | "superseded";
          ended_at: string | null;
          recorded_seconds: string;
          elapsed_seconds: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      recovery_windows: {
        Row: {
          id: string;
          period_id: string;
          employee_id: string;
          company_id: string;
          window_index: number;
          window_start: string;
          window_end: string;
          recorded_seconds: string;
          status: "open" | "closed";
          closed_at: string | null;
          closed_reason: "elapsed_window" | "rest" | null;
          starting_local_date: string;
          country_code: string;
          timezone: string;
          classification: RecoveryDayClassification;
          holiday_name: string | null;
          policy_version_id: string;
          entitlement_days: string;
          band: "none" | "half" | "full";
          review_flags: RecoveryWindowReviewFlag[];
          hr_verification_required: boolean;
          hr_verified_by: string | null;
          hr_verified_at: string | null;
          hr_verification_note: string | null;
          revision_no: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      recovery_window_allocations: {
        Row: {
          id: string;
          window_id: string;
          employee_id: string;
          session_id: string;
          segment_id: string;
          work_mode: AttendanceWorkMode;
          project_name: string | null;
          project_lead_employee_id: string | null;
          alloc_start: string;
          alloc_end: string;
          seconds: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      recovery_window_revisions: {
        Row: {
          id: string;
          window_id: string;
          revision_no: number;
          recorded_seconds: string;
          entitlement_days: string;
          classification: RecoveryDayClassification;
          starting_local_date: string;
          review_flags: RecoveryWindowReviewFlag[];
          reason: string;
          actor_id: string | null;
          origin: string;
          previous_facts: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      recovery_alerts: {
        Row: {
          id: string;
          company_id: string;
          employee_id: string;
          period_id: string;
          alert_type: RecoveryAlertType;
          dedup_key: string;
          triggered_at: string;
          detected_at: string;
          period_started_at: string;
          recorded_seconds: string;
          elapsed_seconds: string;
          details: Record<string, unknown>;
          status: RecoveryAlertStatus;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
          acknowledgement_note: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      attendance_session_corrections: {
        Row: {
          id: string;
          session_id: string;
          employee_id: string;
          kind: "correct_times" | "add_missing";
          original_clock_in_at: string | null;
          original_clock_out_at: string | null;
          corrected_clock_in_at: string;
          corrected_clock_out_at: string;
          reason: string;
          actor_id: string;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      termination_settlement_inputs: {
        Row: {
          employee_id: string;
          leave_encashment_daily_rate: string;
          entered_by: string;
          entered_at: string;
        };
        Insert: {
          employee_id: string;
          leave_encashment_daily_rate: number;
        };
        Update: Partial<Database["public"]["Tables"]["termination_settlement_inputs"]["Insert"]>;
        Relationships: [];
      };
      poland_termination_leave_reconciliations: {
        Row: {
          employee_id: string;
          termination_date: string;
          raw_delta_days: string;
          applied_days: string;
          excess_requiring_review_days: string;
          excess_reviewed_at: string | null;
          excess_reviewed_by: string | null;
          note: string | null;
          created_by: string;
          created_at: string;
        };
        Insert: {
          employee_id: string;
          termination_date: string;
          raw_delta_days: number;
          applied_days: number;
          excess_requiring_review_days?: number;
          note?: string | null;
          created_by: string;
        };
        Update: Partial<Database["public"]["Tables"]["poland_termination_leave_reconciliations"]["Insert"]>;
        Relationships: [];
      };
      performance_cycles: {
        Row: { id: string; company_id: string; name: string; period_start: string; period_end: string; status: string };
        Insert: { id?: string; company_id: string; name: string; period_start: string; period_end: string; status?: string };
        Update: Partial<Database["public"]["Tables"]["performance_cycles"]["Insert"]>;
        Relationships: [];
      };
      goals: {
        Row: {
          id: string;
          employee_id: string;
          cycle_id: string;
          title: string;
          description: string | null;
          weight_percent: string | null;
          target_date: string | null;
          status: string;
          self_rating: number | null;
          manager_rating: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          cycle_id: string;
          title: string;
          description?: string | null;
          weight_percent?: number | null;
          target_date?: string | null;
          status?: string;
          self_rating?: number | null;
          manager_rating?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["goals"]["Insert"]>;
        Relationships: [];
      };
      appraisals: {
        Row: {
          id: string;
          employee_id: string;
          cycle_id: string;
          appraiser_id: string;
          // Fully derived by a DB trigger from the five competency ratings
          // below (rounded average, skipping nulls). Still settable in
          // Insert/Update for type-shape convenience — the trigger silently
          // overwrites whatever a client sends, so it's effectively
          // ignore-on-write, never a real client-owned value.
          overall_rating: number | null;
          quality_of_work_rating: number | null;
          productivity_rating: number | null;
          initiative_rating: number | null;
          teamwork_rating: number | null;
          punctuality_rating: number | null;
          strengths: string | null;
          areas_for_improvement: string | null;
          status: string;
          submitted_at: string | null;
          acknowledged_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          cycle_id: string;
          appraiser_id: string;
          overall_rating?: number | null;
          quality_of_work_rating?: number | null;
          productivity_rating?: number | null;
          initiative_rating?: number | null;
          teamwork_rating?: number | null;
          punctuality_rating?: number | null;
          strengths?: string | null;
          areas_for_improvement?: string | null;
          status?: string;
          submitted_at?: string | null;
        };
        Update: {
          overall_rating?: number | null;
          quality_of_work_rating?: number | null;
          productivity_rating?: number | null;
          initiative_rating?: number | null;
          teamwork_rating?: number | null;
          punctuality_rating?: number | null;
          strengths?: string | null;
          areas_for_improvement?: string | null;
          status?: string;
          submitted_at?: string | null;
          acknowledged_at?: string | null;
        };
        Relationships: [];
      };
      checklist_templates: {
        Row: { id: string; company_id: string | null; country_code: string | null; kind: string; name: string; is_active: boolean };
        Insert: { id?: string; company_id?: string | null; country_code?: string | null; kind: string; name: string; is_active?: boolean };
        Update: Partial<Database["public"]["Tables"]["checklist_templates"]["Insert"]>;
        Relationships: [];
      };
      checklist_template_items: {
        Row: { id: string; template_id: string; step_order: number; task_name: string; assignee_role: AppRole; due_offset_days: number };
        Insert: { id?: string; template_id: string; step_order: number; task_name: string; assignee_role: AppRole; due_offset_days?: number };
        Update: Partial<Database["public"]["Tables"]["checklist_template_items"]["Insert"]>;
        Relationships: [];
      };
      employee_checklist_items: {
        Row: {
          id: string;
          employee_id: string;
          template_item_id: string;
          kind: string;
          due_date: string | null;
          status: string;
          completed_by: string | null;
          completed_at: string | null;
        };
        Insert: { id?: string; employee_id: string; template_item_id: string; kind: string; due_date?: string | null };
        Update: { status?: string; completed_by?: string | null; completed_at?: string | null };
        Relationships: [];
      };
      employee_documents: {
        Row: {
          id: string;
          employee_id: string;
          document_type: string;
          file_path: string;
          expiry_date: string | null;
          status: DocumentStatus;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: { id?: string; employee_id: string; document_type: string; file_path: string; expiry_date?: string | null };
        Update: { status?: DocumentStatus; deleted_at?: string | null };
        Relationships: [];
      };
      document_expiry_reminder_rules: {
        Row: { id: string; company_id: string | null; country_code: string | null; document_type: string; lead_days: number };
        Insert: { id?: string; company_id?: string | null; country_code?: string | null; document_type: string; lead_days: number };
        Update: Partial<Database["public"]["Tables"]["document_expiry_reminder_rules"]["Insert"]>;
        Relationships: [];
      };
      document_expiry_reminders_sent: {
        Row: { id: string; employee_document_id: string; lead_days: number; sent_at: string };
        Insert: { id?: string; employee_document_id: string; lead_days: number };
        Update: Record<string, never>;
        Relationships: [];
      };
      notifications: {
        Row: { id: string; user_id: string; type: string; payload: Record<string, unknown>; read_at: string | null; created_at: string };
        Insert: { id?: string; user_id: string; type: string; payload?: Record<string, unknown> };
        Update: { read_at?: string | null };
        Relationships: [];
      };
      assets: {
        Row: {
          id: string;
          company_id: string;
          asset_tag: string;
          category: string;
          description: string | null;
          purchase_date: string | null;
          value: string | null;
          status: AssetStatus;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          asset_tag: string;
          category: string;
          description?: string | null;
          purchase_date?: string | null;
          value?: number | null;
          status?: AssetStatus;
        };
        Update: Partial<Database["public"]["Tables"]["assets"]["Insert"]> & { deleted_at?: string | null };
        Relationships: [];
      };
      asset_assignments: {
        Row: {
          id: string;
          asset_id: string;
          employee_id: string;
          issued_date: string;
          returned_date: string | null;
          condition_on_issue: string | null;
          condition_on_return: string | null;
          issued_by: string;
        };
        Insert: {
          id?: string;
          asset_id: string;
          employee_id: string;
          issued_date?: string;
          condition_on_issue?: string | null;
          issued_by: string;
        };
        Update: { returned_date?: string | null; condition_on_return?: string | null };
        Relationships: [];
      };
      letter_templates: {
        Row: {
          id: string;
          company_id: string;
          country_code: string | null;
          template_type: string;
          name: string;
          body_template: string;
          requires_approval: boolean;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          country_code?: string | null;
          template_type: string;
          name: string;
          body_template: string;
          requires_approval?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["letter_templates"]["Insert"]> & { deleted_at?: string | null };
        Relationships: [];
      };
      generated_letters: {
        Row: {
          id: string;
          employee_id: string;
          template_id: string;
          generated_by: string;
          generated_at: string;
          file_path: string | null;
          status: LetterStatus;
        };
        Insert: {
          id?: string;
          employee_id: string;
          template_id: string;
          generated_by: string;
          file_path?: string | null;
          status?: LetterStatus;
        };
        Update: { status?: LetterStatus; file_path?: string | null };
        Relationships: [];
      };
      payroll_export_runs: {
        Row: {
          id: string;
          company_id: string;
          period_month: number;
          period_year: number;
          status: RequestStatus;
          generated_by: string;
          generated_at: string;
          authorized_by: string | null;
          authorized_at: string | null;
          sent_at: string | null;
          file_path: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          period_month: number;
          period_year: number;
          generated_by: string;
        };
        Update: { status?: RequestStatus; sent_at?: string | null; file_path?: string | null };
        Relationships: [];
      };
      payroll_export_lines: {
        Row: {
          id: string;
          run_id: string;
          employee_id: string;
          component_code: "basic_salary" | "other_allowance" | "reimbursement" | "leave_encashment" | "deduction" | "bonus";
          amount: string;
          currency: string;
          source_reference_type: string | null;
          source_reference_id: string | null;
          label: string | null;
          is_manual: boolean;
          created_by: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          employee_id: string;
          component_code: "basic_salary" | "other_allowance" | "reimbursement" | "leave_encashment" | "deduction" | "bonus";
          amount: number;
          currency: string;
          source_reference_type?: string | null;
          source_reference_id?: string | null;
          label?: string | null;
          is_manual?: boolean;
          created_by: string;
        };
        Update: { amount?: number; is_manual?: boolean };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          table_name: string;
          record_id: string | null;
          action: string;
          actor_id: string | null;
          actor_role: AppRole | null;
          actor_roles: AppRole[] | null;
          company_id: string | null;
          before_data: Record<string, unknown> | null;
          after_data: Record<string, unknown> | null;
          is_ai_generated: boolean;
          ai_context: Record<string, unknown> | null;
          occurred_at: string;
          origin: "user" | "system" | "processor" | null;
        };
        Insert: Record<string, never>; // written only by write_audit_log() (SECURITY DEFINER)
        Update: Record<string, never>;
        Relationships: [];
      };
      ai_drafts: {
        Row: {
          id: string;
          entity_type: string;
          entity_id: string | null;
          proposed_action: string;
          proposed_payload: Record<string, unknown>;
          rationale: string | null;
          created_by_agent: string;
          status: AiDraftStatus;
          authorized_by: string | null;
          authorized_at: string | null;
          reference_id: string | null;
          created_at: string;
        };
        // No RLS insert policy grants this to any authenticated role — only the AI
        // service's own service-role credential (which bypasses RLS) can actually
        // write one; the shape below just describes what that one caller sends.
        Insert: {
          id?: string;
          entity_type: string;
          entity_id?: string | null;
          proposed_action: string;
          proposed_payload: Record<string, unknown>;
          rationale?: string | null;
          created_by_agent: string;
          status?: AiDraftStatus;
        };
        Update: { status?: AiDraftStatus; authorized_by?: string | null; authorized_at?: string | null; reference_id?: string | null };
        Relationships: [];
      };
    };
    Views: {
      leave_balances: {
        Row: { employee_id: string; leave_type_code: string; balance_days: string };
        Relationships: [];
      };
      comp_day_balances: {
        Row: { employee_id: string; balance_days: string };
        Relationships: [];
      };
    };
    Functions: {
      get_contract_as_of: {
        Args: { p_employee_id: string; p_as_of: string };
        Returns: Database["public"]["Tables"]["employment_contracts"]["Row"][];
      };
      resolve_policy: {
        Args: { p_country_code: string; p_policy_type: PolicyType; p_as_of: string };
        Returns: Record<string, unknown> | null;
      };
      resolve_approver: {
        Args: { p_approver_type: string; p_employee_id: string };
        Returns: string | null;
      };
      get_employee_manager_name: {
        Args: { p_employee_id: string };
        Returns: string | null;
      };
      decide_leave_approval: {
        Args: { p_approval_id: string; p_decision: ApprovalDecision; p_comments?: string | null };
        Returns: undefined;
      };
      create_initial_approval: {
        Args: { p_entity_type: ApprovableEntity; p_entity_id: string };
        Returns: string;
      };
      record_overnight_recovery_credit: {
        Args: {
          p_employee_id: string;
          p_work_date: string;
          p_completed_normal_scheduled_day: boolean;
          p_active_hours_after_midnight: number;
        };
        Returns: { credited: boolean; credit_days: number }[];
      };
      recovery_credit_days_for_hours: {
        Args: { p_hours: number | null };
        Returns: number;
      };
      is_recovery_eligible_day: {
        Args: { p_country_code: string; p_work_date: string };
        Returns: { is_recovery_day: boolean; holiday_name: string | null }[];
      };
      country_timezone: {
        Args: { p_country_code: string | null };
        Returns: string;
      };
      hr_verify_recovery_window: {
        Args: { p_window_id: string; p_note: string };
        Returns: undefined;
      };
      hr_acknowledge_recovery_reduction: {
        Args: { p_request_id: string; p_note: string };
        Returns: undefined;
      };
      acknowledge_recovery_alert: {
        Args: { p_alert_id: string; p_note?: string | null };
        Returns: undefined;
      };
      get_recovery_request_blocker: {
        Args: { p_request_id: string };
        Returns: string | null;
      };
      hr_correct_attendance_session: {
        Args: { p_session_id: string; p_clock_in_at: string; p_clock_out_at: string; p_reason: string };
        Returns: undefined;
      };
      hr_add_missing_attendance: {
        Args: {
          p_employee_id: string;
          p_clock_in_at: string;
          p_clock_out_at: string;
          p_work_mode: AttendanceWorkMode;
          p_project_name?: string | null;
          p_project_lead_employee_id?: string | null;
          p_reason: string;
        };
        Returns: string;
      };
      seed_recovery_windows_policy_drafts: {
        Args: Record<string, never>;
        Returns: { country_code: string; policy_type: string; version_no: number | null; action: string }[];
      };
      activate_recovery_windows_policy: {
        Args: { p_policy_version_id: string; p_effective_from: string };
        Returns: undefined;
      };
      recovery_scheduler_status: {
        Args: Record<string, never>;
        Returns: RecoverySchedulerStatus;
      };
      recovery_live_summary: {
        Args: { p_employee_id: string };
        Returns: RecoveryLiveSummary;
      };
      attendance_register_for_date: {
        Args: { p_company_id: string; p_date: string };
        Returns: AttendanceRegisterRow[];
      };
      // Service-role only (never granted to signed-in users): the background processor.
      recovery_process_due: {
        Args: { p_origin?: string; p_as_of?: string | null; p_limit?: number };
        Returns: { status: string; run_id?: string; examined?: number; failed?: number; as_of?: string };
      };
      adjust_recovery_credit_request: {
        Args: {
          p_request_id: string;
          p_corrected_work_date: string;
          p_corrected_hours: number;
          p_correction_reason?: string | null;
          p_checked_with?: string | null;
        };
        Returns: undefined;
      };
      decide_recovery_credit_request: {
        Args: {
          p_request_id: string;
          p_decision: ApprovalDecision;
          p_checked_with?: string | null;
          p_comments?: string | null;
        };
        Returns: undefined;
      };
      resolve_recovery_credit_project_lead: {
        Args: { p_request_id: string; p_project_lead_employee_id: string };
        Returns: string;
      };
      clock_in: {
        Args: {
          p_work_mode: AttendanceWorkMode;
          p_project_name?: string | null;
          p_project_lead_employee_id?: string | null;
          p_location?: {
            latitude?: number | null;
            longitude?: number | null;
            accuracy_meters?: number | null;
            permission_status: AttendanceLocationPermissionStatus;
          } | null;
        };
        Returns: string;
      };
      switch_work_segment: {
        Args: {
          p_work_mode: AttendanceWorkMode;
          p_project_name?: string | null;
          p_project_lead_employee_id?: string | null;
          p_closing_location?: {
            latitude?: number | null;
            longitude?: number | null;
            accuracy_meters?: number | null;
            permission_status: AttendanceLocationPermissionStatus;
          } | null;
          p_opening_location?: {
            latitude?: number | null;
            longitude?: number | null;
            accuracy_meters?: number | null;
            permission_status: AttendanceLocationPermissionStatus;
          } | null;
        };
        Returns: string;
      };
      clock_out: {
        Args: {
          p_location?: {
            latitude?: number | null;
            longitude?: number | null;
            accuracy_meters?: number | null;
            permission_status: AttendanceLocationPermissionStatus;
          } | null;
        };
        Returns: string;
      };
      hr_close_attendance_session: {
        Args: { p_session_id: string; p_corrected_clock_out_at: string; p_reason: string };
        Returns: undefined;
      };
      terminate_employee: {
        Args: { p_employee_id: string; p_termination_date?: string };
        Returns: undefined;
      };
      forfeit_recovery_leave_on_termination: {
        Args: { p_employee_id: string };
        Returns: { forfeited_days: number }[];
      };
      post_poland_termination_leave_adjustment: {
        Args: { p_employee_id: string; p_amount_days: number; p_note?: string | null };
        Returns: { applied_days: number; excess_requiring_review: number; already_posted: boolean }[];
      };
      acknowledge_poland_termination_leave_excess: {
        Args: { p_employee_id: string };
        Returns: undefined;
      };
      confirm_poland_termination_leave_manually_reconciled: {
        Args: { p_employee_id: string; p_note?: string | null };
        Returns: undefined;
      };
      seed_phase2b_policy_drafts: {
        Args: Record<string, never>;
        Returns: { country_code: string; policy_type: string; version_no: number | null; action: string }[];
      };
      preflight_phase2b_v2_policy_status: {
        Args: Record<string, never>;
        Returns: {
          country_code: string;
          policy_type: string;
          version_no: number | null;
          status: string;
          effective_from: string | null;
          critical_values: Record<string, unknown> | null;
          runtime_can_resolve_unambiguously: boolean;
        }[];
      };
      preflight_country_schedule_config: {
        Args: Record<string, never>;
        Returns: {
          country_code: string;
          week_start_day: number;
          working_weekdays: number[] | null;
          effective_working_days: number[];
          requested_convention: string | null;
          conflicts_with_requested_convention: boolean | null;
        }[];
      };
      generate_checklist_items: {
        Args: { p_employee_id: string; p_template_id: string; p_anchor_date: string };
        Returns: Database["public"]["Tables"]["employee_checklist_items"]["Row"][];
      };
      generate_payroll_export_lines: {
        Args: { p_run_id: string };
        Returns: Database["public"]["Tables"]["payroll_export_lines"]["Row"][];
      };
      resolve_approver_for_company: {
        Args: { p_approver_type: string; p_company_id: string };
        Returns: string | null;
      };
      resolve_role_holders: {
        Args: { p_role: AppRole; p_company_id: string };
        Returns: string[];
      };
      get_career_summary_for_appraisal: {
        Args: { p_employee_id: string };
        Returns: { last_promotion_date: string | null; last_title_change_date: string | null; last_salary_change_date: string | null }[];
      };
      permanently_delete_employee: {
        Args: { p_employee_id: string };
        Returns: undefined;
      };
      cancel_leave_request: {
        Args: { p_request_id: string };
        Returns: undefined;
      };
      record_attendance_and_recovery: {
        Args: {
          p_work_date: string;
          p_rows: { employee_id: string; status: string; work_mode: string | null; hours_worked: number | null }[];
        };
        Returns: { attendance_employee_id: string; credited: boolean; reversed: boolean; needs_policy_review: boolean }[];
      };
      delete_attendance_record: {
        Args: { p_record_id: string };
        Returns: undefined;
      };
      submit_leave_request: {
        Args: {
          p_leave_type_code: string;
          p_start_date: string;
          p_end_date: string;
          p_half_day_start: boolean;
          p_half_day_end: boolean;
          p_total_days: number;
          p_reason: string | null;
        };
        Returns: string;
      };
      revoke_role_grant: {
        Args: { p_role_grant_id: string };
        Returns: undefined;
      };
      set_account_status: {
        Args: { p_user_id: string; p_new_status: AccountStatus; p_reason: string };
        Returns: undefined;
      };
      log_security_event: {
        Args: {
          p_action: string;
          p_target_user_id?: string | null;
          p_email?: string | null;
          p_metadata?: Record<string, unknown>;
        };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: AppRole;
      account_status: AccountStatus;
      employment_status: EmploymentStatus;
      employment_type: EmploymentType;
      contract_type: ContractType;
      policy_type: PolicyType;
      policy_status: PolicyStatus;
      leave_ledger_entry_type: LeaveLedgerEntryType;
      comp_day_entry_type: CompDayEntryType;
      request_status: RequestStatus;
      approval_decision: ApprovalDecision;
      approvable_entity: ApprovableEntity;
      document_status: DocumentStatus;
      asset_status: AssetStatus;
      letter_status: LetterStatus;
      ai_draft_status: AiDraftStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
