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
import { ClickableRow } from "@/components/workspace/clickable-row";
import { ColumnsMenu } from "@/components/workspace/columns-menu";
import { RememberList } from "@/components/workspace/list-memory";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { MoreMenu } from "@/components/workspace/more-menu";
import { PanelLink } from "@/components/workspace/panel-link";
import { SortHead } from "@/components/workspace/sort-head";
import { LoadError } from "@/components/workspace/states";
import { ViewSwitch } from "@/components/workspace/view-switch";
import { firstParam, nextSort, parseColumns, parseRecordId, parseSort, parseView, sortToParam, withParams } from "@/components/workspace/url-state";
import { getCrmContext } from "@/lib/crm/context";
import { loadEnquiryList, type EnquiryList, type EnquiryListItem, type StageSummary } from "@/lib/crm/enquiry-list-data";
import {
  ENQUIRY_ALL_COLUMNS, ENQUIRY_COLUMNS, ENQUIRY_DEFAULT_COLUMNS, ENQUIRY_DEFAULT_SORT, ENQUIRY_SORT_KEYS, boardColumnFor, boardColumns, boardMoveTargets, ENQUIRY_NEEDS, parseNeed,
  installOrShowDate, type EnquiryColumn, type EnquirySortKey,
} from "@/lib/crm/enquiry-list";
import { organisationLabel, type OppStatusFilter } from "@/lib/crm/reports";
import { canEditOpportunity } from "@enginious-hr/domain";
import { EnquirySidePanel } from "../_panel/enquiry-panel";
import { loadMyOpenHandovers } from "@/lib/crm/handover-attention-data";
import { CurrencyTotals } from "../currency-totals";
import type { BoardColumn } from "@/components/workspace/board";
import { EnquiryBoard, type BoardMeta } from "./enquiry-board";

export const metadata = { title: "Enquiries" };

/** Rows on one page of the table, and cards shown per lane of the board. The counts beside them always cover every match. */
const PAGE_SIZE = 100;
const CARDS_PER_LANE = 25;
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
  const need = parseNeed(firstParam(sp, "need"));
  // "My won enquiries whose handover is not accepted yet": its own view (mine, Won), whatever the other filters say.
  const handoverView = firstParam(sp, "need") === "handover";
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

  // ONE bounded read: the search, the filters, the sort and every count are done in the database, across everything the person may see, and only one page of the
  // table (or the first cards of each board lane) comes back. An old enquiry is found by its reference as surely as a new one, and no count is the length of a page.
  const ownerFilter = owner === "me" ? ctx.userId : owner;
  const pageNo = Math.max(1, Math.min(100000, Number.parseInt(firstParam(sp, "page"), 10) || 1));
  // "My won: handover open" is its own view: my won enquiries without an accepted handover, in the chosen company. The other filters do not apply to it (the chip
  // link clears them), so its count and its rows are always the same set. A failed check is said, never shown as none.
  const myHandovers = await loadMyOpenHandovers(ctx);
  const handoverIds = myHandovers.status === "ok" ? myHandovers.rows.filter((r) => !company || r.companyId === company).map((r) => r.id) : [];
  const base = handoverView
    ? { q: "", company, owner: ctx.userId, stage: "won", status: "all" as const, need: "" as const, ids: handoverIds }
    : { q, company, owner: ownerFilter, stage: view === "board" ? "" : stage, status, need };
  let list: EnquiryList;
  try {
    list = await loadEnquiryList(ctx, { ...base, sort, limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE, ...(view === "board" ? { perStage: CARDS_PER_LANE } : {}) });
  } catch (e) {
    console.error("[crm] enquiry list load failed", e);
    return (
      <div className="space-y-4">
        {header}
        <LoadError what="the enquiries" retryHref={here()} />
      </div>
    );
  }
  const rows = list.items;
  const total = list.total;
  const counts = list.needs;
  const filterActive = !!(q || (view === "table" && stage) || company || owner || status !== "open" || need || handoverView);
  // "My open enquiries" is exactly: mine, open, any stage, no other quick filter. It is shown as chosen only then, and choosing it sets exactly that.
  const myOpen = owner === "me" && status === "open" && !handoverView && !need && !(view === "table" && stage);
  const chip = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium";
  const on = "border-primary bg-primary/10 text-foreground";
  const off = "border-border text-muted-foreground hover:text-foreground";
  const quick = (
    <nav aria-label="Quick filters" className="flex flex-wrap items-center gap-2">
      <Link href={here(myOpen ? { owner: null, mine: null, page: null, open: null } : { owner: "me", mine: null, status: null, stage: null, need: null, page: null, open: null })} scroll={false} aria-current={myOpen ? "true" : undefined}
        className={cn(chip, myOpen ? on : off)}>My open enquiries</Link>
      {/* These count, and narrow, what the search and the Stage, Owner, Show and Company filters match. They are not offered inside the handover view, whose rows are all won. */}
      {handoverView ? null : ENQUIRY_NEEDS.map((n) => (
        <Link key={n.id} href={here({ need: need === n.id ? null : n.id, page: null, open: null })} scroll={false} aria-current={need === n.id ? "true" : undefined} className={cn(chip, need === n.id ? on : off)}>
          <span className="os-dot" data-tone={counts[n.id] > 0 ? n.tone : "quiet"} aria-hidden />{n.label}<span className="tabular-nums text-foreground">{counts[n.id]}</span>
        </Link>
      ))}
      {myHandovers.status === "error" ? <span className="text-sm text-destructive" role="alert">Could not check your won handovers.</span>
        : myHandovers.status === "ok" && (handoverIds.length > 0 || handoverView) ? (
          <Link href={here(handoverView ? { need: null, page: null, open: null } : { need: "handover", q: null, stage: null, owner: null, mine: null, status: null, page: null, open: null })} scroll={false}
            aria-current={handoverView ? "true" : undefined} className={cn(chip, handoverView ? on : off)}>
            <span className="os-dot" data-tone={handoverIds.length > 0 ? "amber" : "quiet"} aria-hidden />My won: handover open<span className="tabular-nums text-foreground">{handoverIds.length}</span>
          </Link>
        ) : null}
    </nav>
  );

  const filters: ToolbarFilter[] = [
    ...(view === "table" ? [{ name: "stage", label: "Stage", value: stage, options: [{ value: "", label: "Any stage" }, ...CRM_STAGES.map((s) => ({ value: s.id, label: s.label }))] }] : []),
    { name: "owner", label: "Owner", value: owner, options: [{ value: "", label: "Anyone" }, { value: "me", label: "Mine" }, ...ctx.people.filter((p) => p.id !== ctx.userId).map((p) => ({ value: p.id, label: p.name }))] },
    { name: "status", label: "Show", secondary: true, value: status === "open" ? "" : status, options: [{ value: "", label: "Open (includes on hold)" }, { value: "closed", label: "Won and lost" }, { value: "all", label: "Everything" }] },
    ...(multiCompany ? [{ name: "company", label: "Company", secondary: true, value: company, options: [{ value: "", label: "All companies" }, ...ctx.companies.map((c) => ({ value: c.id, label: c.name }))] }] : []),
  ];

  const toolbar = (
    <ListToolbar search={{ value: q, placeholder: "Search title, reference, agency or client" }} filters={filters} clearHref={here({ q: null, stage: null, owner: null, mine: null, status: null, company: null, need: null })}>
      <ViewSwitch current={view} tableHref={here({ view: null })} boardHref={here({ view: "board" })} boardLabel="Board" />
      {view === "table" ? <ColumnsMenu columns={ENQUIRY_COLUMNS.filter((c) => offered.includes(c.id))} selected={cols} defaults={ENQUIRY_DEFAULT_COLUMNS} /> : null}
    </ListToolbar>
  );

  const panel = openId ? <EnquirySidePanel openId={openId} closeHref={here({ open: null })} /> : null;

  if (total === 0 && !handoverView) {
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
      <RememberList section="enquiries" />
      {header}
      {toolbar}
      {quick}
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="Clear a filter or search for something else." action={<Link href={here({ q: null, stage: null, owner: null, mine: null, status: null, company: null, need: null })} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : view === "board" ? (
        <BoardView rows={rows} stages={list.stages} ctx={ctx} here={here} />
      ) : (
        <TableView rows={rows} matched={list.matched} total={total} pageNo={pageNo} cols={cols} sort={sort} here={here} openId={openId} filterActive={filterActive} />
      )}
      {panel}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------------------------

function BoardView({ rows, stages, ctx, here }: { rows: EnquiryListItem[]; stages: StageSummary[]; ctx: NonNullable<Awaited<ReturnType<typeof getCrmContext>>>; here: (patch?: Record<string, string | null>) => string }) {
  const byDue = (a: EnquiryListItem, b: EnquiryListItem) => (a.nextFollowUp?.due_at ?? "9999").localeCompare(b.nextFollowUp?.due_at ?? "9999");
  // The lane's count and per-currency totals cover EVERY matching enquiry of that stage (from the database), not only the cards on the page.
  const columns = boardColumns().map((c) => {
    const s = stages.find((x) => boardColumnFor(x.stage) === c.id && x.stage === c.id);
    return {
      ...c, tone: BOARD_TONE[c.id], total: s?.count ?? 0,
      hint: c.id === "won" || c.id === "lost" ? <span>Entered through its form</span> : s && s.count > 0 ? <CurrencyTotals totals={s.totals} unvalued={s.unvalued} emptyText="No value yet" /> : undefined,
    };
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
      href: here({ open: i.opp.id }),
      panel: true,
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
              <span className="font-medium text-[hsl(var(--os-amber))]">No next action planned</span>
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

const BOARD_TONE: Record<string, BoardColumn["tone"]> = { new: undefined, qualified: "cyan", proposal_prep: "blue", proposal_sent: "blue", estimate_sent: "blue", quote_sent: "blue", negotiation: "cyan", on_hold: "amber", won: "green", lost: undefined };
const SORTABLE: Partial<Record<EnquiryColumn, EnquirySortKey>> = { enquiry: "enquiry", party: "party", owner: "owner", stage: "stage", due: "due", dates: "dates", value: "value", created: "created" };

function TableView({ rows, matched, total, pageNo, cols, sort, here, openId, filterActive }: {
  rows: EnquiryListItem[]; matched: number; total: number; pageNo: number; cols: EnquiryColumn[]; sort: { key: EnquirySortKey; dir: "asc" | "desc" };
  here: (patch?: Record<string, string | null>) => string; openId: string | null; filterActive: boolean;
}) {
  // The rows arrive sorted and paged by the database; `matched` is every enquiry that matches, `total` every enquiry the person may see.
  const shown = rows;
  const first = (pageNo - 1) * PAGE_SIZE + 1;
  const last = first + rows.length - 1;
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const label = (c: EnquiryColumn) => ENQUIRY_COLUMNS.find((x) => x.id === c)?.label ?? c;
  const pager = pages > 1 ? (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-2 text-sm">
      {pageNo > 1 ? <Link href={here({ page: pageNo - 1 === 1 ? null : String(pageNo - 1), open: null })} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Previous</Link> : null}
      <span className="text-muted-foreground">Page {Math.min(pageNo, pages)} of {pages}</span>
      {pageNo < pages ? <Link href={here({ page: String(pageNo + 1), open: null })} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Next</Link> : null}
    </nav>
  ) : null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" role="status">
          {matched} of {total} enquiries{filterActive ? " match" : ""}{matched > rows.length ? `. Showing ${rows.length === 0 ? "none on this page" : `${first} to ${last}`}` : ""}
        </p>
        {pager}
      </div>
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
            <ClickableRow key={i.opp.id} href={here({ open: i.opp.id })} panel selected={openId === i.opp.id} className="align-top" aria-selected={openId === i.opp.id || undefined}>
              {cols.map((c) => (
                <TableCell key={c} data-label={c === cols[0] ? undefined : label(c)} className={cellClass(c)}>
                  <Cell column={c} item={i} href={here({ open: i.opp.id })} />
                </TableCell>
              ))}
            </ClickableRow>
          ))}
        </TableBody>
      </Table>
      {pager}
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

function Cell({ column, item: i, href }: { column: EnquiryColumn; item: EnquiryListItem; href: string }) {
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
