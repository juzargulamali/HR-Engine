/**
 * Inventory permission mirrors. Inventory access is its own grant table (inv_company_grants), deliberately NOT user_roles, NOT
 * crm_company_grants and NOT proj_company_grants: an HR role, a Sales grant, a Projects grant, an employee record or an e-mail domain
 * confers no Inventory access, and an Inventory grant confers no HR, Sales or Projects access. Purchase-cost visibility is its own
 * capability and is never implied by warehouse, Sales, HR or PM access. Each function mirrors the SQL it names in
 * supabase/migrations/20261201000*_inv_*.sql: the database is the real gate; these only decide what the UI offers.
 */

export const INV_CAPABILITIES = [
  "founder",
  "manage_access",
  "manage_catalogue",
  "warehouse",
  "cross_location",
  "view_stock",
  "view_costs",
  "view_audit",
  "confirm_stock",
  "request_for_employees",
  "view_employee_custody",
] as const;
export type InvCapability = (typeof INV_CAPABILITIES)[number];

export const INV_CAPABILITY_LABELS: Record<InvCapability, { label: string; description: string }> = {
  founder: { label: "Founder", description: "Everything below, for this company: all stock and movements, purchase costs, access, switching Inventory on or off." },
  manage_access: { label: "Manage Inventory access", description: "Give and withdraw Inventory access for this company (cannot hand out founder, access or cost rights)." },
  manage_catalogue: { label: "Manage the catalogue", description: "Categories, items, technology templates, locations and bins." },
  warehouse: { label: "Warehouse operator", description: "Receive, issue, dispatch, return, transfer and count stock at the locations assigned to the person." },
  cross_location: { label: "All locations", description: "Handle transfers and receipts at every location of the company, not only the assigned ones." },
  view_stock: { label: "See stock and movements", description: "Read every unit, quantity and movement, including who holds what. Read only." },
  view_costs: { label: "See purchase costs", description: "Read purchase dates, costs and currencies. Not shown to anyone else, whatever else they can do." },
  view_audit: { label: "Read the Inventory audit trail", description: "See who changed what in Inventory." },
  confirm_stock: { label: "Confirm stock counts", description: "Mark opening stock and counts as verified." },
  request_for_employees: { label: "Request equipment for employees", description: "Department heads: ask the warehouse to issue equipment to an employee." },
  view_employee_custody: { label: "See equipment held by employees", description: "HR: which company equipment each employee holds, for onboarding and exit." },
};

export interface InvGrant {
  companyId: string;
  capabilities: readonly InvCapability[];
}

/** inv_has_access */
export const hasInvAccess = (grants: readonly InvGrant[], companyId: string) => grants.some((g) => g.companyId === companyId);

/** inv_has_capability: 'founder' implies every capability. */
export function hasInvCapability(grants: readonly InvGrant[], companyId: string, capability: InvCapability): boolean {
  return grants.some((g) => g.companyId === companyId && (g.capabilities.includes("founder") || g.capabilities.includes(capability)));
}

/** inv_is_founder */
export const isInvFounder = (grants: readonly InvGrant[], companyId: string) =>
  grants.some((g) => g.companyId === companyId && g.capabilities.includes("founder"));
export const isAnyInvFounder = (grants: readonly InvGrant[]) => grants.some((g) => g.capabilities.includes("founder"));
export const hasAnyInvAccess = (grants: readonly InvGrant[]) => grants.length > 0;
export const invCompanyIds = (grants: readonly InvGrant[]) => [...new Set(grants.map((g) => g.companyId))];

/** inv_grant_access / inv_revoke_access (founder or manage_access; founder, access and cost rights themselves need a founder). */
export const canManageInvAccess = (grants: readonly InvGrant[], companyId: string) => hasInvCapability(grants, companyId, "manage_access");
export const canGrantInvFounderRights = (grants: readonly InvGrant[], companyId: string) => isInvFounder(grants, companyId);

/** inv_can_view_stock: founder, warehouse or view_stock. Everyone else sees the catalogue summary only. */
export const canViewStock = (grants: readonly InvGrant[], companyId: string) =>
  hasInvCapability(grants, companyId, "warehouse") || hasInvCapability(grants, companyId, "view_stock");
export const canSeeCosts = (grants: readonly InvGrant[], companyId: string) => hasInvCapability(grants, companyId, "view_costs");
export const canManageCatalogue = (grants: readonly InvGrant[], companyId: string) => hasInvCapability(grants, companyId, "manage_catalogue");
export const canConfirmStock = (grants: readonly InvGrant[], companyId: string) => hasInvCapability(grants, companyId, "confirm_stock");
export const canReadInvAudit = (grants: readonly InvGrant[], companyId: string) => hasInvCapability(grants, companyId, "view_audit");
export const canRequestForEmployees = (grants: readonly InvGrant[], companyId: string) => hasInvCapability(grants, companyId, "request_for_employees");
export const canSeeEmployeeCustody = (grants: readonly InvGrant[], companyId: string) => hasInvCapability(grants, companyId, "view_employee_custody");

/**
 * inv_can_operate: may the person operate stock at one location? Founders: every location. A warehouse operator: the locations they
 * are assigned to, or every location with 'cross_location'.
 */
export function canOperateLocation(grants: readonly InvGrant[], companyId: string, locationId: string, assignedLocationIds: readonly string[]): boolean {
  if (isInvFounder(grants, companyId)) return true;
  if (!hasInvCapability(grants, companyId, "warehouse")) return false;
  return hasInvCapability(grants, companyId, "cross_location") || assignedLocationIds.includes(locationId);
}

/** Does the person operate any stock at all (shows Receive, Issue, Return, Transfer)? */
export const canOperateAnyStock = (grants: readonly InvGrant[]) =>
  grants.some((g) => g.capabilities.includes("founder") || g.capabilities.includes("warehouse"));
