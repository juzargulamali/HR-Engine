import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { hasCrmCapability } from "@enginious-hr/domain";
import { OsBadge } from "@/components/os/pills";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { LoadError } from "@/components/workspace/states";
import { todayInDubai } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadStaff } from "@/lib/crm/clients-agencies/data";
import { loadOutreach, type OutreachListRow } from "@/lib/crm/clients-agencies/outreach-data";
import { filterOutreach, isOverdue, OUTREACH_STATUS_LABEL, OUTREACH_STATUSES, outreachFiltersFromParams } from "@/lib/crm/clients-agencies/outreach";
import { selectCompany } from "@/lib/crm/clients-agencies/company";
import type { StaffPerson } from "@/lib/crm/clients-agencies/staff";
import { cn } from "@/lib/utils";
import { OutreachFacts, OutreachStatusBadge } from "./outreach-view";

export const metadata = { title: "Outreach" };

/**
 * My outreach (the person's own assignments) and, for a Sales lead (assign owners right), All outreach for the company. The database decides what each person may
 * read: an assignee reads own rows, a lead the company's; the "mine" view additionally filters to the signed-in person.
 */
export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  const company = selectCompany(ctx.companies, typeof sp.company === "string" ? sp.company : undefined);
  const heading = (
    <div>
      <h1 className="text-2xl font-semibold">Outreach</h1>
      <p className="text-muted-foreground">Accounts assigned to a salesperson to approach or re-engage, before any inquiry exists.</p>
    </div>
  );
  if (!company) return <div className="space-y-4">{heading}<LoadError what="Outreach" /></div>;

  const lead = hasCrmCapability(ctx.grants, company.id, "assign_owner");
  const all = lead && sp.view === "all";
  const filters = outreachFiltersFromParams(sp);
  const today = todayInDubai();
  let rows: OutreachListRow[];
  let staff: StaffPerson[] = [];
  try {
    [rows, staff] = await Promise.all([loadOutreach(company.id), all ? loadStaff() : Promise.resolve([] as StaffPerson[])]);
  } catch (e) {
    console.error("[outreach] load failed", e);
    return <div className="space-y-4">{heading}<LoadError what="Outreach" retryHref={`/sales/outreach?company=${company.id}${all ? "&view=all" : ""}`} /></div>;
  }
  const scoped = all ? rows : rows.filter((r) => r.assigned_to === ctx.userId);
  const shown = filterOutreach(scoped, { ...filters, assignee: all ? filters.assignee : "" }, today);
  const nameOf = (uid: string) => staff.find((p) => p.userId === uid)?.name ?? ctx.personName(uid);
  const assignees = [...new Set(scoped.map((r) => r.assigned_to))];
  const base = `/sales/outreach?company=${company.id}`;
  const overdueCount = scoped.filter((r) => isOverdue(r, today)).length;
  const hasFilter = !!(filters.assignee || filters.status || filters.overdue);

  return (
    <div className="space-y-6">
      {heading}
      {lead ? (
        <nav aria-label="Outreach view" className="flex gap-2">
          <Link href={base} aria-current={all ? undefined : "page"} className={cn(buttonVariants({ variant: all ? "ghost" : "secondary", size: "sm" }))}>My outreach</Link>
          <Link href={`${base}&view=all`} aria-current={all ? "page" : undefined} className={cn(buttonVariants({ variant: all ? "secondary" : "ghost", size: "sm" }))}>All outreach</Link>
        </nav>
      ) : null}

      <form method="get" role="search" aria-label="Filter outreach" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="company" value={company.id} />
        {all ? <input type="hidden" name="view" value="all" /> : null}
        {ctx.companies.length > 1 ? (
          <div className="space-y-1.5">
            <label htmlFor="or-company" className="text-sm font-medium leading-none">Company</label>
            <Select id="or-company" name="company" defaultValue={company.id}>{ctx.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </div>
        ) : null}
        {all ? (
          <div className="space-y-1.5">
            <label htmlFor="or-assignee" className="text-sm font-medium leading-none">Assigned to</label>
            <Select id="or-assignee" name="assignee" defaultValue={filters.assignee}>
              <option value="">Anyone</option>
              {assignees.map((u) => <option key={u} value={u}>{nameOf(u)}</option>)}
            </Select>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor="or-status" className="text-sm font-medium leading-none">Status</label>
          <Select id="or-status" name="status" defaultValue={filters.status}>
            <option value="">Not closed</option>
            {OUTREACH_STATUSES.map((s) => <option key={s} value={s}>{OUTREACH_STATUS_LABEL[s]}</option>)}
          </Select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm font-medium"><input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue} className="h-4 w-4" /> Overdue only</label>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="secondary">Apply</Button>
          {hasFilter ? <Link href={`${base}${all ? "&view=all" : ""}`} className={buttonVariants({ variant: "ghost" })}>Clear</Link> : null}
        </div>
      </form>

      <p className="text-sm text-muted-foreground" role="status">
        {all ? `All outreach for ${company.name}` : "Your outreach"}: {scoped.filter((r) => r.status !== "closed").length} open{overdueCount ? `, ${overdueCount} overdue` : ""}. Sorted by next due date; with no next action, by target date.
      </p>

      {scoped.length === 0 ? (
        <EmptyState icon={ClipboardList} title={all ? "No outreach yet" : "Nothing assigned to you"} description={all ? "Select accounts in Clients & Agencies and choose Assign outreach." : "A Sales lead can assign you accounts to approach from Clients & Agencies."} />
      ) : shown.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nothing matches" description="Clear a filter to see more." action={<Link href={`${base}${all ? "&view=all" : ""}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : (
        <ul className="space-y-3" aria-label="Outreach">
          {shown.map((o) => (
            <li key={o.id}>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="min-w-0 break-words leading-snug">
                      <Link href={`/sales/accounts/${o.organisation_id}?company=${company.id}#outreach`} className="underline-offset-2 hover:underline">{o.accountName}</Link>
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {all ? <OsBadge tone="quiet" className="whitespace-nowrap">{nameOf(o.assigned_to)}</OsBadge> : null}
                      <OutreachStatusBadge status={o.status} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent><OutreachFacts o={o} today={today} /></CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
