import "server-only";
import { hasInvCapability } from "@enginious-hr/domain";
import type { InventoryContext } from "./context";
import type { RequestModel } from "./planning-data";
import { createClient } from "@/lib/supabase/server";
import { loadRequestModels } from "./planning-data";
import { loadHeld } from "./stock";
import { countedHeldFromEquipment, heldTotals, requestItemTotals, withCountedZeros, type ItemTotals } from "./workspace";

/**
 * What the PROJECT holds, per counted item, for the honest Sent / Returned / Still out rules (see workspace.ts). People who may read stock get the
 * recorded holdings themselves; everyone else (a Project Manager) gets the same answer derived from `inv_project_equipment`, which they can already read.
 * `held: null` means it could not be read: the screen then says so and shows only what was sent, never a guessed "still out".
 */
export async function resolveProjectHeld(
  ctx: InventoryContext,
  p: { companyId: string; projectId: string; equipment: unknown | null; models: readonly RequestModel[] },
): Promise<{ held: Map<string, number> | null; unclear: Set<string> }> {
  if (hasInvCapability(ctx.grants, p.companyId, "warehouse") || hasInvCapability(ctx.grants, p.companyId, "view_stock")) {
    try {
      const rows = await loadHeld(ctx, { companyId: p.companyId, projectId: p.projectId });
      return { held: withCountedZeros(heldTotals(rows), p.models), unclear: new Set() };
    } catch (e) {
      console.error("[inventory] project holdings failed", e);
      return { held: null, unclear: new Set() };
    }
  }
  if (p.equipment === null) return { held: null, unclear: new Set() };
  return countedHeldFromEquipment(p.equipment, p.models);
}

/** The project's `inv_project_equipment` answer, or null when it could not be read (never an empty stand-in). */
export async function loadProjectEquipment(projectId: string): Promise<unknown | null> {
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("inv_project_equipment", { p_project_id: projectId });
    if (error) { console.error("[inventory] project equipment (returns) failed", error.message); return null; }
    return data;
  } catch (e) {
    console.error("[inventory] project equipment (returns) failed", e);
    return null;
  }
}

/**
 * Sent / Returned / Still out for one project request, for the request panel: loads the project's other requests (a counted return cannot be told apart
 * from theirs) and what the project holds, then applies the same rules as the request workspace. Anything that cannot be read is reported as such.
 */
export async function loadRequestReturns(ctx: InventoryContext, model: RequestModel): Promise<ItemTotals[] | undefined> {
  const r = model.request;
  if (r.kind !== "project" || !r.project_id) return undefined;
  let projectModels: RequestModel[] | null = null;
  try { projectModels = await loadRequestModels({ projectId: r.project_id }, ctx.userId); } catch (e) { console.error("[inventory] project requests (returns) failed", e); }
  if (!projectModels) return requestItemTotals(model, [model], null);
  const equipment = await loadProjectEquipment(r.project_id);
  const { held, unclear } = await resolveProjectHeld(ctx, { companyId: r.company_id, projectId: r.project_id, equipment, models: projectModels });
  return requestItemTotals(projectModels.find((m) => m.request.id === r.id) ?? model, projectModels, held, unclear);
}
