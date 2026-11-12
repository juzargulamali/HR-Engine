import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";
import type { DeliveryPlan } from "./model";

export type DeliveryPlanResult = { state: "ok"; plan: DeliveryPlan } | { state: "not_installed" } | { state: "denied" } | { state: "error" };

/**
 * The Delivery Plan of one project for the signed-in person, from the database function that checks access itself (anyone who can read the project's details). Four separate
 * answers: the plan (possibly empty), the migration is not applied here, the database refused this person, or the read failed.
 */
export async function loadDeliveryPlan(projectId: string): Promise<DeliveryPlanResult> {
  const { data, error } = await (await createClient()).rpc("proj_dp_plan", { p_project_id: projectId });
  if (error) {
    if (isNotInstalled(error)) return { state: "not_installed" };
    if (error.code === "P0002" || error.code === "42501") return { state: "denied" };
    console.error("[projects] delivery plan load failed", error.message);
    return { state: "error" };
  }
  return data && typeof data === "object" ? { state: "ok", plan: data as unknown as DeliveryPlan } : { state: "error" };
}
