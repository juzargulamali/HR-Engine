import { canAssignOwner, canManageCrmSettings, companyTimeZone, isCrmFounder } from "@enginious-hr/domain";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext } from "@/lib/crm/context";
import { loadOrganisations } from "@/lib/crm/data";
import { loadEditionPicker, type EditionOption } from "@/lib/crm/events/data";
import type { EventChoice } from "@/lib/crm/events/model";
import { todayIn, todayInDubai } from "./format";
import { QuickAddEnquiryForm } from "./quick-add-enquiry-form";

/**
 * The one "Add enquiry" action of the Sales workspace (Follow-ups and Enquiries). Server side it decides what the person is allowed
 * to see in the form (their companies, whether they may give the enquiry to a colleague); the form posts to the same createOpportunity
 * action as the full page, so every rule and the duplicate warning are the same. Renders nothing for someone with no Sales company.
 *
 * The form starts in the active Sales company: `companyId` when the page gives its own (the company it is showing), otherwise the company used last in Sales,
 * then the person's own employing company (lib/crm/active-company.ts). With several companies and no reliable default it starts with none and asks; it never
 * starts on the first company by name. A company in `companyId` the person has no Sales access to is ignored.
 */
export async function QuickAddEnquiry({ companyId }: { companyId?: string | null } = {}) {
  const ctx = await getCrmContext();
  if (!ctx || ctx.companies.length === 0) return null;
  const active = await pickSalesCompany(ctx, companyId ?? null);
  let organisations: Awaited<ReturnType<typeof loadOrganisations>>["organisations"] = [];
  try {
    organisations = (await loadOrganisations()).organisations;
  } catch (e) {
    // Empty pickers would invite duplicate organisations: say it could not load and do not offer the form.
    console.error("[crm] quick add: organisations load failed", e);
    return <span role="status" className="text-sm text-destructive">Could not load organisations, so enquiries cannot be added from here right now. Reload the page.</span>;
  }
  // The editions are optional: if they cannot be read the form still works and says so next to the Event field.
  let editions: EditionOption[] = [];
  let events: EventChoice[] = [];
  let editionsFailed = false;
  try { ({ editions, events } = await loadEditionPicker()); } catch (e) { console.error("[crm] quick add: editions load failed", e); editionsFailed = true; }
  return (
    <QuickAddEnquiryForm
      companies={ctx.companies.map((c) => ({
        id: c.id,
        name: c.name,
        currency: c.settings?.default_quote_currency ?? null,
        hasSettings: c.settings !== null,
        canAssignOwner: canAssignOwner(ctx.grants, c.id),
        canOpenSettings: isCrmFounder(ctx.grants, c.id) || canManageCrmSettings(ctx.grants, c.id),
        people: ctx.people.filter((p) => p.companyIds.includes(c.id)).map((p) => ({ id: p.id, name: p.name })),
    timeZone: companyTimeZone(c.settings), today: todayIn(companyTimeZone(c.settings)),
      }))}
      organisations={organisations.map((o) => ({ id: o.id, name: o.name, kind: o.kind, roles: o.roles, place: o.place, country: o.country_code, website: o.website }))}
      editions={editions}
      events={events}
      editionsFailed={editionsFailed}
      currentUserId={ctx.userId}
      currentUserName={ctx.fullName ?? "Me"}
      today={todayInDubai()}
      activeCompany={{ id: active.company?.id ?? null, from: active.from }}
    />
  );
}
