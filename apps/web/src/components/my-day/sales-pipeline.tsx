import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { DueText } from "@/components/sales/badges";
import { formatDate } from "@/components/sales/format";
import type { SalesTodayResult } from "@/lib/crm/my-day";
import type { AttentionItem, AttentionKind } from "@/lib/crm/reports";
import { cardLink, MyDayCard } from "./card-shell";

const KIND_LABEL: Record<AttentionKind, string> = { overdue: "Overdue", due_today: "Due today", hold_review: "Hold review due", no_next_action: "No next action", no_first_response: "No first response" };
const MAX_ITEMS = 3;

function FollowUpRow({ item }: { item: AttentionItem }) {
  const isFollowUp = item.kind === "overdue" || item.kind === "due_today";
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
      <div className="min-w-0">
        <Link href={`/sales/opportunities/${item.opportunityId}`} className="break-words font-medium underline-offset-2 hover:underline">{item.title}</Link>
        <p className="text-[13px] text-muted-foreground">{item.reference} · {item.detail}</p>
      </div>
      <div className="text-right text-[13px]">
        {isFollowUp && item.at ? <DueText dueAt={item.at} /> : <span className="whitespace-nowrap font-medium text-warning">{KIND_LABEL[item.kind]}{item.kind === "hold_review" && item.at ? ` · ${formatDate(item.at)}` : ""}</span>}
      </div>
    </li>
  );
}

/**
 * The open pipeline by stage (counts, as on the Enquiries board) and the signed-in person's own follow-ups. Shown only with a Sales grant;
 * what is counted is whatever Sales access lets that person see. No values or currencies are read or shown here.
 */
export function SalesPipeline({ result }: { result: SalesTodayResult }) {
  if (result.status === "none") return null;
  const actions = <Link href="/sales/opportunities" className={cardLink}>View pipeline</Link>;
  if (result.status === "error") return <MyDayCard title="Sales pipeline" actions={actions}><p className="text-sm text-muted-foreground">The pipeline could not be loaded right now. Open Sales &amp; CRM, or reload in a moment.</p></MyDayCard>;
  const { pipeline, overdue, dueToday, noFirstResponse, opportunityCount, attention } = result.data;
  const stages = pipeline.filter((s) => s.stage !== "on_hold" || s.count > 0);
  const max = Math.max(1, ...stages.map((s) => s.count));
  const follow = [
    overdue > 0 ? { text: `${overdue} follow-up${overdue === 1 ? "" : "s"} overdue`, href: "/sales/follow-ups", warn: true } : null,
    dueToday > 0 ? { text: `${dueToday} due today`, href: "/sales/follow-ups?view=today", warn: false } : null,
    noFirstResponse > 0 ? { text: `${noFirstResponse} awaiting a first response`, href: "/sales/opportunities", warn: false } : null,
  ].filter((x): x is { text: string; href: string; warn: boolean } => x !== null);
  return (
    <MyDayCard title="Sales pipeline" actions={actions}>
      {opportunityCount === 0 ? (
        <p className="text-sm text-muted-foreground">No enquiries recorded yet. <Link href="/sales/new" className={cardLink}>Add the first enquiry</Link>.</p>
      ) : (
        <ul className="space-y-2.5" aria-label="Open enquiries by stage">
          {stages.map((s) => (
            <li key={s.stage} className="grid grid-cols-[minmax(6rem,9.5rem)_1fr_2rem] items-center gap-3 text-sm">
              <span className="truncate" title={s.label}>{s.label}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--foreground)/0.09)]" aria-hidden>
                <span className="block h-full rounded-full" style={{ width: `${(s.count / max) * 100}%`, background: s.stage === "on_hold" ? "hsl(var(--fill-amber))" : "linear-gradient(90deg, hsl(var(--fill-teal)), hsl(var(--fill-blue)))" }} />
              </span>
              <span className="text-right font-semibold tabular-nums">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
      {follow.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-border/70 pt-3 text-sm" aria-label="Your follow-ups">
          {follow.map((f) => (
            <li key={f.text}>
              <Link href={f.href} className="inline-flex items-center gap-1.5 hover:underline">
                {f.warn ? <AlertCircle className="h-4 w-4 text-[hsl(var(--fill-red))]" aria-hidden /> : null}
                <span className={f.warn ? "font-medium" : "text-muted-foreground"}>{f.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {attention.length > 0 ? (
        <div className="mt-3 border-t border-border/70 pt-1">
          <h3 className="sr-only">Your next follow-ups</h3>
          <ul className="divide-y divide-border/60">{attention.slice(0, MAX_ITEMS).map((a, i) => <FollowUpRow key={`${a.kind}-${a.opportunityId}-${i}`} item={a} />)}</ul>
          {attention.length > MAX_ITEMS ? <p className="pt-1 text-[13px] text-muted-foreground">Showing {MAX_ITEMS} of {attention.length}. <Link href="/sales/follow-ups" className={cardLink}>Open follow-ups</Link></p> : null}
        </div>
      ) : null}
    </MyDayCard>
  );
}
