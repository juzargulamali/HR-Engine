import { zoneOfCompanies } from "@/lib/crm/time-zone";
import Link from "next/link";
import { AlarmClock, Bell, CalendarClock, CalendarDays } from "lucide-react";
import { canActOnAccountFollowUp, canActOnFollowUp, isCrmActive } from "@enginious-hr/domain";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OsBadge } from "@/components/os/pills";
import { OsStatCard } from "@/components/os/stat-card";
import { PageHeader } from "@/components/projects/parts";
import { DueText } from "@/components/sales/badges";
import { CompanySwitch } from "@/components/sales/company-switch";
import { FollowUpRowActions } from "@/components/sales/follow-up-row-actions";
import { formatDate, formatDateTime, formatDue } from "@/components/sales/format";
import { HandoverAttention } from "@/components/sales/handover-attention";
import { OpsQuestionAttention } from "@/components/sales/ops-question-attention";
import { loadOpsQuestionNotices } from "@/lib/crm/ops-question-data";
import { QuickAddEnquiry } from "@/components/sales/quick-add-enquiry";
import { ClickableRow } from "@/components/workspace/clickable-row";
import { RememberList } from "@/components/workspace/list-memory";
import { listTable } from "@/components/workspace/list-table";
import { PanelLink } from "@/components/workspace/panel-link";
import { LoadError } from "@/components/workspace/states";
import { firstParam, parseRecordId, withParams } from "@/components/workspace/url-state";
import { getCrmContext } from "@/lib/crm/context";
import { loadFollowUps, loadMyReminders, loadOpportunities, type FollowUpListItem, type OpportunityListItem } from "@/lib/crm/data";
import { groupOpenFollowUps } from "@/lib/crm/follow-up-groups";
import { loadHandoverRows } from "@/lib/crm/handover-attention-data";
import { generateRemindersThrottled } from "@/lib/crm/reminders";
import { currentReminders } from "@/lib/crm/reminders-current";
import { attentionItems, type AttentionItem } from "@/lib/crm/reports";
import type { CrmReminderRow } from "@/types/crm";
import { cn } from "@/lib/utils";
import { EnquirySidePanel } from "../_panel/enquiry-panel";
import { MarkRemindersReadButton } from "../mark-reminders-read";
import { FocusRow } from "./focus-row";
import { followUpRowId } from "./row-id";

export const metadata = { title: "Follow-ups" };

const BASE = "/sales/follow-ups";
const KIND_LABEL: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", proposal: "Proposal work", other: "Other" };
const REMINDER_LABEL: Record<CrmReminderRow["kind"], string> = {
  follow_up_due: "Follow-up due",
  follow_up_overdue: "Follow-up overdue",
  hold_review_due: "Hold review due",
  no_next_action: "No next action",
};
const ATTENTION_LABEL: Record<string, string> = { hold_review: "Hold review due", no_next_action: "No next action", no_first_response: "No first response" };
const MAX_ATTENTION = 8;

// The three groups of the to-do list, in the order they are worked. `view=<group>` narrows the list to one (My Day links here with it).
const GROUPS = ["overdue", "today", "upcoming"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_LABEL: Record<Group, string> = { overdue: "Overdue", today: "Today", upcoming: "Upcoming" };
const ONLY_NOTE: Record<Group, string> = { overdue: "Showing only what is overdue.", today: "Showing only what is due today.", upcoming: "Showing only what is upcoming." };
const NOTHING: Record<Group, string> = { overdue: "Nothing is overdue", today: "Nothing is due today", upcoming: "Nothing is upcoming" };
const MINE_HINT = "This shows follow-ups assigned to you. Choose Everyone to see the whole team's.";

type Params = Record<string, string | string[] | undefined>;

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getCrmContext();
  if (!ctx) return null;
  if (ctx.grants.length === 0) return null;
  const view = firstParam(sp, "view");
  const showDone = view === "done";
  // My Day and the summary cards link here with ?view=overdue | today | upcoming: the to-do list narrowed to that group (the reminder, handover and
  // needs-attention cards belong to the whole list and stay one click away behind "Show all to-do"). Any other value is the ordinary to-do view.
  const askedGroup: Group | null = (GROUPS as readonly string[]).includes(view) ? (view as Group) : null;
  const who: "mine" | "all" = firstParam(sp, "who") === "all" ? "all" : "mine";
  const openId = parseRecordId(firstParam(sp, "open"));
  // A reminder or a My Day item about one follow-up links here with ?focus=<id>: that row is marked and scrolled to.
  const focusId = parseRecordId(firstParam(sp, "focus"));
  // Follow-ups can show several companies at once, and that is the default: a person's to-do list is never cut down to one company unless they ask.
  const companies = ctx.companies ?? [];
  const companyId = companies.find((c) => c.id === firstParam(sp, "company"))?.id ?? null;
  const here = (patch: Record<string, string | null> = {}) => withParams(BASE, sp, patch);

  const header = (
    <>
      <PageHeader title="Follow-ups" actions={<QuickAddEnquiry companyId={companyId} />} />
      {companies.length > 1 ? (
        <CompanySwitch companies={companies} current={companyId} from={companyId ? "context" : undefined} hrefFor={(id) => here({ company: id, open: null })} all={{ href: here({ company: null, open: null }), active: !companyId }} />
      ) : companies.length === 1 ? (
        <CompanySwitch companies={companies} current={companies[0]!.id} from="only" hrefFor={() => here()} />
      ) : null}
    </>
  );

  // Never throws; makes follow-ups that fell due mid-day show up as reminders without waiting for the daily job.
  await generateRemindersThrottled();

  let loaded: { open: FollowUpListItem[]; done: FollowUpListItem[] };
  let reminders: CrmReminderRow[];
  let opportunities: OpportunityListItem[];
  try {
    [loaded, reminders, opportunities] = await Promise.all([loadFollowUps(ctx), loadMyReminders(), loadOpportunities(ctx)]);
  } catch (e) {
    console.error("[crm] follow-ups load failed", e);
    return (
      <div className="space-y-4">
        {header}
        <LoadError what="follow-ups" retryHref={here()} />
      </div>
    );
  }

  // The handover rows (won without a submitted handover, the PM's question, accepted). Never throws: a failed read is its own message on the card.
  const handover = await loadHandoverRows(ctx, opportunities);
  // Questions Operations asked on the person's enquiries (their own unread notices). Never throws: a failed read is its own message on the card.
  const opsQuestions = await loadOpsQuestionNotices(ctx);

  // "Only open" must be judged on every open follow-up the person can see, not just the filtered ones.
  const openByOpp = new Map<string, number>();
  for (const f of loaded.open) if (f.opportunity) openByOpp.set(f.opportunity.id, (openByOpp.get(f.opportunity.id) ?? 0) + 1);
  const open = (id: string) => here({ open: id });
  /** Where a row leads: an enquiry opens in the side panel; a follow-up on an account with no enquiry opens that account (which can come back here: `from`). */
  const target = (f: FollowUpListItem) => f.opportunity
    ? { href: open(f.opportunity.id), panel: true, selected: openId === f.opportunity.id }
    : { href: `/sales/accounts/${f.account!.id}?company=${f.account!.companyId}&from=follow-ups`, panel: false, selected: false };

  const inScope = (f: FollowUpListItem) => (who === "all" || f.followUp.assigned_to === ctx.userId) && (!companyId || f.followUp.company_id === companyId);
  // The follow-up a link points at is shown even when the current filter would leave it out (an owner's reminder about a colleague's follow-up, a link
  // into another company): a link that lands on a list without its row would look like the follow-up had gone.
  const focusItem = focusId ? (loaded.open.find((f) => f.followUp.id === focusId) ?? null) : null;
  const focusDone = focusId && !focusItem ? (loaded.done.find((f) => f.followUp.id === focusId) ?? null) : null;
  const focusOutside = !!focusItem && !inScope(focusItem);
  // Each follow-up is judged and shown on the clock of its own company (lib/crm/time-zone.ts): "today" is that company's calendar day.
  const zoneOf = zoneOfCompanies(ctx.companies);
  const groups = groupOpenFollowUps(loaded.open.filter((f) => inScope(f) || f === focusItem), new Date(), zoneOf);
  const focusGroup = focusItem ? (GROUPS.find((g) => groups[g].includes(focusItem)) ?? null) : null;
  // A link made earlier can name a group the follow-up has since left (due today then, overdue now): show the whole list rather than hide the row.
  const group: Group | null = askedGroup && focusGroup && focusGroup !== askedGroup ? null : askedGroup;
  const doneRows = loaded.done.filter(inScope);
  const todoCount = groups.overdue.length + groups.today.length + groups.upcoming.length;

  // One current reminder per follow-up (see lib/crm/reminders-current.ts). The facts are the complete open list and the enquiries read above.
  const current = currentReminders(reminders, {
    openFollowUps: new Map(loaded.open.map((f) => [f.followUp.id, { due_at: f.followUp.due_at, opportunity_id: f.followUp.opportunity_id }])),
    opportunities: new Map(opportunities.map((o) => [o.opp.id, { stage: o.opp.stage }])),
  }).filter((c) => !companyId || c.reminder.company_id === companyId);
  const openById = new Map(loaded.open.map((f) => [f.followUp.id, f]));
  const oppById = new Map(opportunities.map((o) => [o.opp.id, o]));
  const needs = attentionItems({ opportunities: companyId ? opportunities.filter((o) => o.opp.company_id === companyId) : opportunities, followUps: loaded.open, zoneOf, userId: ctx.userId, scope: who })
    .filter((a) => a.kind !== "overdue" && a.kind !== "due_today");
  // The person's own open follow-ups that a company filter is hiding: said in words, with the way to see them.
  const mineElsewhere = companyId ? loaded.open.filter((f) => f.followUp.assigned_to === ctx.userId && f.followUp.company_id !== companyId).length : 0;
  const showCompany = companies.length > 1 && !companyId;
  const panel = openId ? <EnquirySidePanel openId={openId} closeHref={here({ open: null })} /> : null;
  const wholeList = !showDone && !group;

  const tab = (href: string, label: string, active: boolean) => (
    <Link href={href} scroll={false} aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium", active ? "border-primary bg-secondary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</Link>
  );
  const card = (g: Group, icon: typeof AlarmClock, edge: "amber" | "cyan" | "blue") => (
    <li><OsStatCard href={here({ view: !showDone && group === g ? null : g, focus: null, open: null })} label={GROUP_LABEL[g]} value={groups[g].length} icon={icon} edge={edge} active={!showDone && group === g} testId={`follow-ups-${g}`} /></li>
  );

  return (
    <div className="space-y-5">
      {header}
      {focusItem ? <FocusRow id={focusItem.followUp.id} /> : null}
      <RememberList section="follow-ups" />

      {/* Action first: how much is overdue, due today and upcoming. Each number is the number of rows its group lists, and the card narrows the list to that group. */}
      <ul className="grid grid-cols-3 gap-3" aria-label="Follow-ups by due time">
        {card("overdue", AlarmClock, "amber")}
        {card("today", CalendarClock, "cyan")}
        {card("upcoming", CalendarDays, "blue")}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Follow-up views" className="flex gap-1">
          {tab(here({ view: null }), `To do (${todoCount})`, !showDone)}
          {tab(here({ view: "done", focus: null }), "Recently completed", showDone)}
        </nav>
        <nav aria-label="Whose follow-ups" className="flex items-center gap-1">
          {tab(here({ who: null }), "Mine", who === "mine")}
          {tab(here({ who: "all" }), "Everyone", who === "all")}
        </nav>
      </div>

      {mineElsewhere > 0 ? (
        <p role="status" className="text-sm" data-testid="follow-ups-other-companies">
          <span className="font-medium text-[hsl(var(--os-amber))]">{mineElsewhere} more of your open follow-ups {mineElsewhere === 1 ? "is" : "are"} in your other companies.</span>{" "}
          <Link href={here({ company: null, open: null })} scroll={false} className="font-medium underline underline-offset-2">Show all my companies</Link>
        </p>
      ) : null}

      {!showDone && focusId && !focusItem ? (
        <p role="status" className="os-card p-3 text-sm" data-testid="follow-ups-focus-gone">
          <span className="font-medium">{focusDone ? "That follow-up has been completed." : "That follow-up is no longer open, or you can no longer see it."}</span>{" "}
          {focusDone ? (
            focusDone.opportunity
              ? <PanelLink href={here({ open: focusDone.opportunity.id, focus: null })} className="underline underline-offset-2">Open the enquiry: {focusDone.opportunity.title}</PanelLink>
              : <Link href={target(focusDone).href} className="underline underline-offset-2">Open the account: {focusDone.account!.name}</Link>
          ) : <Link href={here({ focus: null, view: null })} scroll={false} className="underline underline-offset-2">Show all to-do</Link>}
        </p>
      ) : null}
      {!showDone && focusOutside ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="follow-ups-focus-outside">
          Also showing the follow-up you opened ({focusItem!.followUp.title}): it is outside the current filter. <Link href={here({ focus: null })} scroll={false} className="font-medium text-foreground underline underline-offset-2">Hide it</Link>
        </p>
      ) : null}

      {wholeList && current.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Bell className="h-4 w-4" aria-hidden />Reminders ({current.length} unread)
                <InfoHint label="Reminders">Internal reminders only; nothing is sent to clients. They are created once a day and refreshed when someone opens this page, so they are not instant alerts. There is one reminder per follow-up: dismissing it clears every notice about that follow-up.</InfoHint>
              </h2>
              <MarkRemindersReadButton />
            </div>
            <ul className="divide-y divide-border">
              {current.map((c) => {
                const r = c.reminder;
                const o = oppById.get(r.opportunity_id);
                const f = c.followUpId ? openById.get(c.followUpId) : undefined;
                return (
                  <li key={c.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5 text-sm" data-testid="reminder">
                    <div className="min-w-0 break-words">
                      <OsBadge tone={r.kind === "follow_up_overdue" ? "red" : "amber"} className="mr-1.5 whitespace-nowrap">{REMINDER_LABEL[r.kind]}</OsBadge>
                      {/* A follow-up reminder leads to that exact row; the others (hold review, no next action) are about the enquiry. */}
                      {f ? <Link href={here({ focus: f.followUp.id, view: null, open: null })} scroll={false} className="font-medium underline-offset-2 hover:underline">{r.title}</Link> : <span className="font-medium">{r.title}</span>}{" "}
                      {r.opportunity_id ? <PanelLink href={open(r.opportunity_id)} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">{o ? `${o.opp.reference} · ${o.opp.title}` : "Open enquiry"}</PanelLink> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {f ? <DueText dueAt={f.followUp.due_at} zone={zoneOf(f.followUp.company_id)} className="text-sm" /> : <span className="text-sm text-muted-foreground">{r.due_at ? formatDue(r.due_at, zoneOf(r.company_id)) : formatDateTime(r.created_at)}</span>}
                      <MarkRemindersReadButton reminderIds={c.ids} label="Dismiss" about={r.title} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {wholeList ? <OpsQuestionAttention check={opsQuestions} /> : null}

      {wholeList ? <HandoverAttention check={handover} /> : null}

      {wholeList && needs.length > 0 ? <NeedsAttention items={needs} open={open} who={who} moreHref={withParams("/sales/opportunities", {}, { owner: who === "mine" ? "me" : null, company: companyId })} /> : null}

      {showDone ? (
        doneRows.length === 0 ? (
          <EmptyState title="No completed follow-ups yet" description={who === "mine" ? MINE_HINT : undefined} />
        ) : (
          <>
            <Table className={cn("min-w-[44rem]", listTable)}>
              <caption className="sr-only">Recently completed follow-ups</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Follow-up</TableHead>
                  <TableHead scope="col">Enquiry or account</TableHead>
                  <TableHead scope="col">Completed</TableHead>
                  <TableHead scope="col">What happened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doneRows.map((f) => (
                  <ClickableRow key={f.followUp.id} {...target(f)} className="align-top">
                    <TableCell className="min-w-[10rem] break-words font-medium">{f.followUp.title}</TableCell>
                    <TableCell data-label="Enquiry" className="min-w-[12rem]"><Subject f={f} href={target(f).href} company={showCompany ? ctx.companyName(f.followUp.company_id) : null} /></TableCell>
                    <TableCell data-label="Completed" className="whitespace-nowrap">{formatDateTime(f.followUp.completed_at)}<div className="text-sm text-muted-foreground">{f.assigneeName}</div></TableCell>
                    <TableCell data-label="What happened" className="break-words text-sm">{f.followUp.outcome || <span className="text-muted-foreground">No outcome recorded</span>}</TableCell>
                  </ClickableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground">The 30 most recently completed follow-ups.</p>
          </>
        )
      ) : group && groups[group].length === 0 && todoCount > 0 ? (
        <>
          <OnlyNote group={group} showAll={here({ view: null })} />
          <EmptyState title={NOTHING[group]} description={who === "mine" ? MINE_HINT : undefined} />
        </>
      ) : todoCount === 0 ? (
        <EmptyState
          title="Nothing to follow up"
          description={loaded.open.length === 0 && loaded.done.length === 0 ? "Follow-ups appear here when an enquiry has a next action. Use Add enquiry to record one." : who === "mine" ? MINE_HINT : undefined}
        />
      ) : (
        <div className="space-y-5">
          {group ? <OnlyNote group={group} showAll={here({ view: null })} /> : null}
          {/* One list in three parts: the columns line up across the groups and the column headings are shown once, on the first group on screen. */}
          {GROUPS.filter((g) => (!group || g === group) && groups[g].length > 0).map((g, index) => (
            <section key={g} aria-labelledby={`g-${g}`}>
              <h2 id={`g-${g}`} className={cn("mb-2 text-sm font-semibold", g === "overdue" && "text-destructive")}>{GROUP_LABEL[g]} <span className="font-normal text-muted-foreground">({groups[g].length})</span>
                {/* Once, on the first group (not in the column heading: later groups hide theirs, and a hidden heading must not hold a button). */}
                {index === 0 ? <InfoHint label="Due dates and times" className="ml-1">Due shows the exact date and time on the clock of the company the follow-up belongs to; the place is written after the time. Overdue means that time has passed; due today means it is still to come today. Complete records what happened and plans the next action; Reschedule only moves the due time.</InfoHint> : null}
              </h2>
              <Table className={cn("min-w-[58rem] md:table-fixed", listTable, index > 0 && "md:[&_thead]:sr-only")}>
                <caption className="sr-only">{GROUP_LABEL[g]} follow-ups</caption>
                <colgroup><col className="md:w-[24%]" /><col /><col className="md:w-[11.5rem]" /><col className="md:w-[8.5rem]" /><col className="md:w-[19.5rem]" /></colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Next action</TableHead>
                    <TableHead scope="col">Enquiry or account</TableHead>
                    <TableHead scope="col">Due</TableHead>
                    <TableHead scope="col">Assigned to</TableHead>
                    <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups[g].map((f) => {
                    const fu = f.followUp;
                    const opp = f.opportunity;
                    const isOnlyOpen = !!opp && fu.status === "open" && isCrmActive(opp.stage) && (openByOpp.get(opp.id) ?? 0) === 1;
                    const canAct = opp
                      ? canActOnFollowUp(ctx.grants, { assignedTo: fu.assigned_to }, { companyId: opp.company_id, ownerId: opp.owner_id }, ctx.userId)
                      : canActOnAccountFollowUp(ctx.grants, { assignedTo: fu.assigned_to, createdBy: fu.created_by, companyId: fu.company_id }, ctx.userId);
                    const focused = f === focusItem;
                    return (
                      <ClickableRow key={fu.id} {...target(f)} id={followUpRowId(fu.id)} data-focused={focused ? "true" : undefined}
                        className={cn("scroll-mt-24 align-top", focused && "bg-accent/10 outline outline-2 -outline-offset-2 outline-accent")}>
                        <TableCell className="min-w-[9rem]">
                          <div className="break-words font-medium">{fu.title}{focused ? <OsBadge tone="cyan" className="ml-1.5 align-middle">Opened from your link</OsBadge> : null}</div>
                          <div className="text-sm text-muted-foreground">{KIND_LABEL[fu.kind] ?? fu.kind}</div>
                        </TableCell>
                        <TableCell data-label="Enquiry" className="min-w-[10rem]"><Subject f={f} href={target(f).href} company={showCompany ? ctx.companyName(fu.company_id) : null} /></TableCell>
                        <TableCell data-label="Due"><DueText dueAt={fu.due_at} zone={zoneOf(fu.company_id)} className="whitespace-normal" /></TableCell>
                        <TableCell data-label="Assigned to" className="break-words">{f.assigneeName}</TableCell>
                        <TableCell className="min-w-[9rem]">
                          {canAct ? (
                            <FollowUpRowActions followUp={{ id: fu.id, title: fu.title, kind: fu.kind, dueAt: fu.due_at, opportunityId: fu.opportunity_id, isOnlyOpen, timeZone: zoneOf(fu.company_id) }} />
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                              View only
                              <InfoHint label="why you cannot change this follow-up">{opp ? `Only the assignee, the owner (${ctx.personName(opp.owner_id)}) or a founder can change this.` : "Only the assignee, the person who added it or a founder can change this."}</InfoHint>
                            </span>
                          )}
                        </TableCell>
                      </ClickableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      )}
      {panel}
    </div>
  );
}

/** What a follow-up is about: its enquiry (opens in the side panel) with the reference and the agency or client, or the account when there is no enquiry. */
function Subject({ f, href, company }: { f: FollowUpListItem; href: string; company: string | null }) {
  const opp = f.opportunity;
  return (
    <>
      {opp
        ? <PanelLink href={href} className="break-words underline-offset-2 hover:underline">{opp.title}</PanelLink>
        : <Link href={href} className="break-words underline-offset-2 hover:underline">{f.account!.name}</Link>}
      <div className="break-words text-sm text-muted-foreground">
        {opp ? <><span className="font-mono">{opp.reference}</span>{f.party ? ` · ${f.party}` : ""}</> : "Account follow-up (no enquiry)"}
        {company ? ` · ${company}` : ""}
      </div>
    </>
  );
}

/** Shown when the list is narrowed to one group (from My Day or a summary card): says what is (and is not) on screen and how to get the rest back. */
function OnlyNote({ group, showAll }: { group: Group; showAll: string }) {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      {ONLY_NOTE[group]} <Link href={showAll} scroll={false} className="font-medium text-foreground underline underline-offset-2">Show all to-do</Link>
    </p>
  );
}

/** Enquiries that need someone, not because a follow-up is late but because something is missing: no next action, a hold review that has arrived, no first response. */
function NeedsAttention({ items, open, who, moreHref }: { items: AttentionItem[]; open: (id: string) => string; who: "mine" | "all"; moreHref: string }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h2 className="text-sm font-semibold">Needs attention <span className="font-normal text-muted-foreground">({who === "mine" ? "enquiries you own" : "everyone's enquiries"})</span></h2>
        <ul className="divide-y divide-border">
          {items.slice(0, MAX_ATTENTION).map((a, i) => (
            <li key={`${a.kind}-${a.opportunityId}-${i}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5 text-sm">
              <div className="min-w-0">
                <PanelLink href={open(a.opportunityId)} className="break-words font-medium underline-offset-2 hover:underline">{a.title}</PanelLink>
                <span className="text-muted-foreground"> · {a.reference}</span>
              </div>
              <span className="whitespace-nowrap font-medium text-[hsl(var(--os-amber))]">{ATTENTION_LABEL[a.kind] ?? a.detail}{a.kind === "hold_review" && a.at ? ` · ${formatDate(a.at)}` : ""}</span>
            </li>
          ))}
        </ul>
        {items.length > MAX_ATTENTION ? <p className="text-sm text-muted-foreground">Showing {MAX_ATTENTION} of {items.length}. <Link href={moreHref} className="font-medium text-foreground underline underline-offset-2">Open Enquiries to see the rest</Link></p> : null}
      </CardContent>
    </Card>
  );
}
