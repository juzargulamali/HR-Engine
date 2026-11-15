import Link from "next/link";
import { MessageCircleQuestion, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/components/sales/format";
import { opsQuestionHref, type OpsQuestionCheck } from "@/lib/crm/ops-question";
import { DismissHandoverNotice } from "./dismiss-handover-notice";

/**
 * Sales Follow-ups: the questions Operations asked on the person's enquiries, one row per enquiry, each opening the question on the enquiry's Operations planning
 * panel. The row goes when Sales answers (the database clears the notice), when Operations withdraws the question, or when the person dismisses it. A failed read
 * says so; it never reads as "no questions".
 */
export function OpsQuestionAttention({ check }: { check: OpsQuestionCheck }) {
  if (check.status === "none") return null;
  if (check.status === "error") {
    return (
      <Card>
        <CardContent className="p-4">
          <p role="status" className="flex items-start gap-2 text-sm text-destructive" data-testid="ops-questions-error"><TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />Could not check whether Operations has asked you a question. Reload in a moment; a flagged enquiry shows any question under Operations planning.</p>
        </CardContent>
      </Card>
    );
  }
  if (check.rows.length === 0) return null;
  return (
    <Card data-testid="ops-questions">
      <CardContent className="space-y-2 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><MessageCircleQuestion className="h-4 w-4" aria-hidden />Questions from Operations <span className="font-normal text-muted-foreground">({check.rows.length})</span></h2>
        <ul className="divide-y divide-border">
          {check.rows.map((r) => (
            <li key={r.opportunityId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
              <div className="min-w-0">
                <Link href={opsQuestionHref(r.opportunityId)} className="break-words font-medium underline-offset-2 hover:underline" data-testid="ops-question-link">{r.title ?? r.reference}</Link>
                {r.title ? <span className="text-muted-foreground"> · {r.reference}</span> : null}
                <p className="text-[13px] text-muted-foreground">Operations asked a question on {formatDateTime(r.at)}. Open it to read and answer; Operations is told when you answer.</p>
              </div>
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="whitespace-nowrap font-medium text-[hsl(var(--os-amber))]">Waiting for your answer</span>
                <DismissHandoverNotice noticeId={r.noticeId} title={r.title ?? r.reference} what="question from Operations" />
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
