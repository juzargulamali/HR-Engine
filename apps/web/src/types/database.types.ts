/**
 * Hand-written to match supabase/migrations/20260922000000_phase0_foundations.sql,
 * 20260924000000_phase1_contracts_compensation_identity.sql,
 * 20260925000000_phase2_country_policy_engine.sql, and
 * 20260926000000_phase3_leave_and_approvals.sql,
 * 20260927000000_phase4_reimbursements_projects_timesheets.sql, and
 * 20260928000000_phase5_performance_onboarding_documents_assets.sql, and
 * 20260929000000_phase6_letters_payroll_audit_ai_drafts.sql exactly. Once a real
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
  | "payroll_export_run";
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
          created_at: string;
        };
        Insert: {
          code: string;
          name: string;
          default_currency: string;
          week_start_day?: number;
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          locale?: string;
          is_active?: boolean;
        };
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
          approver_id: string;
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
          approver_id: string;
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
        };
        Update: Partial<Database["public"]["Tables"]["attendance_records"]["Insert"]>;
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
      decide_leave_approval: {
        Args: { p_approval_id: string; p_decision: ApprovalDecision; p_comments?: string | null };
        Returns: undefined;
      };
      create_initial_approval: {
        Args: { p_entity_type: ApprovableEntity; p_entity_id: string };
        Returns: string;
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
        Returns: { employee_id: string; credited: boolean; reversed: boolean }[];
      };
    };
    Enums: {
      app_role: AppRole;
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
