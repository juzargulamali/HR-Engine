import Link from "next/link";
import { CRM_PIPELINE_STAGES, crmStageLabel } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { AvailabilityBadge, DueText } from "@/components/sales/badges";
import { formatDate, formatMoney } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadOpportunities, type OpportunityListItem } from "@/lib/crm/data";
import { openPipelineByStage, organisationLabel } from "@/lib/crm/reports";
import { CurrencyTotals } from "../currency-totals";

export const metadata = { title: "Pipeline" };

type Params = Record<string, string | string[] | undefined>;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const companyParam = Array.isArray(sp.company) ? sp.company[0] : sp.company;
  const company = ctx.companies.some((c) => c.id === companyParam) ? (companyParam as string) : "";

  let items: OpportunityListItem[];
  try {
    items = await loadOpportunities(ctx);
  } catch (e) {
    console.error("[crm] pipeline load failed", e);
    return (
      <div className="space-y-4">
        <Header />
        <Alert variant="destructive">Could not load the pipeline. Reload the page; if it keeps happening, tell an administrator.</Alert>
      </div>
    );
  }

  const open = items.filter((i) => (!company || i.opp.company_id === company) && i.opp.stage !== "won" && i.opp.stage !== "lost");
  const summary = openPipelineByStage(open.map((i) => ({ ...i.opp, value: i.value })));
  const byStage = (stage: string) => open.filter((i) => i.opp.stage === stage).sort((a, b) => (a.nextFollowUp?.due_at ?? "9999").localeCompare(b.nextFollowUp?.due_at ?? "9999"));
  const held = byStage("on_hold");
  const heldSummary = summary.find((s) => s.stage === "on_hold");

  return (
    <div className="space-y-6">
      <Header />

      {ctx.companies.length > 1 ? (
        <form method="get" action="/sales/pipeline" className="flex flex-wrap items-end gap-2" aria-label="Filter pipeline">
          <div className="space-y-1.5">
            <label htmlFor="p-company" className="text-sm font-medium leading-none">Company</label>
            <Select id="p-company" name="company" defaultValue={company} className="w-60">
              <option value="">All companies</option>
              {ctx.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <Button type="submit" size="sm">Apply</Button>
          {company ? <Link href="/sales/pipeline" className={buttonVariants({ variant: "ghost", size: "sm" })}>Clear</Link> : null}
        </form>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="The pipeline is empty" description="Cards appear here as enquiries are recorded and move through the stages." action={<Link href="/sales/new" className={buttonVariants({ size: "sm" })}>New enquiry</Link>} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{open.length} open opportunities. Totals are per currency and are never added across currencies.</p>
          <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0" tabIndex={0} role="region" aria-label="Pipeline board, scroll sideways for more stages">
            <div className="flex gap-3 lg:min-w-max">
              {CRM_PIPELINE_STAGES.map((stage) => {
                const cards = byStage(stage);
                const s = summary.find((x) => x.stage === stage);
                return (
                  <section key={stage} aria-labelledby={`col-${stage}`} className="w-72 flex-none rounded-lg border border-border bg-secondary/30 p-2.5">
                    <header className="mb-2 px-1">
                      <h2 id={`col-${stage}`} className="flex items-center justify-between gap-2 text-sm font-semibold">
                        {crmStageLabel(stage)}
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums" aria-label={`${cards.length} opportunities`}>{cards.length}</span>
                      </h2>
                      <div className="mt-0.5 min-h-4 text-xs text-muted-foreground">
                        <CurrencyTotals totals={s?.totals ?? {}} unvalued={s?.unvalued ?? 0} emptyText="No value yet" />
                      </div>
                    </header>
                    {cards.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">Nothing in this stage</p>
                    ) : (
                      <ul className="space-y-2.5">
                        {cards.map((i) => (
                          <li key={i.opp.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                            <Link href={`/sales/opportunities/${i.opp.id}`} className="break-words text-sm font-medium leading-snug underline-offset-2 hover:underline">{i.opp.title}</Link>
                            <p className="mt-0.5 break-words text-xs text-muted-foreground">{organisationLabel(i)}</p>
                            <p className="mt-2 text-sm font-medium tabular-nums">{formatMoney(i.value, i.opp.currency)}</p>
                            <p className="text-xs text-muted-foreground">{i.opp.reference} · Owner {i.ownerName}{!company && ctx.companies.length > 1 ? ` · ${i.companyName}` : ""}</p>
                            <div className="mt-2 space-y-1 text-xs">
                              <div>{i.nextFollowUp ? <><span className="text-muted-foreground">Next: </span><DueText dueAt={i.nextFollowUp.due_at} /></> : <span className="font-medium text-amber-800 dark:text-amber-300">No next action planned</span>}</div>
                              {stage !== "new" ? <AvailabilityBadge state={i.availability} /> : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          </div>

          <section aria-labelledby="col-on_hold" className="rounded-lg border border-border bg-secondary/30 p-3">
            <h2 id="col-on_hold" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
              On hold <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums" aria-label={`${held.length} opportunities`}>{held.length}</span>
            </h2>
            {held.length > 0 ? <div className="mt-0.5 text-xs text-muted-foreground"><CurrencyTotals totals={heldSummary?.totals ?? {}} unvalued={heldSummary?.unvalued ?? 0} emptyText="No value yet" /></div> : null}
            {held.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">Nothing is on hold.</p>
            ) : (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {held.map((i) => (
                  <li key={i.opp.id} className="rounded-md border border-border bg-card p-2.5 text-sm">
                    <Link href={`/sales/opportunities/${i.opp.id}`} className="break-words font-medium underline-offset-2 hover:underline">{i.opp.title}</Link>
                    <p className="text-xs text-muted-foreground">{i.opp.reference} · {organisationLabel(i)} · {formatMoney(i.value, i.opp.currency)}</p>
                    <p className="text-xs">{i.opp.hold_review_date ? `Review on ${formatDate(i.opp.hold_review_date)}` : "No review date set"}{i.opp.hold_reason ? ` · ${i.opp.hold_reason}` : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Move an opportunity between stages on its own page. Won and lost opportunities are under <Link href="/sales/opportunities?status=closed" className="underline-offset-2 hover:underline">Opportunities</Link>.
          </p>
        </>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Pipeline</h1>
      <p className="text-muted-foreground">Open opportunities by stage.</p>
    </div>
  );
}
