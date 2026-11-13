import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/log";
import type { SiteAssignment } from "@/lib/projects/site-assignments";

/** The person's own site assignments for My Day (the scoped read; nothing from the project). A failed read is "error", never an empty list. */
export async function loadSiteAssignments(): Promise<SiteAssignment[] | "error"> {
  try {
    const { data, error } = await (await createClient()).rpc("proj_my_site_assignments");
    if (error) { logServerError({ route: "/", operation: "load site assignments" }, error); return "error"; }
    return (Array.isArray(data) ? data : []) as unknown as SiteAssignment[];
  } catch (e) {
    logServerError({ route: "/", operation: "load site assignments" }, e instanceof Error ? e : new Error(String(e)));
    return "error";
  }
}
