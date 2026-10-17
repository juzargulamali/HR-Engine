import Link from "next/link";
import { Bell, Plus } from "lucide-react";
import { crmStageLabel, isCrmOpen } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DueText, StageBadge } from "@/components/sales/badges";
import { formatDate, formatDateTime, formatMoney } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadFollowUps, loadMyReminders, loadOpportunities, type FollowUpListItem, type OpportunityListItem } from "@/lib/crm/data";
import { generateRemindersThrottled } from "@/lib/crm/reminders";
import { attentionItems, openPipelineByStage, organisationLabel, type AttentionItem, type AttentionKind } from "@/lib/crm/reports";
import { createClient } from "@/lib/supabase/server";
import type { CrmActivityRow, CrmReminderRow } from "@/types/crm";
import { CurrencyTotals } from "./currency-totals";
import { MarkRemindersReadButton } from "./mark-reminders-read";

const REMINDER_LABEL: Record<CrmReminderRow["kind"], string> = {
  follow_up_due: "Follow-up due",
  follow_up_overdue: "Follow-up overdue",
  hold_review_due: "Hold review due",
  no_next_action: "No next action",
};

const ACTIVITY_LABEL: Record<CrmActivityRow["kind"], string> = { call: "Call", email: "Email", meeting: "Meeting", note: "Note", client_response: "Client response" };

const ATTENTION_LABEL: Record<AttentionKind, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  hold_review: "Hold review due",
  no_next_action: "No next action",
  no_first_response: "No first response",
};

const MAX_ATTENTION = 15;

interface OverviewData {
  opportunities: OpportunityListItem[];
  followUps: FollowUpListItem[];
  reminders: CrmReminderRow[];
  activities: CrmActivityRow[];
}

async function loadOverview(ctx: NonNullable<Awaited<ReturnType<typeof getCrmContext>>>): Promise<OverviewData> {
  const supabase = await createClient();
  const [opportunities, followUps, reminders, { data: activities }] = await Promise.all([
    loadOpportunities(ctx),
    loadFollowUps(ctx),
    loadMyReminders(),
    supabase.from("crm_activities").select("*").order("occurred_at", { ascending: false }).limit(8),
  ]);
  return { opportunities, followUps: followUps.open, reminders, activities: activities ?? [] };
}

export default async function SalesOverviewPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope: scopeParam } = await searchParams;
  const ctx = await getCrmContext();
  if (!ctx) return null;

  // Never throws; makes follow-ups that fell due mid-day show up as reminders without waiting for the daily job.
  await generateRemindersThrottled();

  let data: OverviewData;
  try {
    data = await loadOverview(ctx);
  } catch (e) {
    console.error("[crm] overview load failed", e);
    return (
      <div className="space-y-4">
        <Header />
        <Alert variant="destructive">Could not load the Sales overview. Reload the page; if it keeps happening, tell an administrator.</Alert>
      </div>
    );
  }

  const scope = scopeParam === "all" ? "all" : "mine";
  const { opportunities, followUps, reminders, activities } = data;
  const oppById = new Map(opportunities.map((o) => [o.opp.id, o]));
  const attention = attentionItems({ opportunities, followUps, userId: ctx.userId, scope });
  const count = (k: AttentionKind) => attention.filter((a) => a.kind === k).length;
  const pipeline = openPipelineByStage(opportunities.map((i) => ({ ...i.opp, value: i.value })));
  const openCount = pipeline.reduce((n, s) => n + s.count, 0);
  const mine = opportunities
    .filter((i) => i.opp.owner_id === ctx.userId && isCrmOpen(i.opp.stage))
    .sort((a, b) => (a.nextFollowUp?.due_at ?? "9999").localeCompare(b.nextFollowUp?.due_at ?? "9999"))
    .slice(0, 8);

  if (opportunities.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState title="No opportunities yet" description="Record the first enquiry and it will appear here. Unknown dates, budget and scope are fine." action={<Link href="/sales/new" className={buttonVariants({ size: "sm" })}>Record the first enquiry</Link>} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      {reminders.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4" aria-hidden />Reminders ({reminders.length} unread)</CardTitle>
              <CardDescription>Internal reminders only. Nothing is sent to clients.</CardDescription>
            </div>
            <MarkRemindersReadButton />
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {reminders.map((r) => {
                const o = oppById.get(r.opportunity_id);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{REMINDER_LABEL[r.kind]}</span>: {r.title}{" "}
                      <Link href={`/sales/opportunities/${r.opportunity_id}`} className="text-muted-foreground underline-offset-2 hover:underline">{o ? `${o.opp.reference} · ${o.opp.title}` : "Open opportunity"}</Link>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{formatDateTime(r.due_at ?? r.created_at)}</span>
                      <MarkRemindersReadButton reminderId={r.id} label="Dismiss" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Overdue follow-ups" value={count("overdue")} tone={count("overdue") ? "destructive" : "default"} hint={scope === "mine" ? "Assigned to you" : "Everyone"} href="/sales/follow-ups" />
        <MetricCard label="Due today" value={count("due_today")} tone={count("due_today") ? "warning" : "default"} hint="Dubai time" href="/sales/follow-ups?view=today" />
        <MetricCard label="No next action" value={count("no_next_action")} tone={count("no_next_action") ? "warning" : "default"} hint="Active opportunities" href="/sales/opportunities" />
        <MetricCard label="No first response" value={count("no_first_response")} tone={count("no_first_response") ? "warning" : "default"} hint="Open enquiries" href="/sales/opportunities" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Needs attention now</CardTitle>
              <CardDescription>{scope === "mine" ? "Follow-ups assigned to you and opportunities you own." : "Everyone's follow-ups and opportunities."}</CardDescription>
            </div>
            <Link href={scope === "mine" ? "/sales?scope=all" : "/sales"} className="text-sm font-medium underline-offset-2 hover:underline">{scope === "mine" ? "Show everyone" : "Show only mine"}</Link>
          </CardHeader>
          <CardContent>
            {attention.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing needs attention here.</p>
            ) : (
              <>
                <ul className="divide-y divide-border">
                  {attention.slice(0, MAX_ATTENTION).map((a, i) => <AttentionRow key={`${a.kind}-${a.opportunityId}-${i}`} item={a} />)}
                </ul>
                {attention.length > MAX_ATTENTION ? <p className="mt-3 text-xs text-muted-foreground">Showing {MAX_ATTENTION} of {attention.length}. <Link href="/sales/follow-ups" className="underline-offset-2 hover:underline">Open follow-ups</Link></p> : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1.5">
            <CardTitle className="text-base">Open pipeline</CardTitle>
            <CardDescription>{openCount} open. Each currency on its own line, never added together.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {pipeline.map((s) => (
                <li key={s.stage} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{crmStageLabel(s.stage)}</span>
                  <span className="text-right">
                    <span className="font-medium tabular-nums">{s.count}</span>
                    {s.count > 0 ? <CurrencyTotals totals={s.totals} unvalued={s.unvalued} emptyText="No value yet" className="block text-xs text-muted-foreground" /> : null}
                  </span>
                </li>
              ))}
            </ul>
            <Link href="/sales/pipeline" className="mt-4 inline-block text-sm font-medium underline-offset-2 hover:underline">Open pipeline board</Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="space-y-1.5">
            <CardTitle className="text-base">My open opportunities</CardTitle>
            <CardDescription>Opportunities you own, soonest next follow-up first.</CardDescription>
          </CardHeader>
          <CardContent>
            {mine.length === 0 ? (
              <EmptyState dense title="You do not own any open opportunities." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Opportunity</TableHead>
                    <TableHead scope="col">Stage</TableHead>
                    <TableHead scope="col">Value</TableHead>
                    <TableHead scope="col">Next follow-up</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mine.map((i) => (
                    <TableRow key={i.opp.id}>
                      <TableCell>
                        <Link href={`/sales/opportunities/${i.opp.id}`} className="font-medium underline-offset-2 hover:underline">{i.opp.title}</Link>
                        <div className="text-xs text-muted-foreground">{i.opp.reference} · {organisationLabel(i)}</div>
                      </TableCell>
                      <TableCell><StageBadge stage={i.opp.stage} /></TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatMoney(i.value, i.opp.currency)}</TableCell>
                      <TableCell>{i.nextFollowUp ? <DueText dueAt={i.nextFollowUp.due_at} /> : <span className="text-muted-foreground">None planned</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1.5">
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity logged yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {activities.map((a) => {
                  const o = oppById.get(a.opportunity_id);
                  return (
                    <li key={a.id} className="py-2 text-sm">
                      <p className="line-clamp-2 break-words">{a.body}</p>
                      <p className="text-xs text-muted-foreground">
                        {ctx.personName(a.created_by)} · {formatDateTime(a.occurred_at)} · {a.is_internal ? "Internal note" : ACTIVITY_LABEL[a.kind]}
                        {o ? <> · <Link href={`/sales/opportunities/${o.opp.id}`} className="underline-offset-2 hover:underline">{o.opp.reference}</Link></> : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Sales overview</h1>
        <p className="text-muted-foreground">What needs doing today, and where the pipeline stands.</p>
      </div>
      <Link href="/sales/new" className={buttonVariants()}>
        <Plus className="h-4 w-4" aria-hidden />New enquiry
      </Link>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const isFollowUp = item.kind === "overdue" || item.kind === "due_today";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
      <div className="min-w-0">
        <Link href={`/sales/opportunities/${item.opportunityId}`} className="break-words font-medium underline-offset-2 hover:underline">{item.title}</Link>
        <p className="text-xs text-muted-foreground">{item.reference} · {item.detail}</p>
      </div>
      <div className="text-right text-xs">
        {isFollowUp && item.at ? <DueText dueAt={item.at} /> : item.kind === "hold_review" && item.at ? <span className="whitespace-nowrap font-medium text-amber-700 dark:text-amber-300">{ATTENTION_LABEL[item.kind]} · {formatDate(item.at)}</span> : <span className="whitespace-nowrap font-medium text-amber-700 dark:text-amber-300">{ATTENTION_LABEL[item.kind]}</span>}
      </div>
    </li>
  );
}
