import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { listTable } from "@/components/workspace/list-table";
import { CRM_STAGES, CRM_TIME_ZONE, crmSourceLabel, crmStageLabel, isCrmActive } from "@enginious-hr/domain";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AvailabilityBadge, DueText, StageBadge } from "@/components/sales/badges";
import { CompanySwitch } from "@/components/sales/company-switch";
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
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext } from "@/lib/crm/context";
import { loadEnquiryList, loadEnquiryScope, loadStageEvidence, type EnquiryList, type EnquiryListItem, type StageSummary } from "@/lib/crm/enquiry-list-data";
import {
  ENQUIRY_ALL_COLUMNS, ENQUIRY_COLUMNS, ENQUIRY_DEFAULT_COLUMNS, ENQUIRY_DEFAULT_SORT, ENQUIRY_DEFAULT_VIEW, ENQUIRY_SORT_KEYS, boardColumnFor, boardColumns, boardMoveTargets, ENQUIRY_NEEDS, parseNeed,
  enquiryCountSentence, enquiryFilterChips, enquiryRowAction, installOrShowDate, type EnquiryColumn, type EnquiryScopeCounts, type EnquirySortKey, type StageEvidence,
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
/** The address parameters that are filters. "Clear filters" removes exactly these; the company, the view, the sort and the columns stay. */
const FILTER_KEYS = ["q", "stage", "owner", "mine", "status", "need"] as const;
const cleared = (keys: readonly string[]): Record<string, null> => Object.fromEntries([...keys, "page", "open"].map((k) => [k, null]));

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
  // The company. `?company=<id>` (as in every saved link) shows that company; `?company=all` shows every company the person has; with neither, the list opens
  // in the active Sales company (the one used last, then the person's own). With several companies and no reliable default it shows them all: nothing is
  // assumed and nothing is hidden. A company the person has no Sales access to is ignored, and the database only returns what they may see in any case.
  const multiCompany = ctx.companies.length > 1;
  const active = await pickSalesCompany(ctx, firstParam(sp, "company"));
  const allCompanies = multiCompany && (firstParam(sp, "company") === "all" || !active.company);
  const company = allCompanies ? "" : (active.company?.id ?? "");
  const companyName = company ? (active.company?.name ?? null) : null;
  const ownerRaw = firstParam(sp, "mine") === "1" ? "me" : firstParam(sp, "owner");
  const owner = ownerRaw === "me" ? "me" : ctx.people.some((p) => p.id === ownerRaw) ? ownerRaw : "";
  const statusParam = firstParam(sp, "status");
  const status: OppStatusFilter = statusParam === "closed" || statusParam === "all" ? statusParam : "open";
  const sort = parseSort(firstParam(sp, "sort"), ENQUIRY_SORT_KEYS, ENQUIRY_DEFAULT_SORT);
  const offered = ENQUIRY_ALL_COLUMNS.filter((c) => multiCompany || c !== "company");
  const cols = parseColumns(firstParam(sp, "cols"), offered, ENQUIRY_DEFAULT_COLUMNS);
  const need = parseNeed(firstParam(sp, "need"));
  // "My won enquiries whose handover is not accepted yet": its own view (mine, Won), whatever the other filters say.
  const handoverView = firstParam(sp, "need") === "handover";
  const openId = parseRecordId(firstParam(sp, "open"));
  const here = (patch: Record<string, string | null> = {}) => withParams(BASE, sp, patch);

  const header = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Enquiries</h1>
        <div className="flex flex-wrap items-center gap-2">
          <MoreMenu label="Shared lists" items={[{ key: "clients", label: "Clients & contacts", href: "/sales/clients" }, { key: "proposals", label: "Proposals & quotes", href: "/sales/proposals" }]} />
          {/* Add enquiry starts in the company this list is showing; with every company shown it uses the active company, or asks. */}
          <QuickAddEnquiry companyId={company || null} />
        </div>
      </div>
      <CompanySwitch
        companies={ctx.companies} current={company || null} from={company ? active.from : undefined}
        hrefFor={(id) => here({ company: id, page: null, open: null })}
        all={multiCompany ? { href: here({ company: "all", page: null, open: null }), active: allCompanies } : undefined}
      />
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
  // Anything beyond the company and Show narrows the list; the line above the list then says "match your filters" and the chips say which.
  const narrowed = !handoverView && !!(q || (view === "table" && stage) || owner || need);
  // Why the rest is not shown, exactly: only asked for when a company is chosen among several, something is hidden and no other filter is on. One more
  // count-only read; if it fails the line says what the two counts above already prove.
  const scope: EnquiryScopeCounts | null = company && multiCompany && !narrowed && !handoverView && total > list.matched ? await loadEnquiryScope(ctx, company) : null;
  const sentence = enquiryCountSentence({ matched: list.matched, total, status, companyName, multiCompany, narrowed, handover: handoverView, scope });
  const chips = enquiryFilterChips({
    q, stageLabel: view === "table" && stage ? crmStageLabel(stage) : "", ownerLabel: owner === "me" ? "mine" : owner ? ctx.personName(owner) : "", status, need, handover: handoverView,
  });
  const clearHref = here(cleared(FILTER_KEYS));
  const showsEverything = status === "all" && !company && chips.length <= 1;
  const showAllHref = here({ ...cleared(FILTER_KEYS), status: "all", company: multiCompany ? "all" : null });
  // "My open enquiries" is exactly: mine, open, any stage, no other quick filter. It is shown as chosen only then, and choosing it sets exactly that.
  const myOpen = owner === "me" && status === "open" && !handoverView && !need && !(view === "table" && stage);
  const chip = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium";
  const on = "border-primary bg-primary/10 text-foreground";
  const off = "border-border text-muted-foreground hover:text-foreground";
  const quick = (
    <nav aria-label="Quick filters" className="flex flex-wrap items-center gap-2">
      <Link href={here(myOpen ? { owner: null, mine: null, page: null, open: null } : { owner: "me", mine: null, status: null, stage: null, need: null, page: null, open: null })} scroll={false} aria-current={myOpen ? "true" : undefined}
        className={cn(chip, myOpen ? on : off)}>My open enquiries</Link>
      {/* These count, and narrow, what the search and the Stage, Owner, Show and Company choices match. They are not offered inside the handover view, whose rows are all won. */}
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

  // The company is chosen above the list (it is where the list is, not a filter), so the toolbar holds the three filters only and none is tucked away.
  const filters: ToolbarFilter[] = [
    ...(view === "table" ? [{ name: "stage", label: "Stage", value: stage, options: [{ value: "", label: "Any stage" }, ...CRM_STAGES.map((s) => ({ value: s.id, label: s.label }))] }] : []),
    { name: "owner", label: "Owner", value: owner, options: [{ value: "", label: "Anyone" }, { value: "me", label: "Mine" }, ...ctx.people.filter((p) => p.id !== ctx.userId).map((p) => ({ value: p.id, label: p.name }))] },
    { name: "status", label: "Show", value: status === "open" ? "" : status, options: [{ value: "", label: "Open (includes on hold)" }, { value: "closed", label: "Won and lost" }, { value: "all", label: "Everything" }] },
  ];

  const toolbar = (
    <ListToolbar search={{ value: q, placeholder: "Search title, reference, agency or client" }} filters={filters} resetKeys={["page"]}>
      <ViewSwitch current={view} tableHref={here({ view: null })} boardHref={here({ view: "board" })} boardLabel="Board" />
      {view === "table" ? <ColumnsMenu columns={ENQUIRY_COLUMNS.filter((c) => offered.includes(c.id))} selected={cols} defaults={ENQUIRY_DEFAULT_COLUMNS} /> : null}
    </ListToolbar>
  );

  // What the list is showing and why the rest is not, then the filters in use (each removable) and the one way back to the default.
  const first = (pageNo - 1) * PAGE_SIZE + 1;
  const result = (
    <div className="space-y-2" data-testid="enquiry-result">
      <p className="text-sm" role="status">
        <span className="font-medium">{sentence.shown}</span>
        {sentence.hidden ? <>{" "}<span className="text-muted-foreground">{sentence.hidden}</span></> : null}
        {view === "table" && list.matched > rows.length ? <>{" "}<span className="text-muted-foreground">{rows.length === 0 ? "None on this page." : `Rows ${first} to ${first + rows.length - 1} are on this page.`}</span></> : null}
        {sentence.hidden && !showsEverything ? <>{" "}<Link href={showAllHref} scroll={false} className="font-medium underline underline-offset-2">Show all</Link></> : null}
        <InfoHint label="what is counted" className="ml-1">
          Open means not won and not lost (on hold is open). The counts cover every enquiry you can see, not only the rows on this page. Choosing a stage shows that stage whatever Show says.
        </InfoHint>
      </p>
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ul className="flex flex-wrap items-center gap-2" aria-label="Filters in use">
            {chips.map((c) => (
              <li key={c.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[hsl(var(--primary)/0.45)] bg-[hsl(var(--primary)/0.14)] py-0.5 pl-2.5 pr-1 text-[13px] font-medium">
                <span className="max-w-[16rem] truncate" title={c.label}>{c.label}</span>
                <Link href={here(cleared(c.clear))} scroll={false} aria-label={`Remove filter: ${c.label}`} className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-3 w-3" aria-hidden /></Link>
              </li>
            ))}
          </ul>
          <Link href={clearHref} scroll={false} className="text-sm font-medium underline underline-offset-2">Clear filters</Link>
          <span className="text-sm text-muted-foreground">Back to {ENQUIRY_DEFAULT_VIEW}{companyName ? ` in ${companyName}` : ""}.</span>
        </div>
      ) : null}
    </div>
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

  // The board's cards that can move: their recorded evidence (sent proposal, sent estimate, Zoho quote reference), so a move the database would refuse says
  // what is missing before it is sent. Null when it could not be read: the board then sends the move and shows the database's answer.
  let evidence: Record<string, StageEvidence> | null = null;
  if (view === "board" && rows.length > 0) {
    const movable = rows.filter((i) => isCrmActive(i.opp.stage) && canEditOpportunity(ctx.grants, { companyId: i.opp.company_id, ownerId: i.opp.owner_id }, ctx.userId)).map((i) => i.opp.id);
    evidence = await loadStageEvidence(movable);
  }

  return (
    <div className="space-y-4">
      <RememberList section="enquiries" />
      {header}
      {toolbar}
      {quick}
      {result}
      {rows.length === 0 ? (
        <EmptyState
          title={chips.length > 0 ? "Nothing matches" : sentence.shown.replace(/\.$/, "")}
          description={chips.length > 0 ? "Remove a filter above, or clear them all." : sentence.hidden ?? "Add an enquiry to start."}
          action={chips.length > 0 ? undefined : sentence.hidden && !showsEverything ? <Link href={showAllHref} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Show all</Link> : undefined}
        />
      ) : view === "board" ? (
        <BoardView rows={rows} stages={list.stages} ctx={ctx} here={here} evidence={evidence} />
      ) : (
        <TableView rows={rows} matched={list.matched} pageNo={pageNo} cols={cols} sort={sort} here={here} openId={openId} />
      )}
      {panel}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------------------------

function BoardView({ rows, stages, ctx, here, evidence }: { rows: EnquiryListItem[]; stages: StageSummary[]; ctx: NonNullable<Awaited<ReturnType<typeof getCrmContext>>>; here: (patch?: Record<string, string | null>) => string; evidence: Record<string, StageEvidence> | null }) {
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
      stage: i.opp.stage, version: i.opp.version, stageBeforeHold: i.opp.stage_before_hold, timeZone: i.timeZone ?? CRM_TIME_ZONE,
      valueText: formatMoney(i.value, i.opp.currency), hasValue: i.value != null, openFollowUps: i.openFollowUps,
      evidence: evidence?.[i.opp.id] ?? null,
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
          <div className="mt-1.5 text-sm"><NextAction item={i} /></div>
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
// The Next action column sorts by when that action is due (the due time is inside the cell).
const SORTABLE: Partial<Record<EnquiryColumn, EnquirySortKey>> = { enquiry: "enquiry", party: "party", owner: "owner", stage: "stage", next: "due", due: "due", dates: "dates", value: "value", created: "created" };

/**
 * The next action and exactly when it is due, in one place. Late is red and due today is amber, each with the words; a working enquiry with no next action
 * says so in amber, because nothing will remind anyone about it.
 */
function NextAction({ item: i }: { item: EnquiryListItem }) {
  if (i.nextFollowUp) {
    return (
      <>
        <span className="block break-words font-medium" title={i.nextFollowUp.title}>{i.nextFollowUp.title}</span>
        <DueText dueAt={i.nextFollowUp.due_at} zone={i.timeZone ?? CRM_TIME_ZONE} className="block whitespace-normal text-sm" />
      </>
    );
  }
  if (i.opp.stage === "won" || i.opp.stage === "lost") return <span className="text-muted-foreground">Closed: {crmStageLabel(i.opp.stage).toLowerCase()}</span>;
  if (i.opp.stage === "on_hold") return <span className="text-muted-foreground">On hold</span>;
  return <span className="font-medium text-[hsl(var(--os-amber))]">No next action planned</span>;
}

function TableView({ rows, matched, pageNo, cols, sort, here, openId }: {
  rows: EnquiryListItem[]; matched: number; pageNo: number; cols: EnquiryColumn[]; sort: { key: EnquirySortKey; dir: "asc" | "desc" };
  here: (patch?: Record<string, string | null>) => string; openId: string | null;
}) {
  // The rows arrive sorted and paged by the database; `matched` is every enquiry that matches.
  const shown = rows;
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
      {pager}
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
            <TableHead scope="col"><span className="sr-only">Next step</span></TableHead>
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
              <TableCell className="whitespace-nowrap text-right"><RowActionLink item={i} /></TableCell>
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
    case "next": return "min-w-[11rem] max-w-[18rem]";
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
    case "next": return <NextAction item={i} />;
    case "due": return i.nextFollowUp ? <DueText dueAt={i.nextFollowUp.due_at} zone={i.timeZone ?? CRM_TIME_ZONE} className="whitespace-normal" /> : <span className="text-muted-foreground">—</span>;
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

/**
 * The one action of a row: the enquiry's own page, opened at its next step. It is a link and changes nothing. The row (and the title) still open the side panel.
 */
function RowActionLink({ item: i }: { item: EnquiryListItem }) {
  const a = enquiryRowAction(i);
  return (
    <Link
      href={`${BASE}/${i.opp.id}${a.tab ? `?tab=${a.tab}` : ""}`} title={`${a.label}: opens ${i.opp.title}`}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), a.tone === "red" && "border-[hsl(var(--os-red)/0.6)] text-[hsl(var(--os-red))]", a.tone === "amber" && "border-[hsl(var(--os-amber)/0.6)] text-[hsl(var(--os-amber))]")}
    >
      {a.label}<span className="sr-only">: {i.opp.title}</span>
    </Link>
  );
}
