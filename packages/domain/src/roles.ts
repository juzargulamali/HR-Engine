/**
 * The seven roles from docs/03-permission-matrix.md. `cto` is a full peer of
 * `ceo` everywhere in this system (identical read access and identical
 * approval authority — see resolve_approver()/resolve_approver_for_company()
 * in schema.sql, which treat a `role:ceo` approval step as satisfied by
 * either). Adding a role later is a three-line change here plus a migration
 * adding the enum value — see docs/09-extending-the-system.md.
 */
export const ROLES = [
  "employee",
  "line_manager",
  "hr_admin",
  "finance",
  "ceo",
  "cto",
  "sys_admin",
] as const;

export type AppRole = (typeof ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  employee: "Employee",
  line_manager: "Line Manager",
  hr_admin: "HR Admin",
  finance: "Finance",
  ceo: "CEO",
  cto: "CTO",
  sys_admin: "System Administrator",
};

export function isAppRole(value: string): value is AppRole {
  return (ROLES as readonly string[]).includes(value);
}
