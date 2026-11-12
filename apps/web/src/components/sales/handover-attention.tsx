import Link from "next/link";
import { FileCheck2, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HANDOVER_KIND_LABEL, type HandoverRow } from "@/lib/crm/handover-attention";
import type { HandoverCheck } from "@/lib/crm/handover-attention-data";
import { DismissHandoverNotice } from "./dismiss-handover-notice";

/**
 * Sales Follow-ups: the handover rows for the person (and, for a Sales founder, for other owners' won enquiries). One row per enquiry, each opening that
 * enquiry's handover page. A failed read says so; it never reads as "nothing to do". "Handover accepted" is news: the person can dismiss their own copy
 * (it otherwise goes after seven days); rows that ask for something have no Dismiss.
 */
export function HandoverAttention({ check }: { check: HandoverCheck }) {
  if (check.status === "none") return null;
  if (check.status === "error") {
    return (
      <Card>
        <CardContent className="p-4">
          <p role="status" className="flex items-start gap-2 text-sm text-destructive"><TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />Could not check handovers. Reload in a moment; open a won enquiry&apos;s handover package to see its state.</p>
        </CardContent>
      </Card>
    );
  }
  if (check.rows.length === 0) return null;
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 className="h-4 w-4" aria-hidden />Handover <span className="font-normal text-muted-foreground">({check.rows.length})</span></h2>
        <ul className="divide-y divide-border">
          {check.rows.map((r: HandoverRow) => (
            <li key={`${r.kind}-${r.opportunityId}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
              <div className="min-w-0">
                <Link href={`/sales/opportunities/${r.opportunityId}/handover`} className="break-words font-medium underline-offset-2 hover:underline">{r.title}</Link>
                <span className="text-muted-foreground"> · {r.reference}</span>
                <p className="text-[13px] text-muted-foreground">{r.detail}</p>
              </div>
              <span className="flex flex-wrap items-center gap-x-2">
                <span className={r.kind === "handover_accepted" ? "whitespace-nowrap font-medium text-[hsl(var(--os-green))]" : "whitespace-nowrap font-medium text-[hsl(var(--os-amber))]"}>{HANDOVER_KIND_LABEL[r.kind]}{r.scope === "company" ? " · other owner" : ""}</span>
                {r.kind === "handover_accepted" && r.noticeId ? <DismissHandoverNotice noticeId={r.noticeId} title={r.title} /> : null}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
