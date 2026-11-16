import Link from "next/link";
import { OsBadge, type OsTone } from "@/components/os/pills";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/components/sales/format";
import { KIND_LABEL, STATE_LABEL, type QueueItem, type QueueState } from "@/lib/hr/queue";
import { cn } from "@/lib/utils";
import { AcknowledgeItemForm } from "./acknowledge-item-form";

const STATE_TONE: Record<QueueState, OsTone> = { needs_action: "red", due_soon: "amber", acknowledged: "blue" };

/** How far the date is, in the same words every view uses; an acknowledged item that is still open says so. */
export function dueText(i: QueueItem): string | null {
  if (i.days === null || !i.dueDate) return null;
  const when = formatDate(i.dueDate);
  if (i.urgency === "attention") return `Dated ${when}`;
  if (i.days < 0) return `${when} · ${-i.days === 1 ? "1 day" : `${-i.days} days`} overdue`;
  if (i.days === 0) return `${when} · today`;
  return `${when} · in ${i.days === 1 ? "1 day" : `${i.days} days`}`;
}

/**
 * One queue section as readable stacked rows (no table, so nothing scrolls sideways on a phone): the employee and company first, the issue, the date and status, who acts next, and one
 * direct action. `empty` is shown only for a successful read with nothing in the section; a failed read never reaches this component as "no items".
 */
export function QueueList({ title, hint, items, empty, tone, from }: { title: string; hint?: React.ReactNode; items: readonly QueueItem[]; empty: string | null; tone: QueueState; from: string }) {
  return (
    <section aria-labelledby={`q-${tone}`} className="space-y-3" data-testid={`queue-${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`q-${tone}`} className="text-lg font-semibold">{title}</h2>
        <OsBadge tone={STATE_TONE[tone]}>{items.length}</OsBadge>
        {hint}
      </div>
      {items.length === 0 ? (
        empty ? <EmptyState dense title={empty} /> : null
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((i) => (
            <li key={i.key} className="space-y-2 px-3 py-3" data-testid={`queue-item-${i.key}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium">{i.employeeName ?? KIND_LABEL[i.kind]}</span>
                {i.companyName ? <span className="text-sm text-muted-foreground">{i.companyName}</span> : null}
              </div>
              <p className="text-sm">{i.issue}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <OsBadge tone={STATE_TONE[i.state]} dot>{STATE_LABEL[i.state]}</OsBadge>
                <OsBadge tone="neutral">{KIND_LABEL[i.kind]}</OsBadge>
                {dueText(i) ? <span className={cn(i.urgency === "overdue" ? "font-medium text-destructive" : "text-muted-foreground")}>{dueText(i)}</span> : null}
              </div>
              {i.state === "acknowledged" ? (
                <p className="text-sm text-muted-foreground">
                  {i.acknowledged ? `Seen ${formatDate(i.acknowledged.at.slice(0, 10))}${i.acknowledged.note ? `: ${i.acknowledged.note}` : ""}. ` : ""}
                  {i.urgency === "overdue" ? "Still open: this needs action until the record is fixed." : i.urgency === "due_soon" ? "Still coming up: the record is not fixed yet." : "Still open until the record is fixed."}
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">Acts next: {i.actsNext}</p>
              <div className="flex flex-wrap items-start gap-3 pt-1">
                <Link href={withFrom(i.href, from)} className={buttonVariants({ size: "sm" })} data-testid={`queue-action-${i.key}`}>{i.actionLabel}</Link>
                {i.canAcknowledge && i.kind !== "ai_suggestion" ? <AcknowledgeItemForm kind={i.kind} sourceId={i.sourceId} sourceDate={i.sourceDate ?? ""} employeeId={i.employeeId} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The record knows it was opened from the queue (`from=alerts`), so it can offer the way back to the same company, view and filters. */
export function withFrom(href: string, from: string): string {
  const [path, rest] = href.split("#")[0]!.split("?");
  const hash = href.includes("#") ? `#${href.split("#")[1]}` : "";
  const p = new URLSearchParams(rest ?? "");
  p.set("from", from);
  return `${path}?${p.toString()}${hash}`;
}
