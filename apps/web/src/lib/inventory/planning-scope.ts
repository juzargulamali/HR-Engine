import "server-only";
import { hasInvCapability, isProjFounder } from "@enginious-hr/domain";
import { getProjectsContext } from "@/lib/projects/context";
import type { InventoryContext } from "./context";
import { loadLiveProjects, loadTechnologyNames } from "./planning-data";
import type { AvailabilityScope } from "@/components/inventory/planning/availability-dialog";
import type { QuickAddScope } from "@/components/inventory/planning/requests-quick-add";
import type { InvLocationRow } from "@/types/inventory";

/**
 * What the New request form offers this person. Projects: those they manage (the project manager, or a Projects founder) and, for
 * warehouse people, the live projects of their company; employees: only where they hold the right to ask for equipment for employees
 * (or work in the warehouse). The database checks every one of these again; this only keeps the lists honest.
 */
export async function buildQuickAddScope(ctx: InventoryContext, locations: readonly InvLocationRow[]): Promise<QuickAddScope> {
  const pctx = await getProjectsContext().catch(() => null);
  const projects = await loadLiveProjects().catch(() => []);
  const manageable = projects.filter((p) =>
    p.pmUserId === ctx.userId || (pctx ? isProjFounder(pctx.grants, p.companyId) : false) || hasInvCapability(ctx.grants, p.companyId, "warehouse"));
  return {
    companies: ctx.companies.map((c) => ({ id: c.id, name: c.name, canEmployee: hasInvCapability(ctx.grants, c.id, "request_for_employees") || hasInvCapability(ctx.grants, c.id, "warehouse") })),
    projects: manageable.map((p) => ({ id: p.id, name: p.name, reference: p.reference, companyId: p.companyId })),
    locations: locations.map((l) => ({ id: l.id, name: l.name, companyId: l.company_id })),
  };
}

export async function buildAvailabilityScope(ctx: InventoryContext, locations: readonly InvLocationRow[]): Promise<AvailabilityScope> {
  const technologies = await loadTechnologyNames().catch(() => []);
  const companyIds = [...new Set(locations.map((l) => l.company_id))];
  return {
    companies: companyIds.map((id) => ({ id, name: ctx.companyName(id) })),
    locations: locations.map((l) => ({ id: l.id, name: l.name, companyId: l.company_id, timezone: l.timezone })),
    technologies,
  };
}
