/**
 * The six roles from docs/03-permission-matrix.md. Adding a role later is a
 * three-line change here plus a migration adding the enum value — see
 * docs/09-extending-the-system.md.
 */
export const ROLES = [
  "employee",
  "line_manager",
  "hr_admin",
  "finance",
  "ceo",
  "sys_admin",
] as const;

export type AppRole = (typeof ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  employee: "Employee",
  line_manager: "Line Manager",
  hr_admin: "HR Admin",
  finance: "Finance",
  ceo: "CEO",
  sys_admin: "System Administrator",
};

export function isAppRole(value: string): value is AppRole {
  return (ROLES as readonly string[]).includes(value);
}
