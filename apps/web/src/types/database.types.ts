/**
 * Hand-written to match supabase/migrations/20260922000000_phase0_foundations.sql,
 * 20260924000000_phase1_contracts_compensation_identity.sql,
 * 20260925000000_phase2_country_policy_engine.sql, and
 * 20260926000000_phase3_leave_and_approvals.sql exactly. Once a real
 * Supabase project exists, regenerate this file with `npm run db:types`
 * (root package.json) instead of hand-editing it — see
 * docs/09-extending-the-system.md "adding a table" checklist, which ends
 * with this regeneration step for exactly that reason.
 */

export type AppRole = "employee" | "line_manager" | "hr_admin" | "finance" | "ceo" | "sys_admin";
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
export type ApprovalDecision = "pending" | "approved" | "rejected" | "skipped";
export type ApprovableEntity =
  | "leave_request"
  | "reimbursement_claim"
  | "timesheet"
  | "generated_letter"
  | "onboarding_task"
  | "offboarding_task"
  | "payroll_export_run";

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
    };
    CompositeTypes: Record<string, never>;
  };
}
