import { selectCompany } from "@/lib/crm/clients-agencies/company";

/**
 * Whose enquiries the figures and drill-downs on the Events pages count. Default: the viewer's current company (their first grant, or the one in the address).
 * "All companies" exists only for a viewer who holds grants for more than one company, and means exactly those companies (the data service returns nothing else:
 * the enquiries are read through the viewer's own session). The figures and the drill-down lists use the SAME scope.
 */
export function eventsScope(companies: readonly { id: string; name: string }[], sp: Record<string, string | string[] | undefined>): { companyId: string | null; label: string; canChooseAll: boolean; all: boolean } {
  const canChooseAll = companies.length > 1;
  const wantsAll = canChooseAll && sp.scope === "all";
  if (wantsAll) return { companyId: null, label: "All your companies", canChooseAll, all: true };
  const company = selectCompany(companies, typeof sp.company === "string" ? sp.company : undefined);
  return { companyId: company?.id ?? null, label: company?.name ?? "your company", canChooseAll, all: false };
}
