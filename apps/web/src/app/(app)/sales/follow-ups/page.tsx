import Link from "next/link";
import { canActOnFollowUp, followUpTiming, isCrmActive } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DueText } from "@/components/sales/badges";
import { CancelFollowUpButton, CompleteFollowUpButton, RescheduleFollowUpButton } from "@/components/sales/follow-up-dialogs";
import { formatDateTime } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadFollowUps, type FollowUpListItem } from "@/lib/crm/data";
import { cn } from "@/lib/utils";

export const metadata = { title: "Follow-ups" };

type View = "overdue" | "today" | "upcoming" | "done";
const VIEWS: { value: View; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "done", label: "Recently completed" },
];

const KIND_LABEL: Record<string, string> = { call: "Call", email: "Email", meeting: "Meeting", proposal: "Proposal work", other: "Other" };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const view: View = VIEWS.find((v) => v.value === first(sp.view))?.value ?? "overdue";
  const who: "mine" | "all" = first(sp.who) === "all" ? "all" : "mine";

  let loaded: { open: FollowUpListItem[]; done: FollowUpListItem[] };
  try {
    loaded = await loadFollowUps(ctx);
  } catch (e) {
    console.error("[crm] follow-ups load failed", e);
    return (
      <div className="space-y-4">
        <Header />
        <Alert variant="destructive">Could not load follow-ups. Reload the page; if it keeps happening, tell an administrator.</Alert>
      </div>
    );
  }

  // "Only open" must be judged on every open follow-up the person can see, not just the filtered ones.
  const openByOpp = new Map<string, number>();
  for (const f of loaded.open) openByOpp.set(f.opportunity.id, (openByOpp.get(f.opportunity.id) ?? 0) + 1);

  const now = new Date();
  const keep = (f: FollowUpListItem) => who === "all" || f.followUp.assigned_to === ctx.userId;
  const open = loaded.open.filter(keep);
  const lists: Record<View, FollowUpListItem[]> = {
    overdue: open.filter((f) => followUpTiming(f.followUp.due_at, now) === "overdue"),
    today: open.filter((f) => followUpTiming(f.followUp.due_at, now) === "due_today"),
    upcoming: open.filter((f) => followUpTiming(f.followUp.due_at, now) === "upcoming"),
    done: loaded.done.filter(keep),
  };
  const rows = lists[view];
  const href = (v: View, w: "mine" | "all") => `/sales/follow-ups?view=${v}${w === "all" ? "&who=all" : ""}`;
  const emptyText: Record<View, string> = {
    overdue: "Nothing is overdue.",
    today: "Nothing is due today.",
    upcoming: "No upcoming follow-ups.",
    done: "No completed follow-ups yet.",
  };

  return (
    <div className="space-y-6">
      <Header />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Follow-up views" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {VIEWS.map((v) => (
            <Link
              key={v.value}
              href={href(v.value, who)}
              aria-current={v.value === view ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-medium", v.value === view ? "border-primary bg-secondary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {v.label} ({lists[v.value].length})
            </Link>
          ))}
        </nav>
        <nav aria-label="Whose follow-ups" className="flex items-center gap-1 text-sm">
          {(["mine", "all"] as const).map((w) => (
            <Link key={w} href={href(view, w)} aria-current={w === who ? "true" : undefined} className={cn("rounded-md border px-3 py-1.5 font-medium", w === who ? "border-primary bg-secondary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {w === "mine" ? "Mine" : "Everyone"}
            </Link>
          ))}
        </nav>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={emptyText[view]}
          description={loaded.open.length === 0 && loaded.done.length === 0 ? "Follow-ups appear here when an opportunity has a next action." : who === "mine" ? "This shows follow-ups assigned to you. Choose Everyone to see the whole team's." : undefined}
        />
      ) : (
        <Card>
          <CardContent className="p-4">
            <Table className="min-w-[48rem]">
              <caption className="sr-only">{VIEWS.find((v) => v.value === view)?.label} follow-ups</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Follow-up</TableHead>
                  <TableHead scope="col">Opportunity</TableHead>
                  <TableHead scope="col">Assigned to</TableHead>
                  <TableHead scope="col">{view === "done" ? "Completed" : "Due"}</TableHead>
                  <TableHead scope="col">{view === "done" ? "Outcome" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((f) => {
                  const fu = f.followUp;
                  const isOnlyOpen = fu.status === "open" && isCrmActive(f.opportunity.stage) && (openByOpp.get(f.opportunity.id) ?? 0) === 1;
                  const canAct = canActOnFollowUp(ctx.grants, { assignedTo: fu.assigned_to }, { companyId: f.opportunity.company_id, ownerId: f.opportunity.owner_id }, ctx.userId);
                  const ref = { id: fu.id, title: fu.title, opportunityId: fu.opportunity_id };
                  return (
                    <TableRow key={fu.id} className="align-top">
                      <TableCell className="min-w-[12rem]">
                        <div className="font-medium">{fu.title}</div>
                        <div className="text-sm text-muted-foreground">{KIND_LABEL[fu.kind] ?? fu.kind}</div>
                      </TableCell>
                      <TableCell className="min-w-[12rem]">
                        <Link href={`/sales/opportunities/${f.opportunity.id}`} className="underline-offset-2 hover:underline">{f.opportunity.title}</Link>
                        <div className="font-mono text-sm text-muted-foreground">{f.opportunity.reference}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{f.assigneeName}</TableCell>
                      <TableCell>{view === "done" ? <span className="whitespace-nowrap">{formatDateTime(fu.completed_at)}</span> : <DueText dueAt={fu.due_at} />}</TableCell>
                      <TableCell className="min-w-[10rem]">
                        {view === "done" ? (
                          <span className="text-sm">{fu.outcome || <span className="text-muted-foreground">No outcome recorded</span>}</span>
                        ) : canAct ? (
                          <div className="flex flex-wrap items-center gap-1">
                            <CompleteFollowUpButton followUp={{ ...ref, isOnlyOpen }} />
                            <RescheduleFollowUpButton followUp={ref} />
                            {isOnlyOpen ? null : <CancelFollowUpButton followUp={ref} />}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Only the assignee, the owner ({ctx.personName(f.opportunity.owner_id)}) or a founder can change this.</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {view !== "done" && loaded.open.length >= 1000 ? <p className="mt-3 text-sm text-muted-foreground">Showing the first 1,000 open follow-ups.</p> : null}
            {view === "done" ? <p className="mt-3 text-sm text-muted-foreground">The 30 most recently completed follow-ups.</p> : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Follow-ups</h1>
      <p className="text-muted-foreground">Overdue means the time set has passed. Every active opportunity keeps a next action; completing the last one asks what happens next.</p>
    </div>
  );
}
