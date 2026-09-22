/**
 * Hand-written to match supabase/migrations/20260922000000_phase0_foundations.sql
 * exactly. Once a real Supabase project exists, regenerate this file with
 * `npm run db:types` (root package.json) instead of hand-editing it — see
 * docs/09-extending-the-system.md "adding a table" checklist, which ends
 * with this regeneration step for exactly that reason.
 */

export type AppRole = "employee" | "line_manager" | "hr_admin" | "finance" | "ceo" | "sys_admin";
export type EmploymentStatus = "active" | "on_leave" | "suspended" | "terminated";
export type EmploymentType = "full_time" | "part_time" | "contractor" | "intern";

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
        Update: Partial<Database["public"]["Tables"]["employees"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      app_role: AppRole;
      employment_status: EmploymentStatus;
      employment_type: EmploymentType;
    };
    CompositeTypes: Record<string, never>;
  };
}
