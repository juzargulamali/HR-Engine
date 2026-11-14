import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logServerError } from "@/lib/log";
import { siteChangesByActivity, type SiteAssignment, type SiteChangeNote } from "@/lib/projects/site-assignments";

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

/** The person's own UNREAD crew change notices (what moved, from what to what), grouped by activity: one read of their own rows. A site-only technician has no notification bell, so My Day says it. A failed read is just no note: the card still shows the assignment. */
export async function loadSiteChanges(userId: string): Promise<Record<string, SiteChangeNote[]>> {
  try {
    const { data, error } = await (await createClient()).from("notifications").select("payload").eq("user_id", userId).eq("type", "project_site_change").is("read_at", null).order("created_at", { ascending: true }).limit(50);
    if (error) { logServerError({ route: "/", operation: "load site change notices" }, error); return {}; }
    return siteChangesByActivity(data ?? []);
  } catch (e) {
    logServerError({ route: "/", operation: "load site change notices" }, e instanceof Error ? e : new Error(String(e)));
    return {};
  }
}
