import Link from "next/link";
import { Building2, Download, Upload } from "lucide-react";
import { nextSort, relationshipAvailable, relationshipCounts, sortDirectory, sortFromParams, DEFAULT_SORT, type SortKey } from "@/lib/crm/clients-agencies/directory";
import { hasCrmCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LoadError } from "@/components/workspace/states";
import { getCrmContext } from "@/lib/crm/context";
import { loadDirectory, loadStaff } from "@/lib/crm/clients-agencies/data";
import { filterDirectory, filtersFromParams, hasFilters, NOT_RECORDED, PRIORITY_FILTERS, PRIORITY_FILTER_LABEL, UNASSIGNED, type DirectoryRow } from "@/lib/crm/clients-agencies/directory";
import { countryLabel, LEAD_SOURCE_LABEL, LEAD_SOURCES, ORGANISATION_ROLES, ROLE_LABEL } from "@/lib/crm/clients-agencies/normalise";
import { selectCompany } from "@/lib/crm/clients-agencies/company";
import { eligibleStaff, type StaffPerson } from "@/lib/crm/clients-agencies/staff";
import { cn } from "@/lib/utils";
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
  const countries = [...new Set(rows.map((r) => r.org.country_code).filter((c): c is string => !!c))].sort((a, b) => countryLabel(a).localeCompare(countryLabel(b)));
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
  const moreActive = [filters.country, filters.source, filters.exhibition].filter(Boolean).length;
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

      <form method="get" role="search" aria-label="Filter accounts" className="space-y-3">
        {sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir ? <><input type="hidden" name="sort" value={sort.key} /><input type="hidden" name="dir" value={sort.dir} /></> : null}
        {filters.rel ? <input type="hidden" name="rel" value={filters.rel} /> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* No Company selector: the directory is ONE shared list of every account, whichever company added it. The company only decides which company's owner, lead source and enquiry figures are shown (see the line under the filters). */}
          <input type="hidden" name="company" value={company.id} />
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="ca-q" className="text-sm font-medium leading-none">Search</label>
            <Input id="ca-q" name="q" type="search" defaultValue={filters.q} placeholder="Name, website, place, notes, contact or email" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ca-role" className="text-sm font-medium leading-none">Role</label>
            <Select id="ca-role" name="role" defaultValue={filters.role}>
              <option value="">Any role</option>
              {ORGANISATION_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              <option value={NOT_RECORDED}>Role not recorded</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ca-priority" className="text-sm font-medium leading-none">Outreach priority</label>
            <Select id="ca-priority" name="priority" defaultValue={filters.priority}>
              <option value="">Any priority</option>
              {PRIORITY_FILTERS.map((f) => <option key={f} value={f}>{PRIORITY_FILTER_LABEL[f]}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ca-owner" className="text-sm font-medium leading-none">Account owner</label>
            <Select id="ca-owner" name="owner" defaultValue={filters.owner}>
              <option value="">Anyone</option>
              <option value={UNASSIGNED}>Unassigned</option>
              {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="secondary" className="min-h-10">Apply</Button>
            {hasFilters(filters) ? <Link href={here()} className={cn(buttonVariants({ variant: "ghost" }), "min-h-10")}>Clear</Link> : null}
          </div>
        </div>
        <details className="rounded-md border border-border px-3 py-1" open={moreActive > 0}>
          <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
            More filters
            {moreActive > 0 ? <span className="rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground" aria-label={`${moreActive} more ${moreActive === 1 ? "filter" : "filters"} active`}>{moreActive} active</span> : null}
          </summary>
          <div className="grid gap-3 pb-3 pt-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label htmlFor="ca-country" className="text-sm font-medium leading-none">Country</label>
              <Select id="ca-country" name="country" defaultValue={filters.country}>
                <option value="">Any country</option>
                {countries.map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ca-source" className="text-sm font-medium leading-none">Lead source</label>
              <Select id="ca-source" name="source" defaultValue={filters.source}>
                <option value="">Any source</option>
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABEL[s]}</option>)}
                <option value={NOT_RECORDED}>Not recorded</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ca-exhibition" className="text-sm font-medium leading-none">Exhibition</label>
              <Input id="ca-exhibition" name="exhibition" defaultValue={filters.exhibition} placeholder="Part of the show name" />
            </div>
          </div>
        </details>
      </form>

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
        <EmptyState icon={Building2} title="Nothing matches" description="Clear a filter or search for something else." action={<Link href={here()} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
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
