import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "./errors";
import { parseParties, parseProjectHandover, type PartiesRead, type ProjectHandoverRead } from "./handover-parties";

/**
 * The agency and site contact of ONE handover, for the people who work it (proj_handover_parties decides who). A database without the function reads as "none",
 * so the page shows the handover as it did before; any other failure is "error" and is said, never shown as "no contact".
 */
export async function loadHandoverParties(handoverId: string): Promise<PartiesRead> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("proj_handover_parties", { p_handover_id: handoverId });
    if (isNotInstalled(error)) return { status: "none" };
    if (error) { console.error("[projects] handover parties read failed", error.message); return { status: "error" }; }
    const parties = parseParties(data);
    return parties ? { status: "ok", parties } : { status: "error" };
  } catch (e) {
    console.error("[projects] handover parties read threw", e);
    return { status: "error" };
  }
}

/** What the project shows of its accepted handover (proj_project_handover). */
export async function loadProjectHandoverDetails(projectId: string): Promise<ProjectHandoverRead> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("proj_project_handover", { p_project_id: projectId });
    if (isNotInstalled(error)) return { status: "none" };
    if (error) { console.error("[projects] project handover read failed", error.message); return { status: "error" }; }
    const details = parseProjectHandover(data);
    return details ? { status: "ok", details } : { status: "error" };
  } catch (e) {
    console.error("[projects] project handover read threw", e);
    return { status: "error" };
  }
}
