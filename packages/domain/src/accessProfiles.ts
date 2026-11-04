/**
 * Working profiles for People & Access -> Module access. ONE definition per profile (id, label, description, exclusions, capability bundle,
 * warehouse-scope requirement) used by the overview cards, the editor, the review summary and the capabilities that are saved, so they cannot
 * drift. A profile adds NO power: it is a named bundle of capabilities that already exist, checked against the database functions that enforce
 * them (see docs/people-access-design.md and the mapping table in the pull request). Who may grant what is unchanged (peopleAccess.ts, evaluateGrant)
 * and is enforced by the database grant functions.
 *
 * Projects deliberately has no company-wide PM profile: PM assignment and project team membership are managed on the project or handover.
 */
import { capabilityInfo, normaliseCapabilities, type AccessModule } from "./peopleAccess";

export type WarehouseScope = "chosen" | "all";

export interface AccessProfile {
  id: string;
  module: AccessModule;
  label: string;
  /** What it permits, in one plain sentence. */
  description: string;
  /** What it does NOT permit (important exclusions). */
  exclusions: string;
  /** The capabilities saved when this profile is chosen. Empty: basic access to the module. */
  capabilities: readonly string[];
  /** Inventory only: the profile cannot be saved until the warehouse scope has been chosen explicitly. */
  warehouseScope?: WarehouseScope;
}

const PR = (module: AccessModule, id: string, label: string, description: string, exclusions: string, capabilities: readonly string[], warehouseScope?: WarehouseScope): AccessProfile =>
  ({ id, module, label, description, exclusions, capabilities, ...(warehouseScope ? { warehouseScope } : {}) });

export const ACCESS_PROFILES: Record<AccessModule, readonly AccessProfile[]> = {
  inventory: [
    PR("inventory", "warehouse-operator", "Warehouse operator", "Receives, issues, returns, transfers and counts stock at the chosen warehouses, and reads stock there.", "Cannot confirm counts or correct movements, manage the catalogue, see purchase costs or give access.", ["warehouse"], "chosen"),
    PR("inventory", "warehouse-lead", "Warehouse lead", "As a warehouse operator, at every location of the company, including ones added later.", "Cannot confirm counts or correct movements, manage the catalogue, see purchase costs or give access.", ["warehouse", "cross_location"], "all"),
    PR("inventory", "stock-viewer", "Stock viewer", "Reads every unit, quantity and movement, including who holds what. Read only.", "Cannot receive, issue, transfer or count stock, and cannot see purchase costs.", ["view_stock"]),
    PR("inventory", "equipment-viewer", "Employee equipment viewer", "Sees which company equipment each employee holds, for onboarding and exit.", "Cannot see other stock or movements, and cannot change anything.", ["view_employee_custody"]),
  ],
  sales: [
    PR("sales", "sales-colleague", "Sales colleague", "Sees Sales for this company and works on their own opportunities and follow-ups.", "Cannot assign owners, reopen closed opportunities, change settings or give access.", []),
    PR("sales", "sales-lead", "Sales lead", "Everything a Sales colleague does, and assigns and reassigns owners and reopens a won or lost opportunity with a reason.", "Cannot change Sales settings or approval policy, read the audit trail or give access.", ["assign_owner", "reopen_closed"]),
  ],
  budget: [
    PR("budget", "budget-read-only", "Read-only", "Reads the company's project budgets. Changes nothing.", "Cannot record funds or expenses, or decide budgets.", ["view"]),
    PR("budget", "budget-finance", "Finance", "Records funds, receipts, returns and reimbursements, closes settlement, and decides budgets and final expenses submitted by Project Managers who do not hold Finance access.", "Cannot decide what someone with Finance access submits, and cannot give access.", ["finance"]),
    PR("budget", "budget-executive", "Executive approver", "Decides budgets, additional requests and final expenses submitted by someone with Finance access, and confirms and authorises closure of that settlement (a CEO or a CTO).", "Does not record funds or expenses and cannot give access.", ["executive_approver"]),
  ],
  projects: [
    PR("projects", "project-directory-viewer", "Project directory viewer", "Sees the directory of ongoing projects. Details only where added to a project.", "Gives no project details, no PM assignment, scope approval or access management.", []),
  ],
};

export const PROJECTS_PM_NOTE = "PM assignment and project team membership are managed on the project or handover.";

export const profileById = (module: AccessModule, id: string | null | undefined) => (id ? ACCESS_PROFILES[module].find((p) => p.id === id) ?? null : null);

// ---------------------------------------------------------------------------------------------------------------
// Advanced access: every capability of the module, in four groups
// ---------------------------------------------------------------------------------------------------------------

export interface AdvancedGroup { id: "operational" | "visibility" | "configuration" | "admin"; label: string; capabilities: readonly string[] }
const GROUP_LABEL: Record<AdvancedGroup["id"], string> = {
  operational: "Specialist operational rights",
  visibility: "Sensitive visibility (purchase costs, commercial information)",
  configuration: "Configuration",
  admin: "Access administration and founder powers",
};
const G = (spec: Record<AdvancedGroup["id"], readonly string[]>): readonly AdvancedGroup[] =>
  (Object.keys(GROUP_LABEL) as AdvancedGroup["id"][]).filter((id) => spec[id].length > 0).map((id) => ({ id, label: GROUP_LABEL[id], capabilities: spec[id] }));

export const ADVANCED_GROUPS: Record<AccessModule, readonly AdvancedGroup[]> = {
  sales: G({ operational: ["assign_owner", "reopen_closed", "confirm_availability"], visibility: ["view_audit"], configuration: ["manage_settings", "manage_approval_rules"], admin: ["manage_access", "founder"] }),
  projects: G({ operational: ["assign_pm", "approve_scope", "reopen_project", "override_site_conflict"], visibility: ["view_commercial", "view_audit"], configuration: [], admin: ["manage_access", "founder"] }),
  inventory: G({ operational: ["warehouse", "cross_location", "confirm_stock", "request_for_employees"], visibility: ["view_stock", "view_employee_custody", "view_costs", "view_audit"], configuration: ["manage_catalogue"], admin: ["manage_access", "founder"] }),
  budget: G({ operational: ["finance", "executive_approver"], visibility: ["view"], configuration: [], admin: ["manage_access"] }),
};

// ---------------------------------------------------------------------------------------------------------------
// Recognising current access from the actual capabilities (never from a job title)
// ---------------------------------------------------------------------------------------------------------------

export interface RecognisedAccess {
  profile: AccessProfile | null;
  /** Rights held beyond the profile's bundle (all rights when no profile fits). */
  extras: string[];
  /** No standard profile describes this access on its own. */
  custom: boolean;
}

/** The profile whose bundle is exactly what is held; else the largest non-empty bundle fully held, with the rest as extras; else custom. */
export function recogniseAccess(module: AccessModule, capabilities: readonly string[]): RecognisedAccess {
  const held = normaliseCapabilities(module, capabilities);
  const profiles = ACCESS_PROFILES[module];
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((c) => b.includes(c));
  const exact = profiles.find((p) => same(p.capabilities, held));
  if (exact) return { profile: exact, extras: [], custom: false };
  const contained = profiles.filter((p) => p.capabilities.length > 0 && p.capabilities.every((c) => held.includes(c))).sort((a, b) => b.capabilities.length - a.capabilities.length)[0];
  if (contained) return { profile: contained, extras: held.filter((c) => !contained.capabilities.includes(c)), custom: false };
  return { profile: null, extras: held, custom: true };
}

/** The label shown on a card: the profile, or "Custom access". */
export const accessLabel = (r: RecognisedAccess) => r.profile?.label ?? "Custom access";

export function warehouseScopeOf(capabilities: readonly string[]): WarehouseScope | "founder" | null {
  if (capabilities.includes("founder")) return "founder";
  if (!capabilities.includes("warehouse")) return null;
  return capabilities.includes("cross_location") ? "all" : "chosen";
}

// ---------------------------------------------------------------------------------------------------------------
// The edit draft: a profile (the bundle), custom rights on top, and the explicit Inventory warehouse scope. Pure functions, so the screen only renders them.
// ---------------------------------------------------------------------------------------------------------------

export interface AccessDraft {
  profileId: string | null;
  /** Rights beyond the profile's bundle: custom rights kept from before, or ticked under Advanced access. */
  extras: string[];
  /** Inventory: chosen explicitly (null until chosen). Not needed without the warehouse right, or for a founder. */
  scope: WarehouseScope | null;
  locationIds: string[];
}

const bundleOf = (module: AccessModule, profileId: string | null) => profileById(module, profileId)?.capabilities ?? [];

export function draftCapabilities(module: AccessModule, d: Pick<AccessDraft, "profileId" | "extras">): string[] {
  return normaliseCapabilities(module, [...bundleOf(module, d.profileId), ...d.extras]);
}

/** Opening the editor changes nothing: the draft is exactly what the person holds now (null: no access yet). */
export function initialDraft(module: AccessModule, original: readonly string[] | null, assignedLocationIds: readonly string[]): AccessDraft {
  if (original === null) return { profileId: null, extras: [], scope: null, locationIds: [...assignedLocationIds] };
  const r = recogniseAccess(module, original);
  const held = normaliseCapabilities(module, original);
  const sc = warehouseScopeOf(held);
  return { profileId: r.profile?.id ?? null, extras: r.extras, scope: sc === "all" || sc === "chosen" ? sc : null, locationIds: [...assignedLocationIds] };
}

/** Choosing a profile replaces only the previous profile's bundle. Custom rights stay. The scope must be chosen again unless it is what the person already has. */
export function chooseProfile(module: AccessModule, d: AccessDraft, profileId: string, original: readonly string[] | null): AccessDraft {
  const p = profileById(module, profileId);
  if (!p) return d;
  const originalScope = original ? warehouseScopeOf(normaliseCapabilities(module, original)) : null;
  const scope = p.warehouseScope && originalScope === p.warehouseScope ? p.warehouseScope : null;
  // cross_location belongs to the scope choice, not to the custom rights.
  const extras = d.extras.filter((c) => c !== "cross_location" || !p.warehouseScope);
  return { ...d, profileId, extras, scope };
}

/**
 * Tick or untick one right. A right outside the profile is simply added or dropped. Unticking a right that belongs to the profile is an explicit decision to leave the
 * standard profile: the rest of its bundle stays as custom rights (nothing else is removed).
 */
export function toggleExtra(module: AccessModule, d: AccessDraft, capability: string, on: boolean): AccessDraft {
  const bundle = bundleOf(module, d.profileId);
  if (bundle.includes(capability)) {
    if (on) return d;
    return { ...d, profileId: null, extras: normaliseCapabilities(module, [...bundle, ...d.extras].filter((c) => c !== capability)) };
  }
  const extras = on ? [...new Set([...d.extras, capability])] : d.extras.filter((c) => c !== capability);
  return { ...d, extras: normaliseCapabilities(module, extras) };
}

/** Inventory scope: "all" adds all-locations authority, "chosen" removes it. The two warehouse profiles follow the choice. */
export function chooseScope(module: AccessModule, d: AccessDraft, scope: WarehouseScope): AccessDraft {
  const ws = ACCESS_PROFILES[module].filter((p) => p.warehouseScope);
  const target = ws.find((p) => p.warehouseScope === scope);
  const extras = d.extras.filter((c) => c !== "cross_location");
  const current = profileById(module, d.profileId);
  if (current?.warehouseScope && target) return { ...d, profileId: target.id, extras, scope };
  return { ...d, extras: scope === "all" ? normaliseCapabilities(module, [...extras, "cross_location"]) : extras, scope };
}

export interface AccessReview {
  caps: string[];
  profile: AccessProfile | null;
  added: string[];
  removed: string[];
  /** Custom rights the person already holds that stay (beyond the profile's bundle). */
  retained: string[];
  changed: boolean;
  /** Inventory: the person will hold the warehouse right (not as a founder). */
  needsScope: boolean;
  scopeMissing: boolean;
  locationsMissing: boolean;
  /** Removals must be confirmed explicitly. */
  needsRemovalConfirm: boolean;
  /** Plain-language result, derived from the profile and capability definitions. */
  summary: string[];
}

/** Plain-language summary of a set of rights, from the same definitions the cards and editor use. */
export function summariseAccess(module: AccessModule, caps: readonly string[]): string[] {
  const r = recogniseAccess(module, caps);
  const lines: string[] = [];
  if (r.profile) lines.push(`${r.profile.label}: ${r.profile.description}`);
  else if (caps.length === 0) lines.push("No rights beyond being listed for this company.");
  for (const c of r.extras) lines.push(`${capabilityInfo(module, c).label}: ${capabilityInfo(module, c).description}`);
  if (r.profile) lines.push(`Not included: ${r.profile.exclusions}`);
  return lines;
}

export function reviewDraft(module: AccessModule, d: AccessDraft, original: readonly string[] | null, assignedLocationIds: readonly string[]): AccessReview {
  const caps = draftCapabilities(module, d);
  const before = original === null ? [] : normaliseCapabilities(module, original);
  const added = caps.filter((c) => !before.includes(c));
  const removed = before.filter((c) => !caps.includes(c));
  const bundle = bundleOf(module, d.profileId);
  const retained = original === null ? [] : caps.filter((c) => before.includes(c) && !bundle.includes(c));
  const needsScope = module === "inventory" && caps.includes("warehouse") && !caps.includes("founder");
  const scopeMissing = needsScope && d.scope === null;
  const locationsMissing = needsScope && d.scope === "chosen" && d.locationIds.length === 0;
  const locationsChanged = needsScope && d.scope === "chosen" && [...d.locationIds].sort().join(",") !== [...assignedLocationIds].sort().join(",");
  const changed = original === null ? (module !== "budget" || caps.length > 0) : added.length > 0 || removed.length > 0 || locationsChanged;
  return {
    caps, profile: profileById(module, d.profileId), added, removed, retained, changed, needsScope, scopeMissing, locationsMissing,
    needsRemovalConfirm: removed.length > 0, summary: summariseAccess(module, caps),
  };
}

