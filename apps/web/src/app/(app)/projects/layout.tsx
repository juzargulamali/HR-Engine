import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";

/**
 * Projects & Tasks shell. Access is a company-scoped Projects grant (proj_company_grants) or a recorded Sales link to a project,
 * NOT an HR role and NOT a Sales grant: an HR admin, CEO or sys_admin without one sees this message and no project data (RLS returns
 * nothing to them either). Until the Projects migrations have been applied to this database it says so, instead of failing.
 */
export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  if (!ctx.installed) {
    return (
      <div className="space-y-4">
        <PageHeader title="Projects & Tasks" />
        <Alert role="status">Projects &amp; Tasks is not installed in this environment yet. The database changes it needs have not been applied here, so nothing is shown.</Alert>
      </div>
    );
  }
  if (!ctx.hasAnyAccess) {
    return (
      <div className="space-y-4">
        <PageHeader title="Projects & Tasks" />
        <Alert>You do not have Projects access. It is granted per company by the founders. Ask one of them if you need to see or work on projects.</Alert>
      </div>
    );
  }
  return <div className="space-y-6">{children}</div>;
}
