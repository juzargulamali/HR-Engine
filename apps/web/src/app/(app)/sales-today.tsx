import Link from "next/link";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DueText } from "@/components/sales/badges";
import { formatDate } from "@/components/sales/format";
import type { SalesTodayResult } from "@/lib/crm/my-day";
import type { AttentionItem, AttentionKind } from "@/lib/crm/reports";

const KIND_LABEL: Record<AttentionKind, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  hold_review: "Hold review due",
  no_next_action: "No next action",
  no_first_response: "No first response",
};

const MAX_ITEMS = 5;

function Row({ item }: { item: AttentionItem }) {
  const isFollowUp = item.kind === "overdue" || item.kind === "due_today";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
      <div className="min-w-0">
        <Link href={`/sales/opportunities/${item.opportunityId}`} className="break-words font-medium underline-offset-2 hover:underline">
          {item.title}
        </Link>
        <p className="text-sm text-muted-foreground">
          {item.reference} · {item.detail}
        </p>
      </div>
      <div className="text-right text-sm">
        {isFollowUp && item.at ? (
          <DueText dueAt={item.at} />
        ) : (
          <span className="whitespace-nowrap font-medium text-warning">
            {KIND_LABEL[item.kind]}
            {item.kind === "hold_review" && item.at ? ` · ${formatDate(item.at)}` : ""}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * The Sales part of My Day. Rendered only for people with a Sales grant (the caller passes "none" otherwise and this shows
 * nothing). Real follow-ups and opportunities only; an honest empty state when there is nothing to do or nothing recorded yet.
 */
export function SalesToday({ result }: { result: SalesTodayResult }) {
  if (result.status === "none") return null;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Sales follow-ups</CardTitle>
          <CardDescription>Follow-ups assigned to you and opportunities you own, most urgent first.</CardDescription>
        </div>
        <Link href="/sales" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Open Sales &amp; CRM
        </Link>
      </CardHeader>
      <CardContent>
        {result.status === "error" ? (
          <Alert variant="warning">Sales follow-ups could not be loaded right now. Open Sales &amp; CRM, or reload in a moment.</Alert>
        ) : result.data.opportunityCount === 0 ? (
          <EmptyState
            dense
            title="No enquiries recorded yet"
            description="Record the first enquiry and your follow-ups will appear here."
            action={
              <Link href="/sales/new" className={buttonVariants({ size: "sm" })}>
                <Plus className="h-4 w-4" aria-hidden />
                New enquiry
              </Link>
            }
          />
        ) : result.data.attention.length === 0 ? (
          <EmptyState dense title="Nothing is overdue or due today" description={`${result.data.openCount} open ${result.data.openCount === 1 ? "opportunity is" : "opportunities are"} in the pipeline.`} />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {result.data.attention.slice(0, MAX_ITEMS).map((a, i) => (
                <Row key={`${a.kind}-${a.opportunityId}-${i}`} item={a} />
              ))}
            </ul>
            {result.data.attention.length > MAX_ITEMS ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Showing {MAX_ITEMS} of {result.data.attention.length}.{" "}
                <Link href="/sales/follow-ups" className="underline underline-offset-2 hover:text-foreground">
                  Open follow-ups
                </Link>
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
