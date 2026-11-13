import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { LoadError } from "@/components/workspace/states";
import { EmptyState } from "@/components/ui/empty-state";
import { SiteAssignmentList } from "@/components/projects/site/site-assignments";
import { logServerError } from "@/lib/log";
import type { SiteAssignment } from "@/lib/projects/site-assignments";

export const metadata = { title: "My site assignments" };

/**
 * Where a person sees what they are assigned to on site. The ONLY data read is `proj_my_site_assignments`: it returns the person's own assignments and nothing from the project.
 * It works for someone who is not on the project at all (a site-only technician), who has no Projects access and no other route into the project.
 */
export default async function SiteAssignmentsPage() {
  const session = await getCurrentSession();
  if (!session) return null;
  const { data, error } = await (await createClient()).rpc("proj_my_site_assignments");
  if (error) {
    logServerError({ route: "/site-assignments", operation: "load site assignments" }, error);
    return <LoadError what="your site assignments" retryHref="/site-assignments" />;
  }
  const rows = (Array.isArray(data) ? data : []) as unknown as SiteAssignment[];
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">My site assignments</h1>
        <p className="text-sm text-muted-foreground">Where you are working on site, your role, the venue, your call time and what to know before you arrive.</p>
      </div>
      {rows.length === 0 ? <EmptyState title="Nothing assigned to you on site" description="When a Project Manager assigns you to an activity, it appears here with your role, the venue and your call time. It disappears when the assignment ends." /> : <SiteAssignmentList rows={rows} />}
    </div>
  );
}
