import { canAssignOwner, canManageCrmSettings, isCrmFounder } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { todayInDubai } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadOrganisations } from "@/lib/crm/data";
import { NewEnquiryForm, type EnquiryCompany } from "./new-enquiry-form";

export const metadata = { title: "New enquiry" };

export default async function NewEnquiryPage() {
  const ctx = await getCrmContext();
  if (!ctx) return null;

  const header = (
    <div>
      <h1 className="text-2xl font-semibold">New enquiry</h1>
      <p className="text-muted-foreground">Record an enquiry the moment it arrives. It needs an agency or an end client, an owner and a next action.</p>
    </div>
  );

  if (ctx.companies.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Alert>You do not have Sales access to any company yet, so there is nowhere to record an enquiry. Ask a founder to grant it.</Alert>
      </div>
    );
  }

  const { organisations } = await loadOrganisations();

  const companies: EnquiryCompany[] = ctx.companies.map((c) => ({
    id: c.id,
    name: c.name,
    currency: c.settings?.default_quote_currency ?? null,
    hasSettings: c.settings !== null,
    canAssignOwner: canAssignOwner(ctx.grants, c.id),
    canOpenSettings: isCrmFounder(ctx.grants, c.id) || canManageCrmSettings(ctx.grants, c.id),
    people: ctx.people.filter((p) => p.companyIds.includes(c.id)).map((p) => ({ id: p.id, name: p.name })),
  }));

  return (
    <div className="space-y-6">
      {header}
      <NewEnquiryForm
        companies={companies}
        organisations={organisations.map((o) => ({ id: o.id, name: o.name, kind: o.kind, place: o.place }))}
        contacts={organisations.flatMap((o) => o.contacts.map((c) => ({ id: c.id, name: c.name, organisationId: c.organisation_id, roleTitle: c.role_title })))}
        currentUserId={ctx.userId}
        currentUserName={ctx.fullName ?? "Me"}
        today={todayInDubai()}
      />
    </div>
  );
}
