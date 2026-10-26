import Link from "next/link";
import { crmStageLabel } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadFollowUps, loadOpportunities, num, type FollowUpListItem, type OpportunityListItem } from "@/lib/crm/data";
import {
  elapsedFirstResponse, enquiriesBySource, followUpCounts, openPipelineByOwner, openPipelineByStage, reopenedClosures, resolvePeriod, timelinessByCompany, wonLostInPeriod, wonValueRows, zohoSummary,
  type CompanyTimeliness, type ReportOpp, type WonValueRow,
} from "@/lib/crm/reports";
import { createClient } from "@/lib/supabase/server";
import type { CrmZohoReferenceRow } from "@/types/crm";
import { CurrencyTotals } from "../currency-totals";

export const metadata = { title: "Sales reports" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const LOAD_LIMIT = 2000; // loadOpportunities caps at this many (newest first)

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getCrmContext();
  if (!ctx) return null;

  const now = new Date();
  const period = resolvePeriod(first(sp.from), first(sp.to), now);
  const company = ctx.companies.some((c) => c.id === first(sp.company)) ? first(sp.company) : "";

  let items: OpportunityListItem[];
  let followUps: FollowUpListItem[];
  try {
    [items, { open: followUps }] = await Promise.all([loadOpportunities(ctx), loadFollowUps(ctx)]);
  } catch (e) {
    console.error("[crm] reports load failed", e);
    return (
      <div className="space-y-4">
        <Header />
        <Alert variant="destructive">Could not load the reports. Reload the page; if it keeps happening, tell an administrator.</Alert>
      </div>
    );
  }

  const scoped = items.filter((i) => !company || i.opp.company_id === company);
  const opps: ReportOpp[] = scoped.map((i) => ({ ...i.opp, value: i.value }));
  const scopedFollowUps = followUps.filter((f) => !company || f.opportunity.company_id === company);

  const stages = openPipelineByStage(opps);
  const owners = openPipelineByOwner(opps);
  const fuCounts = followUpCounts(scopedFollowUps.map((f) => f.followUp), now);
  const wl = wonLostInPeriod(opps, period);
  const sources = enquiriesBySource(opps, period);
  const elapsed = elapsedFirstResponse(opps, period);
  const timeliness = timelinessByCompany(
    opps,
    ctx.companies
      .filter((c) => !company || c.id === company)
      .map((c) => ({ id: c.id, name: c.name, responseTargetHours: c.settings?.response_target_hours ?? null, workingCalendar: c.settings?.working_calendar ?? null })),
    period,
    now,
  );

  // Manual Zoho references for the won opportunities in view. RLS limits this to companies the person may see.
  let zohoError: string | null = null;
  let zohoRows: CrmZohoReferenceRow[] = [];
  if (wl.wonOpps.length > 0) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("crm_zoho_references").select("*").limit(5000);
    if (error) zohoError = "Could not load the Zoho references.";
    else zohoRows = data ?? [];
  }
  // Closures that were later reopened are kept in history; they are not outcomes any more, so count them separately.
  let reopened = { won: 0, lost: 0, total: 0 };
  {
    const supabase = await createClient();
    const { data } = await supabase.from("crm_closures").select("outcome, closed_at, reopened_at").not("reopened_at", "is", null).limit(5000);
    reopened = reopenedClosures(data ?? [], period);
  }
  const wonRows = wonValueRows(wl.wonOpps, zohoRows);
  const zoho = zohoSummary(wonRows);
  const titleOf = new Map(items.map((i) => [i.opp.id, i]));

  const defaultPeriod = resolvePeriod(undefined, undefined, now);
  const isDefaultPeriod = period.from === defaultPeriod.from && period.to === defaultPeriod.to;

  return (
    <div className="space-y-6">
      <Header />

      <form method="get" action="/sales/reports" className="flex flex-wrap items-end gap-3" aria-label="Report period">
        <div className="space-y-1.5">
          <label htmlFor="r-from" className="text-sm font-medium leading-none">From</label>
          <Input id="r-from" name="from" type="date" defaultValue={period.from} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="r-to" className="text-sm font-medium leading-none">To</label>
          <Input id="r-to" name="to" type="date" defaultValue={period.to} className="w-40" />
        </div>
        {ctx.companies.length > 1 ? (
          <div className="space-y-1.5">
            <label htmlFor="r-company" className="text-sm font-medium leading-none">Company</label>
            <Select id="r-company" name="company" defaultValue={company} className="w-60">
              <option value="">All companies</option>
              {ctx.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
        ) : null}
        <Button type="submit" size="sm">Apply</Button>
        {!isDefaultPeriod || company ? <Link href="/sales/reports" className={buttonVariants({ variant: "ghost", size: "sm" })}>Reset</Link> : null}
      </form>
      <p className="-mt-3 text-sm text-muted-foreground">
        Period: {formatDate(period.from)} to {formatDate(period.to)} (Dubai dates){isDefaultPeriod ? ", the last 90 days" : ""}. It applies to won and lost (by closing date), enquiries by source and timeliness (by date logged). Pipeline and follow-up figures are as of now.
      </p>
      {items.length >= LOAD_LIMIT ? <Alert variant="warning">Only the newest {LOAD_LIMIT.toLocaleString("en-US")} opportunities are included, so older figures may be incomplete.</Alert> : null}

      {items.length === 0 ? (
        <EmptyState title="Not enough data yet" description="Reports appear once opportunities have been recorded." action={<Link href="/sales/new" className={buttonVariants({ size: "sm" })}>New enquiry</Link>} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ReportCard title="Open pipeline by stage" description="Open opportunities now. Each currency on its own line; never added together." note={`n = ${stages.reduce((n, s) => n + s.count, 0)} open opportunities`}>
            <Table stack>
              <caption className="sr-only">Open pipeline by stage</caption>
              <TableHeader><TableRow><TableHead scope="col">Stage</TableHead><TableHead scope="col" className="text-right">Open</TableHead><TableHead scope="col" className="text-right">Value</TableHead></TableRow></TableHeader>
              <TableBody>
                {stages.map((s) => (
                  <TableRow key={s.stage} className="align-top">
                    <TableHead scope="row" className="h-auto p-4 align-top text-sm font-normal normal-case tracking-normal text-foreground">{crmStageLabel(s.stage)}</TableHead>
                    <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                    <TableCell className="text-right"><CurrencyTotals totals={s.totals} unvalued={s.unvalued} emptyText={s.count ? "No value recorded" : "—"} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ReportCard>

          <ReportCard title="Open pipeline by owner" description="Open opportunities now." note={`n = ${owners.reduce((n, o) => n + o.count, 0)} open opportunities`}>
            {owners.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open opportunities.</p>
            ) : (
              <Table stack>
                <caption className="sr-only">Open pipeline by owner</caption>
                <TableHeader><TableRow><TableHead scope="col">Owner</TableHead><TableHead scope="col" className="text-right">Open</TableHead><TableHead scope="col" className="text-right">Value</TableHead></TableRow></TableHeader>
                <TableBody>
                  {owners.map((o) => (
                    <TableRow key={o.ownerId} className="align-top">
                      <TableHead scope="row" className="h-auto p-4 align-top text-sm font-normal normal-case tracking-normal text-foreground">{ctx.personName(o.ownerId)}</TableHead>
                      <TableCell className="text-right tabular-nums">{o.count}</TableCell>
                      <TableCell className="text-right"><CurrencyTotals totals={o.totals} unvalued={o.unvalued} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ReportCard>

          <ReportCard title="Follow-ups" description="Open follow-ups as of now." note={`n = ${fuCounts.overdue + fuCounts.dueToday + fuCounts.upcoming} open follow-ups`}>
            <dl className="grid grid-cols-3 gap-3 text-center">
              {[{ l: "Overdue", n: fuCounts.overdue }, { l: "Due today", n: fuCounts.dueToday }, { l: "Upcoming", n: fuCounts.upcoming }].map((x) => (
                <div key={x.l} className="rounded-md border border-border p-3">
                  <dt className="text-sm text-muted-foreground">{x.l}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{x.n}</dd>
                </div>
              ))}
            </dl>
          </ReportCard>

          <ReportCard title="Timeliness" description="First response to enquiries logged in the period. The share within target needs both a response target and a working calendar." note={`n = ${elapsed.enquiries} enquiries logged in the period`}>
            <div className="space-y-4 text-sm">
              {timeliness.length === 0 ? <p className="text-muted-foreground">No companies in scope.</p> : timeliness.map((t) => <TimelinessBlock key={t.companyId} t={t} showName={timeliness.length > 1} />)}
              <div className="border-t border-border pt-3">
                <p className="font-medium">Elapsed time to first response</p>
                <p className="text-muted-foreground">
                  {elapsed.enquiries === 0
                    ? "No enquiries were logged in this period."
                    : elapsed.medianHours === null
                      ? `No first responses recorded yet (${elapsed.awaiting} awaiting).`
                      : `Median ${elapsed.medianHours.toFixed(1)} hours (clock time, not working hours). ${elapsed.responded} of ${elapsed.enquiries} answered, ${elapsed.awaiting} awaiting.`}
                </p>
              </div>
            </div>
          </ReportCard>

          <ReportCard title="Won and lost" description="Closed in the period, by closing date. Won means a Won stage with purchase-order or authorised-email evidence." note={`n = ${wl.won + wl.lost} closed opportunities`}>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border border-border p-3"><div className="text-sm text-muted-foreground">Won</div><div className="text-2xl font-semibold tabular-nums">{wl.won}</div></div>
              <div className="rounded-md border border-border p-3"><div className="text-sm text-muted-foreground">Lost</div><div className="text-2xl font-semibold tabular-nums">{wl.lost}</div></div>
              <div className="rounded-md border border-border p-3"><div className="text-sm text-muted-foreground">Win rate</div><div className="text-2xl font-semibold tabular-nums">{wl.winRatePercent === null ? "n/a" : `${wl.winRatePercent}%`}</div></div>
            </div>
            {wl.winRatePercent === null ? <p className="mt-2 text-sm text-muted-foreground">No opportunities were closed in this period, so there is no win rate.</p> : <p className="mt-2 text-sm text-muted-foreground">Win rate is won as a share of won plus lost. Small numbers move it a lot.</p>}
            {reopened.total > 0 ? <p className="mt-2 text-sm text-muted-foreground">{reopened.total} closure{reopened.total === 1 ? "" : "s"} in this period ({reopened.won} won, {reopened.lost} lost) {reopened.total === 1 ? "was" : "were"} later reopened. They are open again, so they are not counted above; each closure stays in that opportunity&apos;s history.</p> : null}
            {wl.wonWithoutEvidence > 0 ? <p className="mt-2 text-sm text-[hsl(var(--os-amber))]">{wl.wonWithoutEvidence} won with no evidence recorded, not counted as won.</p> : null}
          </ReportCard>

          <ReportCard title="Lost reasons" note={`n = ${wl.lost} lost opportunities`}>
            {wl.lostReasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No opportunities were lost in this period.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {wl.lostReasons.map((r) => <li key={r.reason} className="flex justify-between gap-3"><span className="break-words">{r.reason}</span><span className="tabular-nums">{r.count}</span></li>)}
              </ul>
            )}
          </ReportCard>

          <ReportCard title="Enquiries by source" description="Logged in the period." note={`n = ${sources.reduce((n, s) => n + s.count, 0)} enquiries`}>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No enquiries were logged in this period.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {sources.map((s) => <li key={s.source} className="flex justify-between gap-3"><span className="break-words">{s.source}</span><span className="tabular-nums">{s.count}</span></li>)}
              </ul>
            )}
          </ReportCard>

          <ReportCard title="Won value" description="Commercially won in the period, per currency." note={`n = ${wl.won} won opportunities`}>
            <CurrencyTotals totals={wl.wonValue} emptyText="No won value in this period" className="text-lg font-semibold" />
          </ReportCard>

          <ReportCard
            title="Won value against invoice and payment references"
            description="Won value is a recorded sale. The invoice and payment columns are references typed in by hand on each opportunity. They are not read from Zoho Books and may be out of date."
            note={`n = ${wl.won} won opportunities`}
            className="lg:col-span-2"
          >
            {zohoError ? <Alert variant="destructive" className="mb-3">{zohoError}</Alert> : null}
            {wonRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No won opportunities in this period.</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-muted-foreground">
                  {zoho.invoicedCount} of {wonRows.length} have an invoice reference recorded by hand; {zoho.collectedCount} have a payment date recorded by hand.
                </p>
                <Table className="min-w-[44rem]">
                  <caption className="sr-only">Won opportunities with manually recorded invoice and payment references</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Opportunity</TableHead>
                      <TableHead scope="col" className="text-right">Won value</TableHead>
                      <TableHead scope="col">Invoice (manual reference)</TableHead>
                      <TableHead scope="col">Payment received (manual reference)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wonRows.map((r) => <WonRow key={r.opp.id} row={r} title={titleOf.get(r.opp.id)} />)}
                  </TableBody>
                </Table>
              </>
            )}
          </ReportCard>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Sales reports</h1>
      <p className="text-muted-foreground">Each figure says how many records it rests on. Amounts are always per currency.</p>
    </div>
  );
}

function ReportCard({ title, description, note, className, children }: { title: string; description?: string; note?: string; className?: string; children: React.ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader className="space-y-1.5">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {children}
        {note ? <p className="mt-3 text-sm text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  );
}

function TimelinessBlock({ t, showName }: { t: CompanyTimeliness; showName: boolean }) {
  const { kpi } = t;
  return (
    <div>
      {showName ? <p className="font-medium">{t.companyName}</p> : <p className="font-medium">Share answered within target</p>}
      {kpi.status === "not_configured" ? (
        <p className="text-muted-foreground">Not configured. {kpi.reason} Only elapsed times are shown.</p>
      ) : t.enquiries === 0 ? (
        <p className="text-muted-foreground">No enquiries were logged in this period.</p>
      ) : kpi.measured === 0 ? (
        <p className="text-muted-foreground">Nothing measurable yet: {kpi.waiting} enquir{kpi.waiting === 1 ? "y is" : "ies are"} still inside the {kpi.targetHours}-hour target.</p>
      ) : (
        <p className="text-muted-foreground">
          {Math.round((kpi.withinTarget / kpi.measured) * 100)}% ({kpi.withinTarget} of {kpi.measured}) answered within {kpi.targetHours} working hours
          {kpi.medianHours === null ? "" : `; median ${kpi.medianHours.toFixed(1)} working hours`}
          {kpi.waiting > 0 ? `; ${kpi.waiting} still inside the target` : ""}.
        </p>
      )}
    </div>
  );
}

function WonRow({ row, title }: { row: WonValueRow; title: OpportunityListItem | undefined }) {
  const { opp, zoho } = row;
  const paid = num(zoho?.paid_amount);
  return (
    <TableRow className="align-top">
      <TableHead scope="row" className="h-auto p-4 align-top text-sm font-normal normal-case tracking-normal text-foreground">
        <Link href={`/sales/opportunities/${opp.id}`} className="underline-offset-2 hover:underline">{title?.opp.title ?? opp.id}</Link>
        <div className="font-mono text-sm text-muted-foreground">{title?.opp.reference}</div>
      </TableHead>
      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(opp.value, opp.currency)}</TableCell>
      <TableCell>{zoho?.invoice_ref || zoho?.invoice_issued_on ? [zoho.invoice_ref, zoho.invoice_issued_on ? formatDate(zoho.invoice_issued_on) : null].filter(Boolean).join(", ") : <span className="text-muted-foreground">Not recorded</span>}</TableCell>
      <TableCell>
        {zoho?.payment_received_on ? `${formatDate(zoho.payment_received_on)}${paid != null ? `, ${formatMoney(paid, opp.currency)}` : ""}` : <span className="text-muted-foreground">Not recorded</span>}
      </TableCell>
    </TableRow>
  );
}
