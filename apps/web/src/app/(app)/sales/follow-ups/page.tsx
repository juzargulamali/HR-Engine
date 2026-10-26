import Link from "next/link";
import { listTable } from "@/components/workspace/list-table";
import { Bell } from "lucide-react";
import { canActOnFollowUp, isCrmActive } from "@enginious-hr/domain";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DueText } from "@/components/sales/badges";
import { FollowUpRowActions } from "@/components/sales/follow-up-row-actions";
import { formatDate, formatDateTime } from "@/components/sales/format";
import { QuickAddEnquiry } from "@/components/sales/quick-add-enquiry";
import { ClickableRow } from "@/components/workspace/clickable-row";
import { PanelLink } from "@/components/workspace/panel-link";
import { LoadError } from "@/components/workspace/states";
import { firstParam, parseRecordId, withParams } from "@/components/workspace/url-state";
import { getCrmContext } from "@/lib/crm/context";
import { loadFollowUps, loadMyReminders, loadOpportunities, type FollowUpListItem, type OpportunityListItem } from "@/lib/crm/data";
import { groupOpenFollowUps } from "@/lib/crm/follow-up-groups";
import { generateRemindersThrottled } from "@/lib/crm/reminders";
import { attentionItems, type AttentionItem } from "@/lib/crm/reports";
import type { CrmReminderRow } from "@/types/crm";
import { cn } from "@/lib/utils";
import { EnquirySidePanel } from "../_panel/enquiry-panel";
import { MarkRemindersReadButton } from "../mark-reminders-read";

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

type Params = Record<string, string | string[] | undefined>;

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getCrmContext();
  if (!ctx) return null;
  if (ctx.grants.length === 0) return null;
  const showDone = firstParam(sp, "view") === "done";
  const who: "mine" | "all" = firstParam(sp, "who") === "all" ? "all" : "mine";
  const openId = parseRecordId(firstParam(sp, "open"));
  const here = (patch: Record<string, string | null> = {}) => withParams(BASE, sp, patch);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Follow-ups</h1>
      <QuickAddEnquiry />
    </div>
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

  // "Only open" must be judged on every open follow-up the person can see, not just the filtered ones.
  const openByOpp = new Map<string, number>();
  for (const f of loaded.open) openByOpp.set(f.opportunity.id, (openByOpp.get(f.opportunity.id) ?? 0) + 1);
  const keep = (f: FollowUpListItem) => who === "all" || f.followUp.assigned_to === ctx.userId;
  const groups = groupOpenFollowUps(loaded.open.filter(keep));
  const doneRows = loaded.done.filter(keep);
  const oppById = new Map(opportunities.map((o) => [o.opp.id, o]));
  const needs = attentionItems({ opportunities, followUps: loaded.open, userId: ctx.userId, scope: who }).filter((a) => a.kind !== "overdue" && a.kind !== "due_today");
  const todoCount = groups.overdue.length + groups.today.length + groups.upcoming.length;
  const panel = openId ? <EnquirySidePanel openId={openId} closeHref={here({ open: null })} /> : null;
  const open = (id: string) => here({ open: id });

  const tab = (href: string, label: string, active: boolean) => (
    <Link href={href} scroll={false} aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium", active ? "border-primary bg-secondary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</Link>
  );

  return (
    <div className="space-y-5">
      {header}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Follow-up views" className="flex gap-1">
          {tab(here({ view: null }), `To do (${todoCount})`, !showDone)}
          {tab(here({ view: "done" }), "Recently completed", showDone)}
        </nav>
        <nav aria-label="Whose follow-ups" className="flex items-center gap-1">
          {tab(here({ who: null }), "Mine", who === "mine")}
          {tab(here({ who: "all" }), "Everyone", who === "all")}
        </nav>
      </div>

      {!showDone && reminders.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><Bell className="h-4 w-4" aria-hidden />Reminders ({reminders.length} unread)</h2>
              <MarkRemindersReadButton />
            </div>
            <ul className="divide-y divide-border">
              {reminders.map((r) => {
                const o = oppById.get(r.opportunity_id);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{REMINDER_LABEL[r.kind]}</span>: {r.title}{" "}
                      <PanelLink href={open(r.opportunity_id)} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">{o ? `${o.opp.reference} · ${o.opp.title}` : "Open enquiry"}</PanelLink>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{formatDateTime(r.due_at ?? r.created_at)}</span>
                      <MarkRemindersReadButton reminderId={r.id} label="Dismiss" />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-muted-foreground">Internal reminders only; nothing is sent to clients. They are created once a day and refreshed when someone opens this page, so they are not instant alerts.</p>
          </CardContent>
        </Card>
      ) : null}

      {!showDone && needs.length > 0 ? <NeedsAttention items={needs} open={open} who={who} /> : null}

      {showDone ? (
        doneRows.length === 0 ? (
          <EmptyState title="No completed follow-ups yet" description={who === "mine" ? "This shows follow-ups assigned to you. Choose Everyone to see the whole team's." : undefined} />
        ) : (
          <>
            <Table className={cn("min-w-[44rem]", listTable)}>
              <caption className="sr-only">Recently completed follow-ups</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Follow-up</TableHead>
                  <TableHead scope="col">Enquiry</TableHead>
                  <TableHead scope="col">Completed</TableHead>
                  <TableHead scope="col">What happened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doneRows.map((f) => (
                  <ClickableRow key={f.followUp.id} href={open(f.opportunity.id)} panel selected={openId === f.opportunity.id} className="align-top">
                    <TableCell className="min-w-[10rem] font-medium">{f.followUp.title}</TableCell>
                    <TableCell data-label="Enquiry" className="min-w-[12rem]">
                      <PanelLink href={open(f.opportunity.id)} className="underline-offset-2 hover:underline">{f.opportunity.title}</PanelLink>
                      <div className="text-sm text-muted-foreground">{f.party}</div>
                    </TableCell>
                    <TableCell data-label="Completed" className="whitespace-nowrap">{formatDateTime(f.followUp.completed_at)}<div className="text-sm text-muted-foreground">{f.assigneeName}</div></TableCell>
                    <TableCell data-label="What happened" className="text-sm">{f.followUp.outcome || <span className="text-muted-foreground">No outcome recorded</span>}</TableCell>
                  </ClickableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground">The 30 most recently completed follow-ups.</p>
          </>
        )
      ) : todoCount === 0 ? (
        <EmptyState
          title="Nothing to follow up"
          description={loaded.open.length === 0 && loaded.done.length === 0 ? "Follow-ups appear here when an enquiry has a next action. Use Add enquiry to record one." : who === "mine" ? "This shows follow-ups assigned to you. Choose Everyone to see the whole team's." : undefined}
        />
      ) : (
        <div className="space-y-6">
          {([["Overdue", groups.overdue, true], ["Today", groups.today, false], ["Upcoming", groups.upcoming, false]] as const).map(([title, rows, danger]) =>
            rows.length === 0 ? null : (
              <section key={title} aria-labelledby={`g-${title}`}>
                <h2 id={`g-${title}`} className={cn("mb-2 text-sm font-semibold", danger && "text-destructive")}>{title} <span className="font-normal text-muted-foreground">({rows.length})</span></h2>
                <Table className={cn("min-w-[52rem]", listTable)}>
                  <caption className="sr-only">{title} follow-ups</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Next action</TableHead>
                      <TableHead scope="col">Enquiry</TableHead>
                      <TableHead scope="col">Agency / client</TableHead>
                      <TableHead scope="col">Due</TableHead>
                      <TableHead scope="col">Responsible</TableHead>
                      <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((f) => {
                      const fu = f.followUp;
                      const isOnlyOpen = fu.status === "open" && isCrmActive(f.opportunity.stage) && (openByOpp.get(f.opportunity.id) ?? 0) === 1;
                      const canAct = canActOnFollowUp(ctx.grants, { assignedTo: fu.assigned_to }, { companyId: f.opportunity.company_id, ownerId: f.opportunity.owner_id }, ctx.userId);
                      return (
                        <ClickableRow key={fu.id} href={open(f.opportunity.id)} panel selected={openId === f.opportunity.id} className="align-top">
                          <TableCell className="min-w-[9rem]"><div className="break-words font-medium">{fu.title}</div><div className="text-sm text-muted-foreground">{KIND_LABEL[fu.kind] ?? fu.kind}</div></TableCell>
                          <TableCell data-label="Enquiry" className="min-w-[10rem]">
                            <PanelLink href={open(f.opportunity.id)} className="break-words underline-offset-2 hover:underline">{f.opportunity.title}</PanelLink>
                            <div className="font-mono text-sm text-muted-foreground">{f.opportunity.reference}</div>
                          </TableCell>
                          <TableCell data-label="Client" className="min-w-[7rem] break-words">{f.party}</TableCell>
                          <TableCell data-label="Due"><DueText dueAt={fu.due_at} className="whitespace-normal" /></TableCell>
                          <TableCell data-label="Owner" className="whitespace-nowrap">{f.assigneeName}</TableCell>
                          <TableCell className="min-w-[9rem]">
                            {canAct ? (
                              <FollowUpRowActions followUp={{ id: fu.id, title: fu.title, opportunityId: fu.opportunity_id, isOnlyOpen }} />
                            ) : (
                              <span className="text-sm text-muted-foreground">Only the assignee, the owner ({ctx.personName(f.opportunity.owner_id)}) or a founder can change this.</span>
                            )}
                          </TableCell>
                        </ClickableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </section>
            ),
          )}
          {loaded.open.length >= 1000 ? <p className="text-sm text-muted-foreground">Showing the first 1,000 open follow-ups.</p> : null}
        </div>
      )}
      {panel}
    </div>
  );
}

/** Enquiries that need someone, not because a follow-up is late but because something is missing: no next action, a hold review that has arrived, no first response. */
function NeedsAttention({ items, open, who }: { items: AttentionItem[]; open: (id: string) => string; who: "mine" | "all" }) {
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
        {items.length > MAX_ATTENTION ? <p className="text-sm text-muted-foreground">Showing {MAX_ATTENTION} of {items.length}. Open Enquiries to see the rest.</p> : null}
      </CardContent>
    </Card>
  );
}
