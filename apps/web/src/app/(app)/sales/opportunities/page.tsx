import Link from "next/link";
import { cn } from "@/lib/utils";
import { listTable } from "@/components/workspace/list-table";
import { CRM_STAGES, crmSourceLabel, crmStageLabel } from "@enginious-hr/domain";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AvailabilityBadge, DueText, StageBadge } from "@/components/sales/badges";
import { formatDate, formatMoney } from "@/components/sales/format";
import { QuickAddEnquiry } from "@/components/sales/quick-add-enquiry";
import { ColumnsMenu } from "@/components/workspace/columns-menu";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { MoreMenu } from "@/components/workspace/more-menu";
import { PanelLink } from "@/components/workspace/panel-link";
import { SortHead } from "@/components/workspace/sort-head";
import { LoadError } from "@/components/workspace/states";
import { ViewSwitch } from "@/components/workspace/view-switch";
import { firstParam, nextSort, parseColumns, parseRecordId, parseSort, parseView, sortToParam, withParams } from "@/components/workspace/url-state";
import { getCrmContext } from "@/lib/crm/context";
import { loadOpportunities, type OpportunityListItem } from "@/lib/crm/data";
import {
  ENQUIRY_ALL_COLUMNS, ENQUIRY_COLUMNS, ENQUIRY_DEFAULT_COLUMNS, ENQUIRY_DEFAULT_SORT, ENQUIRY_SORT_KEYS, boardColumnFor, boardColumns, boardMoveTargets,
  installOrShowDate, sortEnquiries, type EnquiryColumn, type EnquirySortKey,
} from "@/lib/crm/enquiry-list";
import { filterOpportunities, openPipelineByStage, organisationLabel, type OppStatusFilter } from "@/lib/crm/reports";
import { canEditOpportunity } from "@enginious-hr/domain";
import { EnquirySidePanel } from "../_panel/enquiry-panel";
import { CurrencyTotals } from "../currency-totals";
import { EnquiryBoard, type BoardMeta } from "./enquiry-board";

export const metadata = { title: "Enquiries" };

const MAX_ROWS = 300;
const BASE = "/sales/opportunities";

type Params = Record<string, string | string[] | undefined>;

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getCrmContext();
  if (!ctx) return null;
  if (ctx.grants.length === 0) return null;

  // Anything that is not a known value is ignored rather than trusted from the URL.
  const view = parseView(firstParam(sp, "view"));
  const q = firstParam(sp, "q").slice(0, 100);
  const stage = CRM_STAGES.some((s) => s.id === firstParam(sp, "stage")) ? firstParam(sp, "stage") : "";
  const company = ctx.companies.some((c) => c.id === firstParam(sp, "company")) ? firstParam(sp, "company") : "";
  const ownerRaw = firstParam(sp, "mine") === "1" ? "me" : firstParam(sp, "owner");
  const owner = ownerRaw === "me" ? "me" : ctx.people.some((p) => p.id === ownerRaw) ? ownerRaw : "";
  const statusParam = firstParam(sp, "status");
  const status: OppStatusFilter = statusParam === "closed" || statusParam === "all" ? statusParam : "open";
  const sort = parseSort(firstParam(sp, "sort"), ENQUIRY_SORT_KEYS, ENQUIRY_DEFAULT_SORT);
  const multiCompany = ctx.companies.length > 1;
  const offered = ENQUIRY_ALL_COLUMNS.filter((c) => multiCompany || c !== "company");
  const cols = parseColumns(firstParam(sp, "cols"), offered, ENQUIRY_DEFAULT_COLUMNS);
  const openId = parseRecordId(firstParam(sp, "open"));
  const here = (patch: Record<string, string | null> = {}) => withParams(BASE, sp, patch);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Enquiries</h1>
      <div className="flex flex-wrap items-center gap-2">
        <MoreMenu label="Shared lists" items={[{ key: "clients", label: "Clients & contacts", href: "/sales/clients" }, { key: "proposals", label: "Proposals & quotes", href: "/sales/proposals" }]} />
        <QuickAddEnquiry />
      </div>
    </div>
  );

  let items: OpportunityListItem[];
  try {
    items = await loadOpportunities(ctx);
  } catch (e) {
    console.error("[crm] enquiry list load failed", e);
    return (
      <div className="space-y-4">
        {header}
        <LoadError what="the enquiries" retryHref={here()} />
      </div>
    );
  }

  const ownerFilter = owner === "me" ? ctx.userId : owner;
  const rows = filterOpportunities(items, { q, stage: view === "board" ? "" : stage, company, owner: ownerFilter, mine: false, status }, ctx.userId);
  const filterActive = !!(q || (view === "table" && stage) || company || owner || status !== "open");

  const filters: ToolbarFilter[] = [
    ...(view === "table" ? [{ name: "stage", label: "Stage", value: stage, options: [{ value: "", label: "Any stage" }, ...CRM_STAGES.map((s) => ({ value: s.id, label: s.label }))] }] : []),
    { name: "owner", label: "Owner", value: owner, options: [{ value: "", label: "Anyone" }, { value: "me", label: "Mine" }, ...ctx.people.filter((p) => p.id !== ctx.userId).map((p) => ({ value: p.id, label: p.name }))] },
    { name: "status", label: "Show", value: status === "open" ? "" : status, options: [{ value: "", label: "Open (includes on hold)" }, { value: "closed", label: "Won and lost" }, { value: "all", label: "Everything" }] },
    ...(multiCompany ? [{ name: "company", label: "Company", value: company, options: [{ value: "", label: "All companies" }, ...ctx.companies.map((c) => ({ value: c.id, label: c.name }))] }] : []),
  ];

  const toolbar = (
    <ListToolbar search={{ value: q, placeholder: "Search title, reference, agency or client" }} filters={filters} clearHref={here({ q: null, stage: null, owner: null, mine: null, status: null, company: null })}>
      <ViewSwitch current={view} tableHref={here({ view: null })} boardHref={here({ view: "board" })} boardLabel="Board" />
      {view === "table" ? <ColumnsMenu columns={ENQUIRY_COLUMNS.filter((c) => offered.includes(c.id))} selected={cols} defaults={ENQUIRY_DEFAULT_COLUMNS} /> : null}
    </ListToolbar>
  );

  const panel = openId ? <EnquirySidePanel openId={openId} closeHref={here({ open: null })} /> : null;

  if (items.length === 0) {
    return (
      <div className="space-y-5">
        {header}
        <EmptyState title="No enquiries yet" description="Add the first enquiry. Unknown dates, budget and scope are fine." />
        {panel}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      {toolbar}
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="Clear a filter or search for something else." action={<Link href={here({ q: null, stage: null, owner: null, mine: null, status: null, company: null })} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : view === "board" ? (
        <BoardView rows={rows} ctx={ctx} here={here} />
      ) : (
        <TableView rows={rows} total={items.length} cols={cols} sort={sort} here={here} openId={openId} filterActive={filterActive} />
      )}
      {panel}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------------------------

function BoardView({ rows, ctx, here }: { rows: OpportunityListItem[]; ctx: NonNullable<Awaited<ReturnType<typeof getCrmContext>>>; here: (patch?: Record<string, string | null>) => string }) {
  const byDue = (a: OpportunityListItem, b: OpportunityListItem) => (a.nextFollowUp?.due_at ?? "9999").localeCompare(b.nextFollowUp?.due_at ?? "9999");
  const open = rows.filter((i) => i.opp.stage !== "won" && i.opp.stage !== "lost");
  const summary = openPipelineByStage(open.map((i) => ({ ...i.opp, value: i.value })));
  const columns = boardColumns().map((c) => {
    const s = summary.find((x) => x.stage === c.id);
    return { ...c, hint: s && s.count > 0 ? <CurrencyTotals totals={s.totals} unvalued={s.unvalued} emptyText="No value yet" /> : c.id === "won" || c.id === "lost" ? <span>Entered through its form</span> : undefined };
  });
  const meta: Record<string, BoardMeta> = {};
  const items = [...rows].sort(byDue).map((i) => {
    const canEdit = canEditOpportunity(ctx.grants, { companyId: i.opp.company_id, ownerId: i.opp.owner_id }, ctx.userId);
    const targets = boardMoveTargets({ stage: i.opp.stage, stageBeforeHold: i.opp.stage_before_hold, canEdit, ownerName: i.ownerName });
    meta[i.opp.id] = {
      stage: i.opp.stage, version: i.opp.version, stageBeforeHold: i.opp.stage_before_hold,
      valueText: formatMoney(i.value, i.opp.currency), hasValue: i.value != null, openFollowUps: i.openFollowUps,
    };
    return {
      id: i.opp.id,
      columnId: boardColumnFor(i.opp.stage),
      title: i.opp.title,
      ...targets,
      card: (
        <div>
          <PanelLink href={here({ open: i.opp.id })} className="break-words text-sm font-medium leading-snug underline-offset-2 hover:underline">{i.opp.title}</PanelLink>
          <p className="mt-0.5 break-words text-sm text-muted-foreground">{organisationLabel(i)}</p>
          <p className="mt-1 text-sm"><span className="text-muted-foreground">Owner </span>{i.ownerName}</p>
          <div className="mt-1.5 text-sm">
            {i.nextFollowUp ? (
              <>
                <p className="break-words font-medium">{i.nextFollowUp.title}</p>
                <DueText dueAt={i.nextFollowUp.due_at} />
              </>
            ) : i.opp.stage === "won" || i.opp.stage === "lost" ? (
              <span className="text-muted-foreground">Closed</span>
            ) : (
              <span className="font-medium text-amber-800 dark:text-amber-300">No next action planned</span>
            )}
          </div>
        </div>
      ),
    };
  });
  return <EnquiryBoard columns={columns} items={items} meta={meta} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------------------------------------------

const SORTABLE: Partial<Record<EnquiryColumn, EnquirySortKey>> = { enquiry: "enquiry", party: "party", owner: "owner", stage: "stage", due: "due", dates: "dates", value: "value", created: "created" };

function TableView({ rows, total, cols, sort, here, openId, filterActive }: {
  rows: OpportunityListItem[]; total: number; cols: EnquiryColumn[]; sort: { key: EnquirySortKey; dir: "asc" | "desc" };
  here: (patch?: Record<string, string | null>) => string; openId: string | null; filterActive: boolean;
}) {
  const sorted = sortEnquiries(rows, sort);
  const shown = sorted.slice(0, MAX_ROWS);
  const label = (c: EnquiryColumn) => ENQUIRY_COLUMNS.find((x) => x.id === c)?.label ?? c;
  return (
    <>
      <p className="text-sm text-muted-foreground" role="status">
        {rows.length} of {total} enquiries{filterActive ? " match" : ""}{rows.length > MAX_ROWS ? `, showing the first ${MAX_ROWS}. Narrow the filters to see the rest` : ""}
      </p>
      <Table className={cn("min-w-[48rem]", listTable)}>
        <caption className="sr-only">Enquiries, sorted by {sort.key} {sort.dir === "asc" ? "ascending" : "descending"}</caption>
        <TableHeader>
          <TableRow>
            {cols.map((c) => {
              const key = SORTABLE[c];
              return key ? (
                <SortHead key={c} label={label(c)} active={sort.key === key} dir={sort.dir} href={here({ sort: sortToParam(nextSort(sort, key)) })} className={c === "value" ? "text-right" : undefined} />
              ) : (
                <TableHead key={c} scope="col">{label(c)}</TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((i) => (
            <TableRow key={i.opp.id} className={`align-top ${openId === i.opp.id ? "bg-secondary/50" : ""}`} aria-selected={openId === i.opp.id || undefined}>
              {cols.map((c) => (
                <TableCell key={c} data-label={c === cols[0] ? undefined : label(c)} className={cellClass(c)}>
                  <Cell column={c} item={i} href={here({ open: i.opp.id })} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function cellClass(c: EnquiryColumn): string {
  switch (c) {
    case "enquiry": return "min-w-[11rem] max-w-[20rem]";
    case "party": return "min-w-[8rem]";
    case "next": return "min-w-[9rem]";
    case "value": return "whitespace-nowrap text-right tabular-nums";
    case "owner": case "created": case "company": return "whitespace-nowrap";
    default: return "";
  }
}

function Cell({ column, item: i, href }: { column: EnquiryColumn; item: OpportunityListItem; href: string }) {
  const closed = i.opp.stage === "won" || i.opp.stage === "lost";
  switch (column) {
    case "enquiry":
      return (
        <>
          <PanelLink href={href} className="break-words font-medium underline-offset-2 hover:underline">{i.opp.title}</PanelLink>
          <div className="mt-0.5 font-mono text-sm text-muted-foreground">{i.opp.reference}</div>
        </>
      );
    case "party": return <span className="break-words">{i.agency || i.client ? organisationLabel(i) : <span className="text-muted-foreground">None recorded</span>}</span>;
    case "owner": return <>{i.ownerName}</>;
    case "stage": return <StageBadge stage={i.opp.stage} />;
    case "next": return i.nextFollowUp ? <span className="break-words">{i.nextFollowUp.title}</span> : <span className="text-muted-foreground">{closed ? `Closed: ${crmStageLabel(i.opp.stage).toLowerCase()}` : i.opp.stage === "on_hold" ? "On hold" : "None planned"}</span>;
    case "due": return i.nextFollowUp ? <DueText dueAt={i.nextFollowUp.due_at} className="whitespace-normal" /> : <span className="text-muted-foreground">—</span>;
    case "dates": {
      const d = installOrShowDate(i.opp);
      return d ? <span className="whitespace-nowrap">{formatDate(d)}<span className="block text-sm text-muted-foreground">{i.opp.install_start ? "Installation" : "Show"}</span></span> : <span className="text-muted-foreground">—</span>;
    }
    case "value": return <>{formatMoney(i.value, i.opp.currency)}</>;
    case "source": return <>{crmSourceLabel(i.opp.source)}</>;
    case "availability": return closed ? <span className="text-muted-foreground">—</span> : <AvailabilityBadge state={i.availability} />;
    case "created": return <>{formatDate(i.opp.created_at)}</>;
    case "company": return <>{i.companyName}</>;
  }
}
