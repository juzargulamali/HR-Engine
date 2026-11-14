import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { hasCrmCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { ChooseCompanyNotice, CompanySwitch } from "@/components/sales/company-switch";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { LoadError } from "@/components/workspace/states";
import { todayInDubai } from "@/components/sales/format";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext } from "@/lib/crm/context";
import { loadStaff } from "@/lib/crm/clients-agencies/data";
import { loadOutreach, type OutreachListRow } from "@/lib/crm/clients-agencies/outreach-data";
import { filterOutreach, isOverdue, OUTREACH_LIMIT, OUTREACH_STATUS_LABEL, OUTREACH_STATUSES, outreachFiltersFromParams } from "@/lib/crm/clients-agencies/outreach";
import type { StaffPerson } from "@/lib/crm/clients-agencies/staff";
import { cn } from "@/lib/utils";
import { OutreachRow } from "./outreach-row";

export const metadata = { title: "Outreach" };

/**
 * My outreach (the person's own assignments) and, for a Sales lead (assign owners right), All outreach for the company. The database decides what each person may
 * read: an assignee reads own rows, a lead the company's; the "mine" view additionally filters to the signed-in person.
 */
export default async function OutreachPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = await searchParams;
  // The company in the address, else the one used last in Sales, else the person's own: never the first by name (lib/crm/active-company.ts).
  const active = await pickSalesCompany(ctx, sp.company);
  const company = active.company;
  const wantsAll = sp.view === "all";
  const heading = (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold">
        Outreach
        <InfoHint label="Outreach" className="ml-1.5">
          Accounts assigned to a salesperson to approach or re-engage, before any enquiry exists. A Sales lead assigns them from Clients &amp; Agencies. Logging an activity or setting a next action only records it here: nothing is sent to the client.
        </InfoHint>
      </h1>
      <p className="text-sm text-muted-foreground">Who to contact next, and by when.</p>
    </div>
  );
  // Choosing another company keeps My outreach or All outreach; the filters start again (an assignee belongs to one company's list).
  const companySwitch = <CompanySwitch companies={ctx.companies} current={company?.id ?? null} from={active.from} hrefFor={(id) => `/sales/outreach?company=${id}${wantsAll ? "&view=all" : ""}`} />;
  if (!company) {
    return (
      <div className="space-y-4">
        {heading}
        {active.from === "choose" ? <>{companySwitch}<ChooseCompanyNotice what="that company's outreach" /></> : <LoadError what="Outreach" />}
      </div>
    );
  }

  const lead = hasCrmCapability(ctx.grants, company.id, "assign_owner");
  const all = lead && wantsAll;
  const filters = outreachFiltersFromParams(sp);
  const today = todayInDubai();
  let rows: OutreachListRow[];
  let staff: StaffPerson[] = [];
  try {
    [rows, staff] = await Promise.all([loadOutreach(company.id), all ? loadStaff() : Promise.resolve([] as StaffPerson[])]);
  } catch (e) {
    console.error("[outreach] load failed", e);
    return <div className="space-y-4">{heading}{companySwitch}<LoadError what="Outreach" retryHref={`/sales/outreach?company=${company.id}${all ? "&view=all" : ""}`} /></div>;
  }
  // The read is bounded: when it comes back full there may be more than it holds, and the page says so instead of looking complete.
  const full = rows.length >= OUTREACH_LIMIT;
  const scoped = all ? rows : rows.filter((r) => r.assigned_to === ctx.userId);
  const shown = filterOutreach(scoped, { ...filters, assignee: all ? filters.assignee : "" }, today);
  const nameOf = (uid: string) => staff.find((p) => p.userId === uid)?.name ?? ctx.personName(uid);
  const assignees = [...new Set(scoped.map((r) => r.assigned_to))];
  const base = `/sales/outreach?company=${company.id}`;
  const overdueCount = scoped.filter((r) => isOverdue(r, today)).length;
  const waitingCount = scoped.filter((r) => r.status === "waiting_for_reply" && !isOverdue(r, today)).length;
  const openCount = scoped.filter((r) => r.status !== "closed").length;
  const toolbarFilters: ToolbarFilter[] = [
    ...(all ? [{ name: "assignee", label: "Assigned to", value: filters.assignee, options: [{ value: "", label: "Anyone" }, ...assignees.map((u) => ({ value: u, label: nameOf(u) }))] }] : []),
    { name: "status", label: "Status", value: filters.status, options: [{ value: "", label: "Not closed" }, ...OUTREACH_STATUSES.map((x) => ({ value: x, label: OUTREACH_STATUS_LABEL[x] }))] },
    { name: "overdue", label: "Overdue only", kind: "toggle" as const, value: filters.overdue ? "1" : "" },
  ];
  const clearHref = `${base}${all ? "&view=all" : ""}`;
  // Assignment happens in Clients & Agencies (select accounts, Assign outreach), in the same company.
  const assignHref = `/sales/accounts?company=${company.id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        {lead ? <Link href={assignHref} className={buttonVariants({ variant: "outline" })} data-testid="outreach-assign">Assign outreach</Link> : null}
      </div>
      {companySwitch}
      {lead ? (
        <nav aria-label="Outreach view" className="flex gap-2">
          <Link href={base} aria-current={all ? undefined : "page"} className={cn(buttonVariants({ variant: all ? "ghost" : "secondary", size: "sm" }))}>My outreach</Link>
          <Link href={`${base}&view=all`} aria-current={all ? "page" : undefined} className={cn(buttonVariants({ variant: all ? "secondary" : "ghost", size: "sm" }))}>All outreach</Link>
        </nav>
      ) : null}

      {/* Same toolbar as Sales > Enquiries: each filter applies as it is chosen (no Apply button); My outreach or All outreach and the company stay. */}
      <ListToolbar filters={toolbarFilters} clearHref={clearHref} />

      <p className="text-sm text-muted-foreground" role="status" data-testid="outreach-count">
        <span className="font-medium text-foreground">{all ? `All outreach for ${company.name}` : `Your outreach for ${company.name}`}: {openCount} open</span>
        {overdueCount ? <>, <span className="font-medium text-[hsl(var(--os-red))]">{overdueCount} overdue</span></> : null}
        {waitingCount ? <>, <span className="font-medium text-[hsl(var(--os-amber))]">{waitingCount} waiting for a reply</span></> : null}.
        <InfoHint label="How the list is ordered" className="ml-1">
          Sorted by the next action&apos;s due date, earliest first; with no next action, by the target date. Overdue means still being worked and that date has passed. Waiting for a reply is the status you set, never guessed from what was logged. Closed outreach is hidden unless you choose it under Status.
        </InfoHint>
      </p>
      {full ? (
        <Alert variant="warning" role="alert" data-testid="outreach-limit">
          Showing the first {OUTREACH_LIMIT} outreach records for {company.name}, earliest target date first. There may be more that are not listed or counted here{all ? "" : ", including some of yours"}. Open an account to see its own outreach.
        </Alert>
      ) : null}

      {scoped.length === 0 ? (
        all ? (
          <EmptyState icon={ClipboardList} title={full ? "Nothing in the records shown" : "No outreach yet"} description="Select accounts in Clients & Agencies and choose Assign outreach: each becomes a row here for the person you choose."
            action={<Link href={assignHref} className={buttonVariants({ size: "sm" })}>Choose accounts to assign</Link>} />
        ) : lead ? (
          <EmptyState icon={ClipboardList} title={full ? "Nothing of yours in the records shown" : "Nothing assigned to you"} description="You can assign accounts to yourself or the team: select them in Clients & Agencies and choose Assign outreach."
            action={<span className="flex flex-wrap justify-center gap-2"><Link href={assignHref} className={buttonVariants({ size: "sm" })}>Choose accounts to assign</Link><Link href={`${base}&view=all`} className={buttonVariants({ variant: "outline", size: "sm" })}>See all outreach</Link></span>} />
        ) : (
          <EmptyState icon={ClipboardList} title={full ? "Nothing of yours in the records shown" : "Nothing assigned to you"} description="A Sales lead assigns accounts to approach from Clients & Agencies: ask yours when you are ready for more. Until then, your dated next steps are in Follow-ups."
            action={<Link href="/sales/follow-ups" className={buttonVariants({ variant: "outline", size: "sm" })}>Open Follow-ups</Link>} />
        )
      ) : shown.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nothing matches" description="Clear a filter to see more." action={<Link href={clearHref} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : (
        <ul className="space-y-2" aria-label="Outreach">
          {shown.map((o) => <OutreachRow key={o.id} o={o} today={today} ownerName={o.assigned_to === ctx.userId ? `${nameOf(o.assigned_to)} (you)` : nameOf(o.assigned_to)} companyId={company.id} />)}
        </ul>
      )}
    </div>
  );
}
