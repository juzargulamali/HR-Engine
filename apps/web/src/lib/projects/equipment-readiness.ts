import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "./errors";
import { parseReadiness, type EquipmentReadinessResult } from "./equipment-readiness-model";

/**
 * The readiness of one project's equipment for the signed-in person, from the database function that checks access itself (people who can read the project's details, the
 * company's Operations Managers and its warehouse). Four separate answers: the readiness (possibly with no request), the migration is not applied here, the database refused
 * this person, or the read failed. A failed read is never "nothing": the screens say "Equipment readiness could not be loaded".
 */
export async function loadEquipmentReadiness(projectId: string): Promise<EquipmentReadinessResult> {
  const { data, error } = await (await createClient()).rpc("proj_equipment_readiness", { p_project_id: projectId });
  if (error) {
    if (isNotInstalled(error)) return { state: "not_installed" };
    if (error.code === "P0002" || error.code === "42501") return { state: "denied" };
    console.error("[projects] equipment readiness load failed", error.message);
    return { state: "error" };
  }
  const readiness = parseReadiness(data);
  if (!readiness) { console.error("[projects] equipment readiness had an unexpected shape"); return { state: "error" }; }
  return { state: "ok", readiness };
}
