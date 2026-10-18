import Link from "next/link";
import { Plus } from "lucide-react";
import { CRM_STAGES, crmStageLabel } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AvailabilityBadge, DueText, StageBadge } from "@/components/sales/badges";
import { formatMoney } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadOpportunities, type OpportunityListItem } from "@/lib/crm/data";
import { filterOpportunities, organisationLabel, type OppStatusFilter } from "@/lib/crm/reports";

export const metadata = { title: "Opportunities" };

const MAX_ROWS = 300;

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getCrmContext();
  if (!ctx) return null;

  // Anything that is not a known value is ignored rather than trusted from the URL.
  const q = first(sp.q).slice(0, 100);
  const stage = CRM_STAGES.some((s) => s.id === first(sp.stage)) ? first(sp.stage) : "";
  const company = ctx.companies.some((c) => c.id === first(sp.company)) ? first(sp.company) : "";
  const owner = ctx.people.some((p) => p.id === first(sp.owner)) ? first(sp.owner) : "";
  const mine = first(sp.mine) === "1";
  const statusParam = first(sp.status);
  const status: OppStatusFilter = statusParam === "closed" || statusParam === "all" ? statusParam : "open";

  let items: OpportunityListItem[];
  try {
    items = await loadOpportunities(ctx);
  } catch (e) {
    console.error("[crm] opportunity list load failed", e);
    return (
      <div className="space-y-4">
        <Header />
        <Alert variant="destructive">Could not load opportunities. Reload the page; if it keeps happening, tell an administrator.</Alert>
      </div>
    );
  }

  const rows = filterOpportunities(items, { q, stage, company, owner, mine, status }, ctx.userId);
  const shown = rows.slice(0, MAX_ROWS);
  const filtered = !!(q || stage || company || owner || mine || status !== "open");

  return (
    <div className="space-y-6">
      <Header />

      {/* A plain GET form: works without JavaScript and keeps the filters in the URL. */}
      <form method="get" action="/sales/opportunities" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Filter opportunities">
        <LabelledField id="f-q" label="Search" className="sm:col-span-2">
          <Input id="f-q" name="q" type="search" defaultValue={q} placeholder="Reference, title, agency or client" maxLength={100} />
        </LabelledField>
        <LabelledField id="f-status" label="Status">
          <Select id="f-status" name="status" defaultValue={status}>
            <option value="open">Open (includes on hold)</option>
            <option value="closed">Closed (won or lost)</option>
            <option value="all">All</option>
          </Select>
        </LabelledField>
        <LabelledField id="f-stage" label="Stage">
          <Select id="f-stage" name="stage" defaultValue={stage}>
            <option value="">Any stage</option>
            {CRM_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </LabelledField>
        {ctx.companies.length > 1 ? (
          <LabelledField id="f-company" label="Company">
            <Select id="f-company" name="company" defaultValue={company}>
              <option value="">All companies</option>
              {ctx.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </LabelledField>
        ) : null}
        <LabelledField id="f-owner" label="Owner">
          <Select id="f-owner" name="owner" defaultValue={owner}>
            <option value="">Anyone</option>
            {ctx.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </LabelledField>
        <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-1">
          <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={mine} /> Mine only</label>
          <Button type="submit" size="sm">Apply filters</Button>
          {filtered ? <Link href="/sales/opportunities" className={buttonVariants({ variant: "ghost", size: "sm" })}>Clear</Link> : null}
        </div>
      </form>
      <p className="-mt-3 text-sm text-muted-foreground">Choosing a stage overrides the status. Won and lost are under Closed.</p>

      {items.length === 0 ? (
        <EmptyState title="No opportunities yet" description="Record an enquiry with a few quick fields. Unknown dates, budget and scope are fine." action={<Link href="/sales/new" className={buttonVariants({ size: "sm" })}>New enquiry</Link>} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="Clear a filter or search for something else." action={<Link href="/sales/opportunities" className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground" role="status">
              {rows.length} of {items.length} opportunities{rows.length > MAX_ROWS ? `, showing the first ${MAX_ROWS}. Narrow the filters to see the rest` : ""}
            </p>
            <Table className="min-w-[52rem]">
              <caption className="sr-only">Opportunities</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Opportunity</TableHead>
                  <TableHead scope="col">Stage</TableHead>
                  <TableHead scope="col">Owner</TableHead>
                  <TableHead scope="col" className="text-right">Value</TableHead>
                  <TableHead scope="col">Next follow-up</TableHead>
                  <TableHead scope="col">Equipment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((i) => (
                  <TableRow key={i.opp.id} className="align-top">
                    <TableCell className="min-w-[14rem] max-w-[22rem]">
                      <Link href={`/sales/opportunities/${i.opp.id}`} className="break-words font-medium underline-offset-2 hover:underline">{i.opp.title}</Link>
                      <div className="mt-0.5 break-words text-sm text-muted-foreground">
                        <span className="font-mono">{i.opp.reference}</span> · {organisationLabel(i)}{ctx.companies.length > 1 ? ` · ${i.companyName}` : ""}
                      </div>
                    </TableCell>
                    <TableCell><StageBadge stage={i.opp.stage} /></TableCell>
                    <TableCell className="whitespace-nowrap">{i.ownerName}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(i.value, i.opp.currency)}</TableCell>
                    <TableCell className="min-w-[10rem]">
                      {i.nextFollowUp ? (
                        <>
                          <DueText dueAt={i.nextFollowUp.due_at} />
                          <div className="text-sm text-muted-foreground">{i.nextFollowUp.title}</div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{i.opp.stage === "won" || i.opp.stage === "lost" ? `Closed: ${crmStageLabel(i.opp.stage).toLowerCase()}` : "None planned"}</span>
                      )}
                    </TableCell>
                    <TableCell>{i.opp.stage === "won" || i.opp.stage === "lost" ? <span className="text-muted-foreground">—</span> : <AvailabilityBadge state={i.availability} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Opportunities</h1>
        <p className="text-muted-foreground">Every enquiry and opportunity you can see. Equipment availability is a dated check, not a reservation.</p>
      </div>
      <Link href="/sales/new" className={buttonVariants()}>
        <Plus className="h-4 w-4" aria-hidden />New enquiry
      </Link>
    </div>
  );
}

function LabelledField({ id, label, className, children }: { id: string; label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className ? `space-y-1.5 ${className}` : "space-y-1.5"}>
      <label htmlFor={id} className="text-sm font-medium leading-none">{label}</label>
      {children}
    </div>
  );
}
