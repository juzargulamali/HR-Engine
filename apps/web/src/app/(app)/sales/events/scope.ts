import type { ActiveCompany } from "@/lib/crm/active-company";

type Params = Record<string, string | string[] | undefined>;
interface Company { id: string; name: string }

export interface EventsScope {
  /** The one company whose enquiries are counted; null under "All my companies", while a company still has to be chosen, and when the viewer has none. */
  companyId: string | null;
  /** The words shown right next to every count. */
  label: string;
  canChooseAll: boolean;
  all: boolean;
  /** Several companies and no reliable default: nothing is counted until the person chooses (it never falls back to the first company by name). */
  choose: boolean;
}

/**
 * Whose enquiries the figures and drill-downs on the Events pages count. Default: the active Sales company, which the caller resolves (the company in the address,
 * then the one used last in Sales, then the person's employing company, then their only one: lib/crm/active-company.ts) and passes in, so this stays pure.
 * "All my companies" exists only for a viewer who holds grants for more than one company, and means exactly those companies (the data service returns nothing else:
 * the enquiries are read through the viewer's own session). The figures and the drill-down lists use the SAME scope.
 */
export function eventsScope(companies: readonly Company[], sp: Params, active: ActiveCompany<Company>): EventsScope {
  const canChooseAll = companies.length > 1;
  if (canChooseAll && sp.scope === "all") return { companyId: null, label: "All your companies", canChooseAll, all: true, choose: false };
  // Only a company the viewer holds is ever used, whatever the caller resolved.
  const company = active.company && companies.some((c) => c.id === active.company!.id) ? active.company : null;
  if (!company && canChooseAll) return { companyId: null, label: "no company chosen", canChooseAll, all: false, choose: true };
  return { companyId: company?.id ?? null, label: company?.name ?? "your company", canChooseAll, all: false, choose: false };
}

/** What every link between the Events pages carries so the company (or "All my companies") is not lost: `company=<id>` or `scope=all`. */
export function scopeParams(scope: Pick<EventsScope, "companyId" | "all">): Record<string, string> {
  if (scope.all) return { scope: "all" };
  return scope.companyId ? { company: scope.companyId } : {};
}

/** An address with only the parameters that have a value, in the order given. */
export function address(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return `${path}${s ? `?${s}` : ""}`;
}
