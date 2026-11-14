import Link from "next/link";
import { canManageCrmSettings, crmStageLabel, isCrmFounder } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChooseCompanyNotice, CompanySwitch } from "@/components/sales/company-switch";
import { formatDate, formatMoney } from "@/components/sales/format";
import { LoadError } from "@/components/workspace/states";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext } from "@/lib/crm/context";
import { loadFollowUps, loadOpportunities, num, readForIds, readPaged, type FollowUpListItem, type OpportunityListItem } from "@/lib/crm/data";
import { addDays, currenciesOf,
  elapsedFirstResponse, enquiriesBySource, followUpCounts, openPipelineByOwner, openPipelineByStage, periodText, reopenedClosures, REPORT_GROUPS, REPORT_TEXT, resolvePeriod, scopeLine, timelinessByCompany, wonLostInPeriod, wonValueRows, zohoSummary,
  type CompanyTimeliness, type ReportId, type ReportOpp, type WonValueRow,
} from "@/lib/crm/reports";
import { createClient } from "@/lib/supabase/server";
import type { CrmClosureRow, CrmZohoReferenceRow } from "@/types/crm";
import { CurrencyTotals } from "../currency-totals";

export const metadata = { title: "Sales reports" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const LOAD_LIMIT = 2000; // loadOpportunities caps at this many (newest first)
const BASE = "/sales/reports";
/** The address of this page with the given dates and company (or All my companies), for "Try again", the company chooser and Reset. */
const reportHref = (p: { from?: string; to?: string; company?: string; all?: boolean }) => {
  const qs = new URLSearchParams();
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  if (p.all) qs.set("scope", "all"); else if (p.company) qs.set("company", p.company);
  return `${BASE}${qs.size ? `?${qs.toString()}` : ""}`;
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getCrmContext();
  if (!ctx) return null;

  const now = new Date();
  const period = resolvePeriod(first(sp.from), first(sp.to), now);
  // One company at a time by default: the active Sales company (the one in the address, the one used last, the person's employing company, their only one).
  // "All my companies" is an explicit choice for a person who holds several. With several and none to assume, nothing is loaded until they choose.
  const canAll = ctx.companies.length > 1;
  const all = canAll && first(sp.scope) === "all";
  const active = await pickSalesCompany(ctx, sp.company);
  const company = all ? "" : (active.company?.id ?? "");
  const companyLabel = all ? "all your companies" : (active.company?.name ?? "your company");
  const given = { from: first(sp.from) || undefined, to: first(sp.to) || undefined };
  const here = reportHref({ ...given, company, all });
  const switcher = (
    <CompanySwitch companies={ctx.companies} current={company || null} from={active.from}
      hrefFor={(id) => reportHref({ ...given, company: id })}
      all={canAll ? { href: reportHref({ ...given, all: true }), active: all } : undefined} />
  );
  if (!all && active.from === "choose") {
    return (
      <div className="space-y-5">
        <Header />
        {switcher}
        <ChooseCompanyNotice what="the reports" />
      </div>
    );
  }

  // The enquiries are what almost every card is built from: without them there is no report. The follow-ups feed one card only, so their failure is that card's.
  // Only what the report needs is read, completely: the enquiries that are still open (the pipeline cards), those created in the period (sources, first response)
  // and those closed in the period (Won and Lost), for the chosen company. The window is a day wider on each side than the period; every figure then applies
  // its own exact Dubai-day rule (inPeriod) and its own definition, exactly as before, so no definition changes: only fewer rows are read.
  const window = { from: `${addDays(period.from, -1)}T00:00:00Z`, to: `${addDays(period.to, 2)}T00:00:00Z` };
  const [itemsRes, followUpsRes] = await Promise.allSettled([
    loadOpportunities(ctx, { ...(company ? { company } : {}), anyOf: { open: true, createdFrom: window.from, createdTo: window.to, closedFrom: window.from, closedTo: window.to } }),
    loadFollowUps(ctx),
  ]);
  if (itemsRes.status === "rejected") {
    console.error("[crm] reports load failed", itemsRes.reason);
    return (
      <div className="space-y-4">
        <Header />
        {switcher}
        <LoadError what="the reports" retryHref={here} note="No figure is shown because the enquiries they are built from could not be read. This is not a report with zero results." />
      </div>
    );
  }
  const items: OpportunityListItem[] = itemsRes.value;
  const followUpsFailed = followUpsRes.status === "rejected";
  if (followUpsRes.status === "rejected") console.error("[crm] reports follow-ups failed", followUpsRes.reason);
  const followUps: FollowUpListItem[] = followUpsRes.status === "fulfilled" ? followUpsRes.value.open : [];

  const scoped = items.filter((i) => !company || i.opp.company_id === company);
  const opps: ReportOpp[] = scoped.map((i) => ({ ...i.opp, value: i.value }));
  const scopedFollowUps = followUps.filter((f) => !company || f.followUp.company_id === company);

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

  // Manual Zoho references for the won opportunities in view. RLS limits this to companies the person may see. A failed read is the card's own
  // "Could not load": it is never shown as "Not recorded" on every row or as "0 of N have an invoice reference".
  let zohoFailed = false;
  let zohoRows: CrmZohoReferenceRow[] = [];
  if (wl.wonOpps.length > 0) {
    const supabase = await createClient();
    // Only the references of the won enquiries in view, read completely (never "the first rows of the table").
    try { zohoRows = await readForIds<CrmZohoReferenceRow>(wl.wonOpps.map((o) => o.id), (chunk, from, to) => supabase.from("crm_zoho_references").select("*").in("opportunity_id", chunk).order("opportunity_id").range(from, to)); }
    catch (e) { zohoFailed = true; console.error("[crm] reports zoho references failed", e); }
  }
  // Closures that were later reopened are kept in history; they are not outcomes any more, so count them separately.
  let reopened = { won: 0, lost: 0, total: 0 };
  let reopenedFailed = false;
  {
    const supabase = await createClient();
    // The chosen company applies to this note as it does to every other figure, and the read is complete.
    try {
      const rows = await readPaged<Pick<CrmClosureRow, "outcome" | "closed_at" | "reopened_at">>((from, to) => {
        let query = supabase.from("crm_closures").select("outcome, closed_at, reopened_at").not("reopened_at", "is", null);
        if (company) query = query.eq("company_id", company);
        return query.order("closed_at").order("id").range(from, to);
      });
      reopened = reopenedClosures(rows, period);
    } catch (e) { reopenedFailed = true; console.error("[crm] reports reopened closures failed", e); }
  }
  const failedCards = [followUpsFailed ? "Follow-ups" : null, reopenedFailed ? "the reopened-closures note under Won and lost" : null, zohoFailed ? "Won value against invoice and payment references" : null].filter((x): x is string => x !== null);
  const wonRows = wonValueRows(wl.wonOpps, zohoRows);
  const zoho = zohoSummary(wonRows);
  const titleOf = new Map(items.map((i) => [i.opp.id, i]));

  const defaultPeriod = resolvePeriod(undefined, undefined, now);
  const isDefaultPeriod = period.from === defaultPeriod.from && period.to === defaultPeriod.to;
  const when = periodText(period);
  const openCount = stages.reduce((n, s) => n + s.count, 0);
  const sourceCount = sources.reduce((n, s) => n + s.count, 0);
  const pipelineCurrencies = currenciesOf(...stages.map((s) => s.totals));
  const wonCurrencies = currenciesOf(wl.wonValue);
  // A count is a link only when the Enquiries list can show exactly that set: one company, a complete read, and a filter the list has (stage, or owner with
  // its default "open"). The list has no date or source filter, so the period figures (won, lost, sources) are not linked; nor is anything under "All my companies".
  const linkable = !all && company !== "" && items.length < LOAD_LIMIT;
  const listHref = (filter: Record<string, string>) => `/sales/opportunities?${new URLSearchParams({ ...filter, company }).toString()}`;
  const ownerListed = (id: string) => ctx.people.some((p) => p.id === id);
  // Timeliness that cannot be worked out, said once here (not on every card), with the way to the right company's settings.
  const unconfigured = timeliness.filter((t) => t.kpi.status === "not_configured");
  const canSet = (companyId: string) => isCrmFounder(ctx.grants, companyId) || canManageCrmSettings(ctx.grants, companyId);

  const scopeOf: Record<ReportId, { line: string; currencies?: string[] }> = {
    pipeline_by_stage: { line: scopeLine(openCount, "open enquiry", "open enquiries", companyLabel, "as of now"), currencies: pipelineCurrencies },
    pipeline_by_owner: { line: scopeLine(owners.reduce((n, o) => n + o.count, 0), "open enquiry", "open enquiries", companyLabel, "as of now"), currencies: pipelineCurrencies },
    follow_ups: { line: followUpsFailed ? `${companyLabel}, as of now` : scopeLine(fuCounts.overdue + fuCounts.dueToday + fuCounts.upcoming, "open follow-up", "open follow-ups", companyLabel, "as of now") },
    timeliness: { line: scopeLine(elapsed.enquiries, "enquiry logged", "enquiries logged", companyLabel, when) },
    won_lost: { line: scopeLine(wl.won + wl.lost, "closed enquiry", "closed enquiries", companyLabel, when) },
    lost_reasons: { line: scopeLine(wl.lost, "lost enquiry", "lost enquiries", companyLabel, when) },
    sources: { line: scopeLine(sourceCount, "enquiry", "enquiries", companyLabel, when) },
    won_value: { line: scopeLine(wl.won, "won enquiry", "won enquiries", companyLabel, when), currencies: wonCurrencies },
    won_references: { line: scopeLine(wl.won, "won enquiry", "won enquiries", companyLabel, when), currencies: wonCurrencies },
  };
  const count = (n: number, href: string | null, label: string) => (href && n > 0
    ? <Link href={href} className="font-medium underline underline-offset-2" aria-label={`${n}: ${label}`} data-testid="report-count-link">{n}</Link>
    : n);

  const cards: Record<ReportId, React.ReactNode> = {
    pipeline_by_stage: (
      <Table stack>
        <caption className="sr-only">Open pipeline by stage</caption>
        <TableHeader><TableRow><TableHead scope="col">Stage</TableHead><TableHead scope="col" className="text-right">Open</TableHead><TableHead scope="col" className="text-right">Value</TableHead></TableRow></TableHeader>
        <TableBody>
          {stages.map((s) => (
            <TableRow key={s.stage} className="align-top">
              <TableHead scope="row" className="h-auto p-4 align-top text-sm font-normal normal-case tracking-normal text-foreground">{crmStageLabel(s.stage)}</TableHead>
              <TableCell className="text-right tabular-nums">{count(s.count, linkable ? listHref({ stage: s.stage }) : null, `open the ${crmStageLabel(s.stage)} enquiries of ${companyLabel}`)}</TableCell>
              <TableCell className="text-right"><CurrencyTotals totals={s.totals} unvalued={s.unvalued} emptyText={s.count ? "No value recorded" : "—"} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ),
    pipeline_by_owner: owners.length === 0 ? (
      <p className="text-sm text-muted-foreground">No open opportunities.</p>
    ) : (
      <Table stack>
        <caption className="sr-only">Open pipeline by owner</caption>
        <TableHeader><TableRow><TableHead scope="col">Owner</TableHead><TableHead scope="col" className="text-right">Open</TableHead><TableHead scope="col" className="text-right">Value</TableHead></TableRow></TableHeader>
        <TableBody>
          {owners.map((o) => (
            <TableRow key={o.ownerId} className="align-top">
              <TableHead scope="row" className="h-auto break-words p-4 align-top text-sm font-normal normal-case tracking-normal text-foreground">{ctx.personName(o.ownerId)}</TableHead>
              <TableCell className="text-right tabular-nums">{count(o.count, linkable && ownerListed(o.ownerId) ? listHref({ owner: o.ownerId }) : null, `open the enquiries ${ctx.personName(o.ownerId)} owns in ${companyLabel}`)}</TableCell>
              <TableCell className="text-right"><CurrencyTotals totals={o.totals} unvalued={o.unvalued} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ),
    follow_ups: followUpsFailed ? (
      <LoadError what="the follow-up counts" retryHref={here} note="The counts are not zero: they could not be read." />
    ) : (
      <dl className="grid grid-cols-3 gap-3 text-center">
        {[{ l: "Overdue", n: fuCounts.overdue, tone: "red" }, { l: "Due today", n: fuCounts.dueToday, tone: "amber" }, { l: "Upcoming", n: fuCounts.upcoming, tone: "" }].map((x) => (
          <div key={x.l} className="min-w-0 rounded-md border border-border p-3">
            <dt className="text-sm text-muted-foreground">{x.l}</dt>
            <dd className="text-2xl font-semibold tabular-nums" style={x.n > 0 && x.tone ? { color: `hsl(var(--os-${x.tone}))` } : undefined}>{x.n}</dd>
          </div>
        ))}
      </dl>
    ),
    timeliness: (
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
    ),
    won_lost: (
      <>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="min-w-0 rounded-md border border-border p-3"><div className="text-sm text-muted-foreground">Won</div><div className="text-2xl font-semibold tabular-nums">{wl.won}</div></div>
          <div className="min-w-0 rounded-md border border-border p-3"><div className="text-sm text-muted-foreground">Lost</div><div className="text-2xl font-semibold tabular-nums">{wl.lost}</div></div>
          <div className="min-w-0 rounded-md border border-border p-3"><div className="text-sm text-muted-foreground">Win rate</div><div className="text-2xl font-semibold tabular-nums">{wl.winRatePercent === null ? "n/a" : `${wl.winRatePercent}%`}</div></div>
        </div>
        {wl.winRatePercent === null ? <p className="mt-2 text-sm text-muted-foreground">No opportunities were closed in this period, so there is no win rate.</p> : null}
        {reopenedFailed ? <div className="mt-2"><LoadError what="the count of closures that were later reopened" retryHref={here} note="The won and lost figures above do not depend on it; only the note about reopened closures is missing." /></div> : null}
        {reopened.total > 0 ? <p className="mt-2 text-sm text-muted-foreground">{reopened.total} closure{reopened.total === 1 ? "" : "s"} in this period ({reopened.won} won, {reopened.lost} lost) {reopened.total === 1 ? "was" : "were"} later reopened. They are open again, so they are not counted above; each closure stays in that opportunity&apos;s history.</p> : null}
        {wl.wonWithoutEvidence > 0 ? <p className="mt-2 text-sm text-[hsl(var(--os-amber))]">{wl.wonWithoutEvidence} won with no evidence recorded, not counted as won.</p> : null}
      </>
    ),
    lost_reasons: wl.lostReasons.length === 0 ? (
      <p className="text-sm text-muted-foreground">No opportunities were lost in this period.</p>
    ) : (
      <ul className="space-y-1 text-sm">
        {wl.lostReasons.map((r) => <li key={r.reason} className="flex justify-between gap-3"><span className="min-w-0 break-words">{r.reason}</span><span className="tabular-nums">{r.count}</span></li>)}
      </ul>
    ),
    sources: sources.length === 0 ? (
      <p className="text-sm text-muted-foreground">No enquiries were logged in this period.</p>
    ) : (
      <ul className="space-y-1 text-sm">
        {sources.map((s) => <li key={s.source} className="flex justify-between gap-3"><span className="min-w-0 break-words">{s.source}</span><span className="tabular-nums">{s.count}</span></li>)}
      </ul>
    ),
    won_value: <CurrencyTotals totals={wl.wonValue} emptyText="No won value in this period" className="text-lg font-semibold" />,
    won_references: zohoFailed ? (
      <LoadError what="the invoice and payment references" retryHref={here} note="The won value is shown in the card above; the references could not be read, so they are not shown as blank." />
    ) : wonRows.length === 0 ? (
      <p className="text-sm text-muted-foreground">No won opportunities in this period.</p>
    ) : (
      <>
        <p className="mb-3 text-sm text-muted-foreground">
          {zoho.invoicedCount} of {wonRows.length} have an invoice reference recorded by hand; {zoho.collectedCount} have a payment date recorded by hand. The references are typed in, not read from Zoho Books.
        </p>
        {/* Cards on a phone (each row's columns under its enquiry), a table from a tablet up: the page never scrolls sideways. */}
        <Table stack>
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
    ),
  };

  return (
    <div className="space-y-5">
      <Header />
      {switcher}

      <form method="get" action={BASE} className="flex flex-wrap items-end gap-3" aria-label="Report period">
        {all ? <input type="hidden" name="scope" value="all" /> : company ? <input type="hidden" name="company" value={company} /> : null}
        <div className="space-y-1.5">
          <label htmlFor="r-from" className="text-sm font-medium leading-none">From</label>
          <Input id="r-from" name="from" type="date" defaultValue={period.from} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="r-to" className="text-sm font-medium leading-none">To</label>
          <Input id="r-to" name="to" type="date" defaultValue={period.to} className="w-40" />
        </div>
        <Button type="submit" size="sm">Apply dates</Button>
        {!isDefaultPeriod ? <Link href={reportHref({ company, all })} className={buttonVariants({ variant: "ghost", size: "sm" })}>Last 90 days</Link> : null}
        <span className="pb-1.5 text-sm text-muted-foreground" data-testid="report-period">{when} (Dubai dates){isDefaultPeriod ? ", the last 90 days" : ""}
          <InfoHint label="Report period" className="ml-0.5">The dates apply to the results: won and lost (by closing date), lost reasons, enquiries by source, won value and timeliness (by date logged). The current pipeline and the follow-up figures are as of now, whatever the dates.</InfoHint>
        </span>
      </form>
      {items.length >= LOAD_LIMIT ? <Alert variant="warning">Only the newest {LOAD_LIMIT.toLocaleString("en-US")} opportunities are included, so older figures may be incomplete.</Alert> : null}

      {failedCards.length > 0 ? (
        <Alert variant="warning" role="status">
          <strong>This report is incomplete.</strong> Could not load: {failedCards.join("; ")}. Every other figure below is correct for what it covers, and each affected card says so.
        </Alert>
      ) : null}

      {unconfigured.length > 0 ? (
        <Alert variant="warning" role="status" data-testid="timeliness-not-configured">
          <p><strong>Response timeliness is not configured</strong> for {unconfigured.length === 1 ? unconfigured[0]!.companyName : `${unconfigured.length} companies`}, so the share answered within target cannot be worked out. Elapsed times are still shown.</p>
          <ul className="mt-1 space-y-0.5">
            {unconfigured.map((t) => (
              <li key={t.companyId} className="break-words">
                {unconfigured.length > 1 ? <>{t.companyName}: </> : null}{t.kpi.status === "not_configured" ? t.kpi.reason : ""}{" "}
                <Link href={`/sales/settings?company=${t.companyId}#response-targets`} className="font-medium underline underline-offset-2">{canSet(t.companyId) ? "Set response targets" : "See response targets"} for {t.companyName}</Link>
                {canSet(t.companyId) ? null : " (a founder, or someone allowed to manage Sales settings, can change them)"}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="Not enough data yet" description={`Reports appear once enquiries have been recorded for ${companyLabel}.`} action={<Link href={company ? `/sales/new?company=${company}` : "/sales/new"} className={buttonVariants({ size: "sm" })}>New enquiry</Link>} />
      ) : (
        REPORT_GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={`report-group-${g.id}`} className="space-y-3" data-testid={`report-group-${g.id}`}>
            <div>
              <h2 id={`report-group-${g.id}`} className="text-lg font-semibold">{g.title}</h2>
              <p className="text-sm text-muted-foreground"><strong className="font-medium text-foreground">{all ? "All your companies" : companyLabel}</strong>, {g.id === "now" ? "as of now" : when}. {/* the first group's note opens with "As of now.", which the line has just said */}{g.id === "now" ? g.basis.replace(/^As of now\.\s*/, "") : g.basis}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {g.reports.map((id) => (
                <ReportCard key={id} id={id} scope={scopeOf[id].line} currencies={scopeOf[id].currencies} className={id === "won_references" ? "lg:col-span-2" : undefined}>{cards[id]}</ReportCard>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Sales reports
        <InfoHint label="Sales reports" className="ml-1.5">Each figure says how many records it rests on, for which company and which dates. Amounts are always per currency: different currencies are never added together.</InfoHint>
      </h1>
      <p className="text-sm text-muted-foreground">Where the pipeline stands now, and what the chosen dates produced.</p>
    </div>
  );
}

/** One report: its title with the definition behind ⓘ, and right under it what the figures rest on (how many records, which company, which dates, which currencies). */
function ReportCard({ id, scope, currencies, className, children }: { id: ReportId; scope: string; currencies?: string[]; className?: string; children: React.ReactNode }) {
  const text = REPORT_TEXT[id];
  return (
    <Card className={className} data-report={id}>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{text.title}<InfoHint label={text.title} className="ml-1">{text.definition}</InfoHint></CardTitle>
        <p className="text-sm text-muted-foreground" data-testid={`report-scope-${id}`}>{scope}{currencies && currencies.length > 0 ? `. ${currencies.length === 1 ? "Currency" : "Currencies, each on its own line"}: ${currencies.join(", ")}` : ""}</p>
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

function TimelinessBlock({ t, showName }: { t: CompanyTimeliness; showName: boolean }) {
  const { kpi } = t;
  return (
    <div>
      {showName ? <p className="break-words font-medium">{t.companyName}</p> : <p className="font-medium">Share answered within target</p>}
      {kpi.status === "not_configured" ? (
        <p className="text-muted-foreground">Not configured (see the notice at the top of this page). Only elapsed times are shown.</p>
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
        <Link href={`/sales/opportunities/${opp.id}`} className="break-words underline-offset-2 hover:underline">{title?.opp.title ?? opp.id}</Link>
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
