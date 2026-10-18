import { canAssignOwner, canManageCrmSettings, isCrmFounder } from "@enginious-hr/domain";
import { getCrmContext } from "@/lib/crm/context";
import { loadOrganisations } from "@/lib/crm/data";
import { todayInDubai } from "./format";
import { QuickAddEnquiryForm } from "./quick-add-enquiry-form";

/**
 * The one "Add enquiry" action of the Sales workspace (Follow-ups and Enquiries). Server side it decides what the person is allowed
 * to see in the form (their companies, whether they may give the enquiry to a colleague); the form posts to the same createOpportunity
 * action as the full page, so every rule and the duplicate warning are the same. Renders nothing for someone with no Sales company.
 */
export async function QuickAddEnquiry() {
  const ctx = await getCrmContext();
  if (!ctx || ctx.companies.length === 0) return null;
  let organisations: Awaited<ReturnType<typeof loadOrganisations>>["organisations"] = [];
  try {
    organisations = (await loadOrganisations()).organisations;
  } catch (e) {
    console.error("[crm] quick add: organisations load failed", e);
  }
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
      }))}
      organisations={organisations.map((o) => ({ id: o.id, name: o.name, kind: o.kind, place: o.place }))}
      currentUserId={ctx.userId}
      currentUserName={ctx.fullName ?? "Me"}
      today={todayInDubai()}
    />
  );
}
