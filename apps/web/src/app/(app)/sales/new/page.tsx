import { canAssignOwner, canManageCrmSettings, companyTimeZone, isCrmFounder } from "@enginious-hr/domain";
import { AskForAccess } from "@/components/os/ask-for-access";
import { Alert } from "@/components/ui/alert";
import { todayIn, todayInDubai } from "@/components/sales/format";
import { LoadError } from "@/components/workspace/states";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext } from "@/lib/crm/context";
import { loadOrganisations } from "@/lib/crm/data";
import { loadEditionPicker, type EditionOption } from "@/lib/crm/events/data";
import type { EventChoice } from "@/lib/crm/events/model";
import { parseEnquiryPrefill } from "./enquiry-form-shared";
import { NewEnquiryForm, type EnquiryCompany } from "./new-enquiry-form";

export const metadata = { title: "New enquiry" };

export default async function NewEnquiryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;

  const header = (
    <div>
      <h1 className="text-2xl font-semibold">New enquiry</h1>
      <p className="text-muted-foreground">Record an enquiry the moment it arrives. It needs an agency or an end client, an owner and a next action.</p>
    </div>
  );

  // The access list could not be read: that is not the same as having no access.
  if (ctx.loadFailed) {
    return (
      <div className="space-y-6">
        {header}
        <LoadError what="your Sales companies" retryHref="/sales/new" />
      </div>
    );
  }
  if (ctx.companies.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <Alert>You do not have Sales access to any company yet, so there is nowhere to record an enquiry. <AskForAccess module="sales" to="grant it" /></Alert>
      </div>
    );
  }

  const sp = await searchParams;
  let organisations: Awaited<ReturnType<typeof loadOrganisations>>["organisations"];
  try {
    ({ organisations } = await loadOrganisations());
  } catch (e) {
    // Empty pickers would invite duplicate organisations: say it could not load instead of offering the form.
    console.error("[crm] new enquiry: organisations load failed", e);
    return (
      <div className="space-y-6">
        {header}
        <LoadError what="the organisations" retryHref="/sales/new" />
      </div>
    );
  }
  let editions: EditionOption[] = [];
  let events: EventChoice[] = [];
  let editionsFailed = false;
  try { ({ editions, events } = await loadEditionPicker()); } catch (e) { console.error("[crm] new enquiry: editions load failed", e); editionsFailed = true; }

  const companies: EnquiryCompany[] = ctx.companies.map((c) => ({
    id: c.id,
    name: c.name,
    currency: c.settings?.default_quote_currency ?? null,
    hasSettings: c.settings !== null,
    canAssignOwner: canAssignOwner(ctx.grants, c.id),
    canOpenSettings: isCrmFounder(ctx.grants, c.id) || canManageCrmSettings(ctx.grants, c.id),
    people: ctx.people.filter((p) => p.companyIds.includes(c.id)).map((p) => ({ id: p.id, name: p.name })),
    timeZone: companyTimeZone(c.settings), today: todayIn(companyTimeZone(c.settings)),
  }));
  const contacts = organisations.flatMap((o) => o.contacts.map((c) => ({ id: c.id, name: c.name, organisationId: c.organisation_id, roleTitle: c.role_title })));
  const today = todayInDubai();

  // The address can carry starting values: from Quick Add's "Open the full form" (everything typed there) and from an account's Outreach section (the account, its
  // company and the outreach to link once saved). Every id is checked against what this person was given; anything else is left out and named on the form.
  const { values: prefill, ignored } = parseEnquiryPrefill(sp, { companies, organisations, editions, contacts, currentUserId: ctx.userId, today });
  // The company in the address is the context; otherwise the company used last in Sales, then the person's own. With no reliable default the form asks.
  const active = await pickSalesCompany(ctx, prefill.companyId || null);

  return (
    <div className="space-y-6">
      {header}
      <NewEnquiryForm
        companies={companies}
        organisations={organisations.map((o) => ({ id: o.id, name: o.name, kind: o.kind, roles: o.roles, place: o.place, country: o.country_code, website: o.website }))}
        editions={editions}
        events={events}
        editionsFailed={editionsFailed}
        contacts={contacts}
        currentUserId={ctx.userId}
        currentUserName={ctx.fullName ?? "Me"}
        today={today}
        activeCompany={{ id: active.company?.id ?? null, from: active.from }}
        prefill={prefill}
        prefillIgnored={ignored}
      />
    </div>
  );
}
