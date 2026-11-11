import Link from "next/link";
import { Building2, Download, Upload } from "lucide-react";
import { nextSort, relationshipAvailable, relationshipCounts, sortDirectory, sortFromParams, DEFAULT_SORT, type SortKey } from "@/lib/crm/clients-agencies/directory";
import { hasCrmCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { LoadError } from "@/components/workspace/states";
import { withParams } from "@/components/workspace/url-state";
import { getCrmContext } from "@/lib/crm/context";
import { loadDirectory, loadStaff } from "@/lib/crm/clients-agencies/data";
import { filterDirectory, filtersFromParams, hasFilters, NOT_RECORDED, PRIORITY_FILTERS, PRIORITY_FILTER_LABEL, UNASSIGNED, type DirectoryRow } from "@/lib/crm/clients-agencies/directory";
import { countryLabel, LEAD_SOURCE_LABEL, LEAD_SOURCES, ORGANISATION_ROLES, ROLE_LABEL } from "@/lib/crm/clients-agencies/normalise";
import { selectCompany } from "@/lib/crm/clients-agencies/company";
import { eligibleStaff, type StaffPerson } from "@/lib/crm/clients-agencies/staff";
import { AddAccountButton } from "./account-forms";
import { DirectoryTable, ENQUIRIES_NOTE, ENQUIRIES_NOTE_ID, PhoneSort, QuickFilters } from "./directory-table";
import { AssignBar, SelectionProvider } from "./outreach-select";

export const metadata = { title: "Clients & Agencies" };
const PAGE_LIMIT = 100;

export default async function ClientsAgenciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const company = selectCompany(ctx.companies, typeof sp.company === "string" ? sp.company : undefined);
  const heading = (
    <div>
      <h1 className="text-2xl font-semibold">Clients &amp; Agencies</h1>
      <p className="text-muted-foreground">One shared directory of agencies, direct clients, end clients and technology companies, with the team&apos;s outreach priority, who owns each account and what work has come through it.</p>
    </div>
  );
  if (!company) return <div className="space-y-4">{heading}<LoadError what="Clients & Agencies" /></div>;

  const filters = filtersFromParams(sp);
  let rows: DirectoryRow[];
  let staff: StaffPerson[];
  try {
    [rows, staff] = await Promise.all([loadDirectory(company.id), loadStaff()]);
  } catch (e) {
    console.error("[clients-agencies] directory failed", e);
    return <div className="space-y-4">{heading}<LoadError what="Clients & Agencies" retryHref={`/sales/accounts?company=${company.id}`} /></div>;
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
  const page = shown.slice(0, PAGE_LIMIT);
  const counts = relOk ? relationshipCounts(filterDirectory(rows, { ...effective, rel: "" })) : null;
  // A country chosen in the address is always offered, so the filter in use is never shown as "Any country".
  const countries = [...new Set([...rows.map((r) => r.org.country_code), filters.country].filter((c): c is string => !!c))].sort((a, b) => countryLabel(a).localeCompare(countryLabel(b)));
  const exportQuery = (scope: "filtered" | "all") => {
    const q = new URLSearchParams({ company: company.id, scope });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    return q.toString();
  };
  const here = (extra = "") => `/sales/accounts?company=${company.id}${extra}`;
  // A link that keeps every filter and the sort, changing only what is given.
  const linkWith = (over: { rel?: string; sort?: SortKey }) => {
    const q = new URLSearchParams({ company: company.id });
    for (const [k, v] of Object.entries({ ...filters, rel: over.rel ?? filters.rel })) if (v) q.set(k, v);
    const s = over.sort ? nextSort(sort, over.sort) : sort;
    if (s.key !== DEFAULT_SORT.key || s.dir !== DEFAULT_SORT.dir) { q.set("sort", s.key); q.set("dir", s.dir); }
    return `/sales/accounts?${q.toString()}`;
  };
  // No Company selector: the directory is ONE shared list of every account, whichever company added it. The company only decides which company's owner, lead source and enquiry figures are shown (see the line under the filters).
  const toolbarFilters: ToolbarFilter[] = [
    { name: "role", label: "Role", value: filters.role, options: [{ value: "", label: "Any role" }, ...ORGANISATION_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })), { value: NOT_RECORDED, label: "Role not recorded" }] },
    { name: "priority", label: "Outreach priority", value: filters.priority, options: [{ value: "", label: "Any priority" }, ...PRIORITY_FILTERS.map((f) => ({ value: f, label: PRIORITY_FILTER_LABEL[f] }))] },
    { name: "owner", label: "Account owner", value: filters.owner, options: [{ value: "", label: "Anyone" }, { value: UNASSIGNED, label: "Unassigned" }, ...people.map((p) => ({ value: p.userId, label: p.name }))] },
    { name: "country", label: "Country", secondary: true, value: filters.country, options: [{ value: "", label: "Any country" }, ...countries.map((c) => ({ value: c, label: countryLabel(c) }))] },
    { name: "source", label: "Lead source", secondary: true, value: filters.source, options: [{ value: "", label: "Any source" }, ...LEAD_SOURCES.map((x) => ({ value: x, label: LEAD_SOURCE_LABEL[x] })), { value: NOT_RECORDED, label: "Not recorded" }] },
    { name: "exhibition", label: "Exhibition", secondary: true, kind: "text", value: filters.exhibition, placeholder: "Part of the show name" },
  ];
  // Clear removes the search, every filter and the relationship chip; the company and the sort stay.
  const clearHref = withParams("/sales/accounts", sp, { company: company.id, q: null, role: null, priority: null, owner: null, country: null, source: null, exhibition: null, rel: null });
  // Changing the company, a filter, the search or the sort starts an empty selection (see outreach-select.tsx).
  const viewKey = JSON.stringify([company.id, effective, sort]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        <div className="flex flex-wrap gap-2">
          <AddAccountButton companyId={company.id} ownerChoices={canAssign ? people.map((p) => ({ id: p.userId, name: p.name })) : null} />
          <Link href={`/sales/accounts/import?company=${company.id}`} className={buttonVariants({ variant: "outline" })}><Upload className="h-4 w-4" aria-hidden /> Import from Excel</Link>
          <a href={`/api/sales/accounts/export?${exportQuery("filtered")}`} className={buttonVariants({ variant: "outline" })}><Download className="h-4 w-4" aria-hidden /> Export filtered results</a>
          <a href={`/api/sales/accounts/export?company=${company.id}&scope=all`} className={buttonVariants({ variant: "outline" })}><Download className="h-4 w-4" aria-hidden /> Export all accounts</a>
        </div>
      </div>

      {/* Same toolbar as Sales > Enquiries: each filter applies as it is chosen (no Apply button), keeping the company, the search, the sort and the relationship chip. */}
      <ListToolbar search={{ value: filters.q, placeholder: "Name, website, place, notes, contact or email", label: "Search accounts" }} filters={toolbarFilters} clearHref={clearHref} />

      <QuickFilters active={effective.rel} counts={counts} available={relOk} hrefFor={(rel) => linkWith({ rel })} />
      {!relOk ? (
        <Alert variant="destructive" role="alert">
          Could not load the enquiry figures. Names, countries, types and owners are shown below; the enquiry columns and relationship badges say &ldquo;Could not load&rdquo;, and the relationship filter is not applied{filters.rel ? " (the one in the address was ignored)" : ""}. Reload to try again.
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground" role="status">
        {hasFilters(effective) ? `Showing ${shown.length} of ${rows.length} accounts` : `${rows.length} ${rows.length === 1 ? "account" : "accounts"}`}, shared by every Enginious company (an account added by one team is here for all teams with Sales access). Outreach priority is one shared team rating. Enquiry counts, account owner, lead source and exhibition are recorded per company and shown here for {company.name}.
      </p>

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
          <p id={ENQUIRIES_NOTE_ID} className="text-xs text-muted-foreground"><span className="font-medium">Enquiries:</span> {ENQUIRIES_NOTE}. Won enquiries are enquiries recorded as won (not projects in progress). An enquiry linked to the same account twice (for example as agency and as end client) counts once.</p>
          {shown.length > page.length ? <Alert>Showing the first {PAGE_LIMIT} of {shown.length} accounts. Search or filter to narrow the list.</Alert> : null}
        </SelectionProvider>
      )}
    </div>
  );
}
