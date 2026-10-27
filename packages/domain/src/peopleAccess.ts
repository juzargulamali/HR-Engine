/**
 * People & Access: one screen that gathers where access is managed. It adds NO power of its own. Every rule here mirrors a rule the
 * database already enforces in the module's own grant functions (crm_/proj_/inv_/pbx_grant_access); these functions only decide what
 * the screen offers and explain a refusal before the database gives it. The database is the real gate.
 *
 * Capability meanings below were checked against the code that enforces them (supabase/migrations/20261115*, 20261120*, 20261201*,
 * 20261210*), see docs/people-access-design.md. A preset is only a named bundle of capabilities that already exist; it is applied on
 * top of what the person already holds, never instead of it, unless the person making the change unticks something themselves.
 */
import type { RoleGrant } from "./types";
import { isSysAdmin, hasRoleAnyScope } from "./permissions/core";
import { canEditEmployeeCore } from "./permissions/employees";
import { CRM_CAPABILITIES, CRM_CAPABILITY_LABELS } from "./permissions/crm";
import { PROJ_CAPABILITIES, PROJ_CAPABILITY_LABELS } from "./permissions/proj";
import { INV_CAPABILITIES, INV_CAPABILITY_LABELS } from "./permissions/inv";

export const ACCESS_MODULES = ["sales", "projects", "inventory", "budget"] as const;
export type AccessModule = (typeof ACCESS_MODULES)[number];

export const ACCESS_MODULE_LABELS: Record<AccessModule, string> = {
  sales: "Sales & CRM",
  projects: "Projects & Tasks",
  inventory: "Inventory",
  budget: "Project budgets",
};

/** Mirrors pbx_capability_list(). */
export const BUDGET_ACCESS_CAPABILITIES = ["finance", "executive_approver", "view", "manage_access"] as const;
export type BudgetAccessCapability = (typeof BUDGET_ACCESS_CAPABILITIES)[number];

export const BUDGET_CAPABILITY_LABELS: Record<BudgetAccessCapability, { label: string; description: string }> = {
  finance: { label: "Finance", description: "Records funds, receipts, returns and reimbursements, closes settlement, sets petrol and meal rates, and decides budgets and final expenses submitted by Project Managers who do not hold Finance access." },
  executive_approver: { label: "CEO / CTO approver", description: "Decides budgets, additional requests and final expenses submitted by someone who holds Finance access, and confirms the receipts and authorises the closure of that settlement. Either a CEO or a CTO is enough." },
  view: { label: "Read only", description: "Reads the company's project budgets. Changes nothing." },
  manage_access: { label: "Manage budget access", description: "Gives and withdraws project budget access for this company." },
};

export interface CapabilityInfo { label: string; description: string }

export function capabilitiesOf(module: AccessModule): readonly string[] {
  switch (module) {
    case "sales": return CRM_CAPABILITIES;
    case "projects": return PROJ_CAPABILITIES;
    case "inventory": return INV_CAPABILITIES;
    case "budget": return BUDGET_ACCESS_CAPABILITIES;
  }
}

export function capabilityInfo(module: AccessModule, capability: string): CapabilityInfo {
  const table = (
    module === "sales" ? CRM_CAPABILITY_LABELS
    : module === "projects" ? PROJ_CAPABILITY_LABELS
    : module === "inventory" ? INV_CAPABILITY_LABELS
    : BUDGET_CAPABILITY_LABELS
  ) as Record<string, CapabilityInfo>;
  return table[capability] ?? { label: capability, description: "" };
}

/** Put capabilities in the module's own order, once each, dropping anything that is not one of its capabilities. */
export function normaliseCapabilities(module: AccessModule, capabilities: readonly string[]): string[] {
  const held = new Set(capabilities);
  return capabilitiesOf(module).filter((c) => held.has(c));
}

// ---------------------------------------------------------------------------------------------------------------
// Who may give what (unchanged from the module screens and grant functions)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Rights only a founder may give, change or remove. Sales: founder and access management (crm_grant_access). Projects: the same
 * (proj_grant_access). Inventory: those two and cost visibility (inv_grant_access). Budget has no founder: any holder of access
 * management may give any budget capability today (pbx_grant_access); a proposal to narrow that is a separate decision.
 */
export function founderOnlyCapabilities(module: AccessModule): readonly string[] {
  switch (module) {
    case "sales":
    case "projects": return ["founder", "manage_access"];
    case "inventory": return ["founder", "manage_access", "view_costs"];
    case "budget": return [];
  }
}

export const isFounderIn = (module: AccessModule, viewerCapabilities: readonly string[]) => module !== "budget" && viewerCapabilities.includes("founder");

/** crm_/proj_/inv_has_capability('manage_access') treats a founder as holding every capability; Budget needs the explicit capability. */
export const canManageModuleAccess = (module: AccessModule, viewerCapabilities: readonly string[]) =>
  viewerCapabilities.includes("manage_access") || isFounderIn(module, viewerCapabilities);

/** Capabilities this viewer may include in a grant for a company. */
export function grantableCapabilities(module: AccessModule, viewerCapabilities: readonly string[]): string[] {
  if (!canManageModuleAccess(module, viewerCapabilities)) return [];
  const founder = isFounderIn(module, viewerCapabilities);
  const restricted = founderOnlyCapabilities(module);
  return capabilitiesOf(module).filter((c) => founder || !restricted.includes(c));
}

/** The database refuses a non-founder who changes (or withdraws) a person who holds a founder-only right; the screen says so up front. */
export function targetLockedForViewer(module: AccessModule, viewerCapabilities: readonly string[], targetCapabilities: readonly string[]): boolean {
  if (isFounderIn(module, viewerCapabilities)) return false;
  const restricted = founderOnlyCapabilities(module);
  return targetCapabilities.some((c) => restricted.includes(c));
}

export function founderOnlyExplanation(module: AccessModule): string {
  switch (module) {
    case "sales": return "Only a Sales founder can give founder or access-management rights.";
    case "projects": return "Only a Projects founder can give founder or access-management rights.";
    case "inventory": return "Only an Inventory founder can give founder, access-management or cost rights.";
    case "budget": return "";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------------------------

export interface AccessPreset {
  id: string;
  label: string;
  /** One plain sentence, written from what the code enforces. */
  summary: string;
  capabilities: readonly string[];
  /** Needs extra setup beyond the capabilities (Inventory warehouse locations). */
  note?: string;
}

const P = (id: string, label: string, summary: string, capabilities: readonly string[], note?: string): AccessPreset => ({ id, label, summary, capabilities, ...(note ? { note } : {}) });

export const ACCESS_PRESETS: Record<AccessModule, readonly AccessPreset[]> = {
  sales: [
    P("sales-basic", "Basic Sales access", "Sees Sales for this company and works on their own opportunities and follow-ups.", []),
    P("sales-lead", "Sales lead", "Assigns and reassigns owners, and reopens a won or lost opportunity with a reason.", ["assign_owner", "reopen_closed"]),
    P("sales-availability", "Availability confirmer", "Records whether the technology is available for the dates.", ["confirm_availability"]),
    P("sales-admin", "Sales administrator", "Edits the company's Sales settings and reads its audit trail.", ["manage_settings", "view_audit"]),
    P("sales-rules", "Approval policy owner", "Decides whether commercial approval is required.", ["manage_approval_rules"]),
    P("sales-access", "Sales access manager", "Gives and withdraws Sales access (not founder rights).", ["manage_access"]),
    P("sales-founder", "Sales founder", "Everything in Sales for this company.", ["founder"]),
  ],
  projects: [
    P("projects-basic", "Directory only", "Sees the directory of ongoing projects. Details only where added to a project.", []),
    P("projects-coordinator", "Project coordinator", "Names Project Managers and creates internal projects, reopens completed projects, confirms overlapping site bookings.", ["assign_pm", "reopen_project", "override_site_conflict"]),
    P("projects-scope", "Scope approver", "Approves or rejects a change to the agreed scope of a client project.", ["approve_scope"]),
    P("projects-commercial", "Commercial viewer", "Reads the cost effect recorded against a scope change.", ["view_commercial"]),
    P("projects-audit", "Audit reader", "Reads who changed what in the company's projects.", ["view_audit"]),
    P("projects-access", "Projects access manager", "Gives and withdraws Projects access (not founder rights).", ["manage_access"]),
    P("projects-founder", "Projects founder", "Everything in Projects for this company.", ["founder"]),
  ],
  inventory: [
    P("inventory-basic", "Catalogue summary", "Sees item names, categories and what is usable.", []),
    P("inventory-storekeeper", "Storekeeper", "Receives, issues, returns, transfers and counts stock at the locations they are assigned to, and reads stock there.", ["warehouse"], "Choose the locations this person works at."),
    P("inventory-stock-lead", "Stock lead (all locations)", "As Storekeeper, at every location of the company.", ["warehouse", "cross_location"]),
    P("inventory-viewer", "Stock viewer", "Reads every unit, quantity and movement, including who holds what. Read only.", ["view_stock"]),
    P("inventory-controller", "Stock controller", "Confirms counts and opening stock, and corrects movements.", ["confirm_stock"]),
    P("inventory-catalogue", "Catalogue manager", "Manages categories, items, technology templates, locations and bins.", ["manage_catalogue"]),
    P("inventory-requester", "Equipment requester", "Department heads asking the warehouse to issue equipment to an employee.", ["request_for_employees"]),
    P("inventory-custody", "Custody reader", "Sees which company equipment each employee holds, for onboarding and exit.", ["view_employee_custody"]),
    P("inventory-audit", "Audit reader", "Reads who changed what in Inventory.", ["view_audit"]),
    P("inventory-costs", "Cost reader", "Reads purchase dates, costs and currencies.", ["view_costs"]),
    P("inventory-access", "Inventory access manager", "Gives and withdraws Inventory access (not founder, access or cost rights).", ["manage_access"]),
    P("inventory-founder", "Inventory founder", "Everything in Inventory for this company, including costs and access.", ["founder"]),
  ],
  budget: [
    P("budget-viewer", "Read only", BUDGET_CAPABILITY_LABELS.view.description, ["view"]),
    P("budget-finance", "Finance", BUDGET_CAPABILITY_LABELS.finance.description, ["finance"]),
    P("budget-approver", "CEO / CTO approver", BUDGET_CAPABILITY_LABELS.executive_approver.description, ["executive_approver"]),
    P("budget-access", "Budget access manager", BUDGET_CAPABILITY_LABELS.manage_access.description, ["manage_access"]),
  ],
};

export function presetById(module: AccessModule, presetId: string): AccessPreset | undefined {
  return ACCESS_PRESETS[module].find((p) => p.id === presetId);
}

/** Preserve what the person has: a preset ADDS its capabilities to the current set. Taking something away is always an explicit untick. */
export function applyPreset(module: AccessModule, current: readonly string[], preset: AccessPreset): string[] {
  return normaliseCapabilities(module, [...current, ...preset.capabilities]);
}

export interface CapabilityDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

export function diffCapabilities(module: AccessModule, before: readonly string[], after: readonly string[]): CapabilityDiff {
  const b = new Set(normaliseCapabilities(module, before));
  const a = new Set(normaliseCapabilities(module, after));
  const order = capabilitiesOf(module);
  return {
    added: order.filter((c) => a.has(c) && !b.has(c)),
    removed: order.filter((c) => b.has(c) && !a.has(c)),
    unchanged: order.filter((c) => a.has(c) && b.has(c)),
  };
}

export const isNoChange = (d: CapabilityDiff) => d.added.length === 0 && d.removed.length === 0;

/** Names for what a person holds: every non-empty preset whose capabilities they all hold, then any rights not covered by one. */
export function describeAccess(module: AccessModule, capabilities: readonly string[]): { presets: AccessPreset[]; extra: string[]; basic: boolean } {
  const held = new Set(normaliseCapabilities(module, capabilities));
  const presets = ACCESS_PRESETS[module].filter((p) => p.capabilities.length > 0 && p.capabilities.every((c) => held.has(c)));
  const covered = new Set(presets.flatMap((p) => p.capabilities));
  const extra = [...held].filter((c) => !covered.has(c));
  return { presets, extra, basic: held.size === 0 };
}

/** Why a preset cannot be added by this viewer, in plain words; null when they may. Mirrors the database refusal. */
export function presetBlockedReason(module: AccessModule, viewerCapabilities: readonly string[], preset: AccessPreset): string | null {
  const allowed = new Set(grantableCapabilities(module, viewerCapabilities));
  return preset.capabilities.every((c) => allowed.has(c)) ? null : founderOnlyExplanation(module);
}

// ---------------------------------------------------------------------------------------------------------------
// Who sees what on the screen
// ---------------------------------------------------------------------------------------------------------------

export interface ModuleGrantRef { module: AccessModule; companyId: string; capabilities: readonly string[] }

/** The (module, company) pairs this person may manage access for: founders and access managers, as the module screens did. */
export function managedAccess(grants: readonly ModuleGrantRef[]): { module: AccessModule; companyId: string; isFounder: boolean }[] {
  return grants
    .filter((g) => canManageModuleAccess(g.module, g.capabilities))
    .map((g) => ({ module: g.module, companyId: g.companyId, isFounder: isFounderIn(g.module, g.capabilities) }));
}

/** Accounts and HR roles: System Administrator only (user_roles_insert_sysadmin, revoke_role_grant, the account-status actions). */
export const canManageAccountsAndRoles = (roles: readonly RoleGrant[]) => isSysAdmin(roles);

/** Mirrors employees_update_hr (the same check the employee record uses): HR Admin of the employee's company. A System Administrator can read employee rows but not edit them. */
export const canEditJobDetails = canEditEmployeeCore;

/** The screen is offered to anyone who can manage at least one thing in it. */
export function canUsePeopleAccess(roles: readonly RoleGrant[], grants: readonly ModuleGrantRef[]): boolean {
  return isSysAdmin(roles) || hasRoleAnyScope(roles, "hr_admin") || managedAccess(grants).length > 0;
}
