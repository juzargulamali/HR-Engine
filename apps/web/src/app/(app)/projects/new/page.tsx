import { hasProjCapability, isProjFounder } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Muted, PageHeader, Panel } from "@/components/projects/parts";
import { getProjectsContext } from "@/lib/projects/context";
import { NewProjectForm } from "./new-project-form";

export const metadata = { title: "New internal project" };

export default async function NewInternalProjectPage() {
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const companies = ctx.companies
    .filter((c) => hasProjCapability(ctx.grants, c.id, "assign_pm"))
    .map((c) => ({
      id: c.id, name: c.name, referenceCode: c.referenceCode, isFounder: isProjFounder(ctx.grants, c.id),
      people: ctx.people.filter((p) => p.companyIds.includes(c.id)).map((p) => ({ id: p.id, name: p.name })),
    }));

  return (
    <div className="space-y-6">
      <PageHeader title="New internal project" description="For work with no client or Sales opportunity: office and showroom technology, new technology development, marketing, maintenance and improvements. No purchase order, no Sales value, no handover." />
      {companies.length === 0 ? (
        <Alert role="status">Only a founder, or someone a founder gave Project Manager assignment to, can create an internal project. Ask a founder to create it or to give you that right.</Alert>
      ) : (
        <Panel title="Project details" description="You choose who is accountable. They become the Project Manager and can then add people and plan the work.">
          <NewProjectForm companies={companies} />
        </Panel>
      )}
      <Muted>Client projects are not created here: they start when a Project Manager accepts a Sales handover. The same short form is on the Projects page (New internal project).</Muted>
    </div>
  );
}
