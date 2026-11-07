import Link from "next/link";
import { Building2, Download, Upload } from "lucide-react";
import { hasCrmCapability } from "@enginious-hr/domain";
import { OsBadge } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LoadError } from "@/components/workspace/states";
import { getCrmContext } from "@/lib/crm/context";
import { loadDirectory, loadStaff } from "@/lib/crm/clients-agencies/data";
import { filterDirectory, filtersFromParams, hasFilters, NOT_RECORDED, UNASSIGNED, type DirectoryRow } from "@/lib/crm/clients-agencies/directory";
import { countryLabel, LEAD_SOURCE_LABEL, LEAD_SOURCES, ORGANISATION_ROLES, ROLE_LABEL } from "@/lib/crm/clients-agencies/normalise";
import { selectCompany } from "@/lib/crm/clients-agencies/company";
import { eligibleStaff, type StaffPerson } from "@/lib/crm/clients-agencies/staff";
import { cn } from "@/lib/utils";
import { AddAccountButton } from "./account-forms";

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
      <p className="text-muted-foreground">Agencies, direct clients, end clients and technology companies, with who owns each account and what work has come through it.</p>
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
  const shown = filterDirectory(rows, filters);
  const page = shown.slice(0, PAGE_LIMIT);
  const countries = [...new Set(rows.map((r) => r.org.country_code).filter((c): c is string => !!c))].sort((a, b) => countryLabel(a).localeCompare(countryLabel(b)));
  const exportQuery = (scope: "filtered" | "all") => {
    const q = new URLSearchParams({ company: company.id, scope });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    return q.toString();
  };
  const here = (extra = "") => `/sales/accounts?company=${company.id}${extra}`;

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

      <form method="get" role="search" aria-label="Filter accounts" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ctx.companies.length > 1 ? (
          <div className="space-y-1.5">
            <label htmlFor="ca-company" className="text-sm font-medium leading-none">Company</label>
            <Select id="ca-company" name="company" defaultValue={company.id}>{ctx.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </div>
        ) : <input type="hidden" name="company" value={company.id} />}
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
          <label htmlFor="ca-country" className="text-sm font-medium leading-none">Country</label>
          <Select id="ca-country" name="country" defaultValue={filters.country}>
            <option value="">Any country</option>
            {countries.map((c) => <option key={c} value={c}>{countryLabel(c)}</option>)}
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
        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary">Apply</Button>
          {hasFilters(filters) ? <Link href={here()} className={cn(buttonVariants({ variant: "ghost" }))}>Clear</Link> : null}
        </div>
      </form>

      <p className="text-sm text-muted-foreground" role="status">
        For {company.name}. {hasFilters(filters) ? `Showing ${shown.length} of ${rows.length} accounts.` : `${rows.length} ${rows.length === 1 ? "account" : "accounts"}.`} Inquiry counts are this company&apos;s only; owner, lead source and exhibition are recorded per company.
      </p>

      {rows.length === 0 ? (
        <EmptyState icon={Building2} title="No accounts yet" description="Add an account, or record an enquiry: its agency and client appear here." />
      ) : shown.length === 0 ? (
        <EmptyState icon={Building2} title="Nothing matches" description="Clear a filter or search for something else." action={<Link href={here()} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : (
        <>
          <ul className="space-y-3">
            {page.map((r) => {
              const owner = nameOf(r.profile?.owner_id ?? null);
              return (
                <li key={r.org.id}>
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <CardTitle className="min-w-0 break-words leading-snug">
                          <Link href={`/sales/accounts/${r.org.id}?company=${company.id}`} className="underline-offset-2 hover:underline">{r.org.name}</Link>
                        </CardTitle>
                        <div className="flex flex-wrap gap-1.5">
                          {r.org.roles.length === 0 ? <OsBadge tone="quiet">Role not recorded</OsBadge> : r.org.roles.map((role) => <OsBadge key={role} tone={role === "agency" ? "blue" : role === "technology" ? "cyan" : "neutral"} className="whitespace-nowrap">{ROLE_LABEL[role]}</OsBadge>)}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                      <p className="text-muted-foreground">
                        {[r.org.country_code ? countryLabel(r.org.country_code) : null, r.org.place].filter(Boolean).join(" · ") || "Country not recorded"}
                        {r.org.website_domain ? ` · ${r.org.website_domain}` : ""}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Account owner: </span>
                        {owner ? <span className="font-medium">{owner}</span> : <OsBadge tone="amber">Unassigned</OsBadge>}
                        <span className="text-muted-foreground"> · Lead source: </span>
                        {r.profile?.lead_source ? `${LEAD_SOURCE_LABEL[r.profile.lead_source]}${r.profile.exhibition ? ` (${r.profile.exhibition})` : ""}` : "not recorded"}
                      </p>
                      <p className="text-muted-foreground">
                        {r.inquiryCount} {r.inquiryCount === 1 ? "inquiry" : "inquiries"}{r.inquiryCount ? ` (${r.openCount} open)` : ""} · {r.contacts.length} {r.contacts.length === 1 ? "contact" : "contacts"}
                      </p>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
          {shown.length > page.length ? <Alert>Showing the first {PAGE_LIMIT} of {shown.length} accounts. Search or filter to narrow the list.</Alert> : null}
        </>
      )}
    </div>
  );
}
