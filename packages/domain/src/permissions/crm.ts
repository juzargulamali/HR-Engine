/**
 * Sales & CRM permission mirrors. CRM access is its own grant table (crm_company_grants), deliberately NOT
 * user_roles: HR admin, Finance, CEO and sys_admin roles confer no CRM access, and a CRM grant confers no HR access.
 * Each function mirrors the SQL it names in supabase/migrations/20261115000*_crm_*.sql — the database is the real
 * gate; these only decide what the UI offers. Keep them in step with the SQL (the RLS tests are the contract).
 */

export const CRM_CAPABILITIES = [
  "founder",
  "assign_owner",
  "confirm_availability",
  "manage_settings",
  "manage_approval_rules",
  "manage_access",
  "view_audit",
] as const;
export type CrmCapability = (typeof CRM_CAPABILITIES)[number];

export const CRM_CAPABILITY_LABELS: Record<CrmCapability, { label: string; description: string }> = {
  founder: { label: "Founder", description: "Everything below, for this company: assign owners, close any opportunity, manage access, settings and approvals, read the audit trail." },
  assign_owner: { label: "Assign owners", description: "Assign and reassign who owns an opportunity." },
  confirm_availability: { label: "Confirm equipment availability", description: "Record that the technology is (or is not) available for the dates." },
  manage_settings: { label: "Manage Sales settings", description: "Reference code, default currency, response targets, calendar, reminders." },
  manage_approval_rules: { label: "Set commercial approval policy", description: "Decide whether commercial approval is required. Nothing can be approved until a policy is set." },
  manage_access: { label: "Manage Sales access", description: "Grant and revoke Sales access for this company (cannot grant founder rights)." },
  view_audit: { label: "Read the Sales audit trail", description: "See who changed what in this company's Sales records." },
};

export interface CrmGrant {
  companyId: string;
  capabilities: readonly CrmCapability[];
}

/** crm_has_access */
export function hasCrmAccess(grants: readonly CrmGrant[], companyId: string): boolean {
  return grants.some((g) => g.companyId === companyId);
}

/** crm_has_capability — 'founder' implies every capability. */
export function hasCrmCapability(grants: readonly CrmGrant[], companyId: string, capability: CrmCapability): boolean {
  return grants.some((g) => g.companyId === companyId && (g.capabilities.includes("founder") || g.capabilities.includes(capability)));
}

/** crm_is_founder — an explicit founder grant (not merely a delegated capability). */
export function isCrmFounder(grants: readonly CrmGrant[], companyId: string): boolean {
  return grants.some((g) => g.companyId === companyId && g.capabilities.includes("founder"));
}

export const isAnyCrmFounder = (grants: readonly CrmGrant[]) => grants.some((g) => g.capabilities.includes("founder"));
export const hasAnyCrmAccess = (grants: readonly CrmGrant[]) => grants.length > 0;
export const crmCompanyIds = (grants: readonly CrmGrant[]) => [...new Set(grants.map((g) => g.companyId))];

export interface CrmOpportunityRef {
  companyId: string;
  ownerId: string;
}

/** crm_require_owner_or_founder: stage moves, hold/resume, won/lost, edits, proposals, Zoho references. */
export function canEditOpportunity(grants: readonly CrmGrant[], opp: CrmOpportunityRef, userId: string): boolean {
  return hasCrmAccess(grants, opp.companyId) && (opp.ownerId === userId || isCrmFounder(grants, opp.companyId));
}

/** crm_assign_owner / owner choice on create. */
export const canAssignOwner = (grants: readonly CrmGrant[], companyId: string) => hasCrmCapability(grants, companyId, "assign_owner");

/** crm_confirm_availability — not the owner as such: only founders or someone they delegated. */
export const canConfirmAvailability = (grants: readonly CrmGrant[], companyId: string) => hasCrmCapability(grants, companyId, "confirm_availability");

/** crm_grant_access / crm_revoke_access (granting founder or manage_access additionally needs isCrmFounder). */
export const canManageCrmAccess = (grants: readonly CrmGrant[], companyId: string) => hasCrmCapability(grants, companyId, "manage_access");
export const canGrantFounderRights = (grants: readonly CrmGrant[], companyId: string) => isCrmFounder(grants, companyId);

/** crm_upsert_settings (the approval policy field additionally needs manage_approval_rules). */
export const canManageCrmSettings = (grants: readonly CrmGrant[], companyId: string) => hasCrmCapability(grants, companyId, "manage_settings");
export const canManageApprovalRules = (grants: readonly CrmGrant[], companyId: string) => hasCrmCapability(grants, companyId, "manage_approval_rules");

/** crm_decide_approval — founders only. */
export const canDecideApproval = (grants: readonly CrmGrant[], companyId: string) => isCrmFounder(grants, companyId);

/** crm_audit_log select policy. */
export const canViewCrmAudit = (grants: readonly CrmGrant[], companyId: string) => hasCrmCapability(grants, companyId, "view_audit");

/** crm_require_follow_up_actor: the assignee, the opportunity owner, or a founder. */
export function canActOnFollowUp(grants: readonly CrmGrant[], followUp: { assignedTo: string }, opp: CrmOpportunityRef, userId: string): boolean {
  return hasCrmAccess(grants, opp.companyId) && (followUp.assignedTo === userId || opp.ownerId === userId || isCrmFounder(grants, opp.companyId));
}

/** crm_remove_file: the uploader, the owner or a founder. */
export function canRemoveFile(grants: readonly CrmGrant[], file: { uploadedBy: string }, opp: CrmOpportunityRef, userId: string): boolean {
  return hasCrmAccess(grants, opp.companyId) && (file.uploadedBy === userId || opp.ownerId === userId || isCrmFounder(grants, opp.companyId));
}
