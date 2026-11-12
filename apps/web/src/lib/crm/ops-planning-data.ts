import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parseOpsPlanning, type OpsPlanningRead } from "./ops-planning";

/**
 * What Operations recorded against one enquiry (crm_ops_planning: anyone with Sales access to the enquiry's company). The function returns null when Operations
 * has recorded nothing, which is a successful read. Any error, a missing function included, is "could not load": the caller must say so and never show it as empty.
 */
export async function loadOpsPlanning(opportunityId: string): Promise<OpsPlanningRead> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("crm_ops_planning", { p_opportunity_id: opportunityId });
    if (error) {
      console.error("[crm] Operations planning read failed", error.message);
      return { kind: "failed" };
    }
    return { kind: "ok", planning: parseOpsPlanning(data) };
  } catch (e) {
    console.error("[crm] Operations planning read failed", e);
    return { kind: "failed" };
  }
}
