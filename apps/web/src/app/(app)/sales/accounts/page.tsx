import Link from "next/link";
import { Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { nextSort, relationshipAvailable, relationshipCounts, sortDirectory, sortFromParams, DEFAULT_SORT, type SortKey } from "@/lib/crm/clients-agencies/directory";
import { hasCrmCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { ChooseCompanyNotice, CompanySwitch } from "@/components/sales/company-switch";
import { RememberList } from "@/components/workspace/list-memory";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { LoadError } from "@/components/workspace/states";
import { withParams } from "@/components/workspace/url-state";
import { getCrmContext } from "@/lib/crm/context";
import { loadDirectory, loadStaff } from "@/lib/crm/clients-agencies/data";
import { filterDirectory, filtersFromParams, hasFilters, NOT_RECORDED, PRIORITY_FILTERS, PRIORITY_FILTER_LABEL, UNASSIGNED, type DirectoryRow } from "@/lib/crm/clients-agencies/directory";
import { countryLabel, LEAD_SOURCE_LABEL, LEAD_SOURCES, ORGANISATION_ROLES, ROLE_LABEL } from "@/lib/crm/clients-agencies/normalise";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { pageSlice, pageWindow, pagingSentence } from "@/lib/crm/clients-agencies/paging";
import { cn } from "@/lib/utils";
import { eligibleStaff, type StaffPerson } from "@/lib/crm/clients-agencies/staff";
import { AddAccountButton } from "./account-forms";
import { AccountsMenu } from "./accounts-menu";
import { DirectoryTable, PhoneSort, QuickFilters } from "./directory-table";
import { AssignBar, SelectionProvider } from "./outreach-select";

export const metadata = { title: "Clients & Agencies" };

export default async function ClientsAgenciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  // The company comes from the address, then the one used last in Sales, then the person's own: never the first by name (lib/crm/active-company.ts).
  const active = await pickSalesCompany(ctx, sp.company);
  const company = active.company;
  const heading = (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold">
        Clients &amp; Agencies
        <InfoHint label="Clients & Agencies" className="ml-1.5">
          One shared directory of agencies, direct clients, end clients and technology companies, with the team&apos;s outreach priority, who owns each account and what work has come through it. Look an account up here, and select accounts to assign outreach.
        </InfoHint>
      </h1>
      <p className="text-sm text-muted-foreground">Find an account, see who owns it, and assign outreach.</p>
    </div>
  );
  // Choosing another company keeps the search and the shared filters; the owner filter names a person of the company being left, so it is dropped, and the list starts at its first page.
  const companySwitch = <CompanySwitch companies={ctx.companies} current={company?.id ?? null} from={active.from} hrefFor={(id) => withParams("/sales/accounts", sp, { company: id, owner: null, page: null })} />;
  if (!company) {
    return (
      <div className="space-y-4">
        {heading}
        {active.from === "choose" ? <>{companySwitch}<ChooseCompanyNotice what="the accounts with that company's owners, lead sources and enquiry figures" /></> : <LoadError what="Clients & Agencies" />}
      </div>
    );
  }

  const filters = filtersFromParams(sp);
  let rows: DirectoryRow[];
  let staff: StaffPerson[];
  try {
    [rows, staff] = await Promise.all([loadDirectory(company.id), loadStaff()]);
  } catch (e) {
    console.error("[clients-agencies] directory failed", e);
    return <div className="space-y-4">{heading}{companySwitch}<LoadError what="Clients & Agencies" retryHref={`/sales/accounts?company=${company.id}`} /></div>;
  }
  const people = eligibleStaff(staff, company.id);
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.userId === id)?.name ?? staff.find((p) => p.userId === id)?.name ?? "Former colleague") : null);
  const canAssign = hasCrmCapability(ctx.grants, company.id, "assign_owner");
  // Enquiry figures failed to load: the names, countries, types and owners still show, the figures and badges say "Could not load", and the badge filter is not applied.
  const relOk = relationshipAvailable(rows);
  const effective = relOk ? filters : { ...filters, rel: "" as const };
  const sort = sortFromParams(sp);
  const matching = filterDirectory(rows, effective);
  const shown = sortDirectory(matching, sort, nameOf);
  // The whole filtered, sorted result is already here; a page is a slice of it, and the sentence under the filters always names the slice and the whole.
  const win = pageWindow(shown.length, sp.page);
  const page = pageSlice(shown, win);
  const counts = relOk ? relationshipCounts(filterDirectory(rows, { ...effective, rel: "" })) : null;
  // A country chosen in the address is always offered, so the filter in use is never shown as "Any country".
  const countries = [...new Set([...rows.map((r) => r.org.country_code), filters.country].filter((c): c is string => !!c))].sort((a, b) => countryLabel(a).localeCompare(countryLabel(b)));
  const exportQuery = (scope: "filtered" | "all") => {
    const q = new URLSearchParams({ company: company.id, scope });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    return q.toString();
  };
  // A link that keeps every filter and the sort, changing only what is given. A new filter or sort starts at the first page; only the pager passes a page.
  const linkWith = (over: { rel?: string; sort?: SortKey; page?: number }) => {
    const q = new URLSearchParams({ company: company.id });
    for (const [k, v] of Object.entries({ ...filters, rel: over.rel ?? filters.rel })) if (v) q.set(k, v);
    const s = over.sort ? nextSort(sort, over.sort) : sort;
    if (s.key !== DEFAULT_SORT.key || s.dir !== DEFAULT_SORT.dir) { q.set("sort", s.key); q.set("dir", s.dir); }
    if (over.page && over.page > 1) q.set("page", String(over.page));
    return `/sales/accounts?${q.toString()}`;
  };
  // The company is chosen in the bar above, not here: the directory is ONE shared list of every account, whichever company added it, and the company only decides whose owner, lead source and enquiry figures are shown.
  const toolbarFilters: ToolbarFilter[] = [
    { name: "role", label: "Role", value: filters.role, options: [{ value: "", label: "Any role" }, ...ORGANISATION_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })), { value: NOT_RECORDED, label: "Role not recorded" }] },
    { name: "priority", label: "Outreach priority", value: filters.priority, options: [{ value: "", label: "Any priority" }, ...PRIORITY_FILTERS.map((f) => ({ value: f, label: PRIORITY_FILTER_LABEL[f] }))] },
    { name: "owner", label: "Account owner", value: filters.owner, options: [{ value: "", label: "Anyone" }, { value: UNASSIGNED, label: "Unassigned" }, ...people.map((p) => ({ value: p.userId, label: p.name }))] },
    { name: "country", label: "Country", secondary: true, value: filters.country, options: [{ value: "", label: "Any country" }, ...countries.map((c) => ({ value: c, label: countryLabel(c) }))] },
    { name: "source", label: "Lead source", secondary: true, value: filters.source, options: [{ value: "", label: "Any source" }, ...LEAD_SOURCES.map((x) => ({ value: x, label: LEAD_SOURCE_LABEL[x] })), { value: NOT_RECORDED, label: "Not recorded" }] },
    { name: "exhibition", label: "Exhibition", secondary: true, kind: "text", value: filters.exhibition, placeholder: "Part of the show name" },
  ];
  // Clear removes the search, every filter and the relationship chip; the company and the sort stay.
  const clearHref = withParams("/sales/accounts", sp, { company: company.id, q: null, role: null, priority: null, owner: null, country: null, source: null, exhibition: null, rel: null, page: null });
  // Changing the company, a filter, the search, the sort or the page starts an empty selection (see outreach-select.tsx): only rows on screen can be ticked.
  const viewKey = JSON.stringify([company.id, effective, sort, win.page]);
  const pagerLink = "inline-flex min-h-10 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary/60";
  const pager = win.pages > 1 ? (
    <nav aria-label="Pages of accounts" className="flex flex-wrap items-center gap-2" data-testid="accounts-pager">
      {win.page > 1 ? <Link href={linkWith({ page: win.page - 1 })} className={pagerLink} rel="prev"><ChevronLeft className="h-4 w-4" aria-hidden /> Previous page</Link> : <span className={cn(pagerLink, "cursor-not-allowed opacity-50")} aria-disabled="true"><ChevronLeft className="h-4 w-4" aria-hidden /> Previous page</span>}
      <span className="text-sm text-muted-foreground">Page {win.page} of {win.pages}</span>
      {win.page < win.pages ? <Link href={linkWith({ page: win.page + 1 })} className={pagerLink} rel="next">Next page <ChevronRight className="h-4 w-4" aria-hidden /></Link> : <span className={cn(pagerLink, "cursor-not-allowed opacity-50")} aria-disabled="true">Next page <ChevronRight className="h-4 w-4" aria-hidden /></span>}
    </nav>
  ) : null;

  return (
    <div className="space-y-5">
      <RememberList section="accounts" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        <div className="flex flex-wrap items-center gap-2">
          <AddAccountButton companyId={company.id} ownerChoices={canAssign ? people.map((p) => ({ id: p.userId, name: p.name })) : null} />
          <AccountsMenu importHref={`/sales/accounts/import?company=${company.id}`} exportFilteredHref={`/api/sales/accounts/export?${exportQuery("filtered")}`} exportAllHref={`/api/sales/accounts/export?company=${company.id}&scope=all`} filtered={hasFilters(filters)} />
        </div>
      </div>
      {companySwitch}

      {/* Same toolbar as Sales > Enquiries: each filter applies as it is chosen (no Apply button), keeping the company, the search, the sort and the relationship chip. */}
      <ListToolbar search={{ value: filters.q, placeholder: "Name, website, place, notes, contact or email", label: "Search accounts" }} filters={toolbarFilters} clearHref={clearHref} />

      <QuickFilters active={effective.rel} counts={counts} available={relOk} hrefFor={(rel) => linkWith({ rel })} />
      {!relOk ? (
        <Alert variant="destructive" role="alert">
          Could not load the enquiry figures. Names, countries, types and owners are shown below; the enquiry columns and relationship badges say &ldquo;Could not load&rdquo;, and the relationship filter is not applied{filters.rel ? " (the one in the address was ignored)" : ""}. Reload to try again.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-muted-foreground" role="status" data-testid="accounts-count">
          <span className="font-medium text-foreground">{pagingSentence(win, "account", "accounts", hasFilters(effective) ? rows.length : undefined)}</span>, figures for {company.name}
          <InfoHint label="what the list shows" className="ml-1">
            The accounts are shared by every Enginious company: an account added by one team is here for all teams with Sales access. Outreach priority is one shared team rating. Enquiry counts, account owner, lead source and exhibition are recorded per company and shown here for {company.name}.
          </InfoHint>
        </p>
        {pager}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Building2} title="No accounts yet" description="Add an account, or record an enquiry: its agency and client appear here." />
      ) : shown.length === 0 ? (
        <EmptyState icon={Building2} title="Nothing matches" description="Clear a filter or search for something else." action={<Link href={clearHref} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : (
        <SelectionProvider key={viewKey}>
          {/* Only people with the assign owners right get the selection boxes and the bar; the action and the database check the right again. */}
          {canAssign ? <AssignBar companyId={company.id} shown={page.map((r) => ({ id: r.org.id, name: r.org.name }))} people={people.map((p) => ({ id: p.userId, name: p.name }))} /> : null}
          <PhoneSort sort={sort} hrefFor={(key) => linkWith({ sort: key })} />
          <DirectoryTable rows={page} sort={sort} hrefFor={(key) => linkWith({ sort: key })} accountHref={(id) => `/sales/accounts/${id}?company=${company.id}`} canSelect={canAssign} ownerName={nameOf} />
          {/* The same sentence and pager again under a long page, so the next hundred is one press away from the last row. */}
          {win.pages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-sm text-muted-foreground">{pagingSentence(win, "account", "accounts")}</p>
              {pager}
            </div>
          ) : null}
        </SelectionProvider>
      )}
    </div>
  );
}
