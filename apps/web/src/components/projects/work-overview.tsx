import Link from "next/link";
import { CalendarClock, History, TriangleAlert } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { Muted } from "@/components/projects/parts";
import { activityWhen, ACTIVITY_KIND_LABELS, ATTENTION_KIND_LABELS, attentionHref, formatAt, pickAttention, recentText, type WorkOverview } from "@/lib/projects/phase2/model";

/**
 * Three concise areas at the top of the Work page, each linking to the records behind it (nothing here is a copy): Next on site (the next recorded activity, with its date or time window,
 * owner and Tentative / Confirmed state), Needs attention (what someone has to do, and who can) and Recent changes (a new output version, a review decision, a confirmed date).
 */
export function WorkOverviewAreas({ projectId, overview }: { projectId: string; overview: WorkOverview }) {
  const next = overview.next_on_site;
  const attention = overview.attention;
  const { shown, more } = pickAttention(attention);
  return (
    <section aria-label="Project overview" className="grid items-start gap-3 lg:grid-cols-3" data-testid="work-overview">
      <div className="os-card p-4" data-testid="overview-next">
        <h2 className="mb-2 flex items-center gap-2 font-heading text-base font-semibold"><CalendarClock className="h-4 w-4 text-accent" aria-hidden /> Next on site</h2>
        {next ? (
          <div className="space-y-0.5 text-sm">
            <p className="break-words font-medium">{next.title}{next.run_label ? <span className="font-normal text-muted-foreground"> · {next.run_label}</span> : null}</p>
            <p className="break-words text-[13px]" data-testid="overview-next-when">{activityWhen(next, overview.tz)}</p>
            <p className="break-words text-[13px] text-muted-foreground">{next.kind ? ACTIVITY_KIND_LABELS[next.kind] : "Activity"} · {next.location ?? "No location"} · Owner {next.owner_name ?? "not named"}</p>
            <p className="pt-1"><OsBadge tone={next.state === "confirmed" ? "green" : "amber"}>{next.state === "confirmed" ? "Confirmed" : "Tentative"}</OsBadge></p>
            <Link href={`/projects/${projectId}/plan?plan=site&mode=list#site-${next.id}`} className="inline-block pt-1 text-[13px] font-medium text-accent underline-offset-4 hover:underline">Open the site schedule</Link>
          </div>
        ) : <Muted>Nothing is recorded on the site schedule yet. <Link href={`/projects/${projectId}/plan?plan=site&mode=list`} className="underline underline-offset-2">Open the site schedule</Link>.</Muted>}
      </div>

      <div className="os-card p-4" data-testid="overview-attention">
        <h2 className="mb-2 flex items-center gap-2 font-heading text-base font-semibold"><TriangleAlert className="h-4 w-4 text-[hsl(var(--os-amber))]" aria-hidden /> Needs attention{attention.length > 0 ? <span className="text-[13px] font-normal text-muted-foreground">({attention.length})</span> : null}</h2>
        {attention.length === 0 ? <Muted>Nothing is waiting: no required output is missing, no review is waiting, the site plan has what it needs and no shipment conflicts.</Muted> : (
          <ul className="space-y-2">
            {shown.map((a, n) => (
              <li key={`${a.kind}-${a.task_id ?? a.activity_id ?? a.shipment_id}-${n}`} className="text-sm" data-testid={`attention-${a.kind}`}>
                <p className="break-words"><Link href={attentionHref(projectId, a)} className="font-medium underline-offset-4 hover:underline">{a.title}</Link> <span className="text-[13px] text-muted-foreground">· {ATTENTION_KIND_LABELS[a.kind]}</span></p>
                <p className="break-words text-[13px]">{a.detail}</p>
                {a.who.length > 0 ? <p className="break-words text-[13px] text-muted-foreground">Who can act: {a.who.join(", ")}</p> : null}
              </li>
            ))}
            {more > 0 ? <li className="text-[13px] text-muted-foreground">And {more} more: open the Deliverables view or the site schedule.</li> : null}
          </ul>
        )}
      </div>

      <div className="os-card p-4" data-testid="overview-recent">
        <h2 className="mb-2 flex items-center gap-2 font-heading text-base font-semibold"><History className="h-4 w-4 text-accent" aria-hidden /> Recent changes</h2>
        {overview.recent.length === 0 ? <Muted>No new output version, review decision or site date has been recorded yet.</Muted> : (
          <ul className="space-y-2">
            {overview.recent.slice(0, 5).map((r, n) => (
              <li key={`${r.entity_id}-${r.at}-${n}`} className="text-sm">
                <p className="break-words">{recentText(r)}</p>
                <p className="text-[13px] text-muted-foreground">{formatAt(r.at, overview.tz)}</p>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/projects/${projectId}/history`} className="mt-2 inline-block text-[13px] font-medium text-accent underline-offset-4 hover:underline">Full history</Link>
      </div>
    </section>
  );
}
