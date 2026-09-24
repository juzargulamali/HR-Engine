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

/**
 * Display priority for a signed-in user's role badges — most senior/
 * authoritative first, most junior last. Presentation only (the account
 * menu's badge order, and which single role to show where space is
 * constrained, e.g. the collapsed sidebar); it has no bearing on
 * authorization, which is entirely unaffected by this ordering.
 */
export const ROLE_PRIORITY_ORDER: readonly AppRole[] = ["sys_admin", "ceo", "cto", "hr_admin", "finance", "line_manager", "employee"];

/**
 * Sorts a set of held roles by ROLE_PRIORITY_ORDER (most senior first) and
 * drops duplicates — a user can hold the same role more than once via
 * separate company/country-scoped grants, and the badge list should show
 * each distinct role exactly once regardless of how many scoped grants back
 * it. Roles not present in `roles` are simply absent from the result; this
 * never adds a role the caller doesn't already hold.
 */
export function sortRolesByPriority(roles: readonly AppRole[]): AppRole[] {
  const held = new Set(roles);
  return ROLE_PRIORITY_ORDER.filter((role) => held.has(role));
}

/**
 * The account menu's one shared source for "which role badges to show, in
 * what order" — SidebarNav/UserMenu (and CommandPalette, indirectly) all
 * receive this same computed list rather than each re-deriving it, the same
 * "single shared source" principle nav-groups.ts already follows for links.
 */
export function roleLabelsFor(grants: readonly { role: AppRole }[]): string[] {
  return sortRolesByPriority(grants.map((g) => g.role)).map((role) => ROLE_LABELS[role]);
}
