import Link from "next/link";
import { AlertTriangle, CalendarClock, Check, ClipboardCheck, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { dateText } from "@/lib/projects/format";
import { stripSteps, type StripMilestone } from "@/app/(app)/projects/[id]/work/helpers";

/**
 * Presentational pieces of a project's Work page. Every figure arrives already counted from the project's real records by the page;
 * nothing here estimates, so an empty input renders nothing (or a plain "none") rather than a made-up value.
 */

const STATUS_WORDS: Record<string, string> = {
  planned: "Planned", in_progress: "In progress", ready_for_acceptance: "Ready for acceptance", accepted: "Accepted", deferred: "Deferred",
};

/**
 * The milestones of the project in order, with where it stands: done, the one coming next, late ones in amber. On a phone it is a plain
 * vertical list. `basis` is the sentence the progress figure rests on (accepted required milestones), shown as written.
 */
export function MilestoneStrip({ milestones, today, basis, percent, manageHref, max = 6 }: { milestones: readonly StripMilestone[]; today: string; basis: string | null; percent: number | null; manageHref: string; max?: number }) {
  const steps = stripSteps(milestones, today);
  if (steps.length === 0) return null;
  if (steps.length === 1) {
    // One milestone does not need a strip: a single quiet row says what it is, when, and where it stands.
    const { m, state } = steps[0]!;
    return (
      <section aria-label="Milestones" className="os-card flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
        <span className="os-node flex-none" data-state={state === "later" ? undefined : state}>
          {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
          {state === "late" ? <AlertTriangle className="h-3 w-3 text-[hsl(var(--os-amber))]" aria-hidden /> : null}
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-semibold" title={m.title}><span className="font-normal text-muted-foreground">Milestone · </span>{m.title}</p>
          <p className={cn("text-[13px]", state === "late" ? "font-medium text-[hsl(var(--os-amber))]" : "text-muted-foreground")}>
            {state === "late" ? "Overdue · " : ""}{m.dueDate ? dateText(m.dueDate) : "No date"} · {STATUS_WORDS[m.status] ?? m.status}{m.isRequired ? "" : " · optional"}{basis ? ` · ${basis}` : ""}
          </p>
        </div>
        <Link href={manageHref} className="text-sm font-medium text-accent underline-offset-4 hover:underline">Manage milestones</Link>
      </section>
    );
  }
  // Keep the next one in view when there are more than fit: show it and the ones around it, always the last accepted before it.
  const firstOpen = steps.findIndex((s) => s.state !== "done");
  const start = steps.length <= max ? 0 : Math.min(Math.max(0, (firstOpen === -1 ? steps.length : firstOpen) - 1), steps.length - max);
  const shown = steps.slice(start, start + max);
  const hidden = steps.length - shown.length;
  return (
    <section aria-label="Milestones" className="os-card px-4 py-3.5 sm:px-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-heading text-base font-semibold">Upcoming milestones</h2>
        <div className="flex flex-wrap items-baseline gap-x-3 text-sm text-muted-foreground">
          {basis ? <span>{basis}{percent !== null ? ` (${percent}%)` : ""}</span> : <span>No required milestone yet</span>}
          <Link href={manageHref} className="font-medium text-accent underline-offset-4 hover:underline">{hidden > 0 ? `View all ${steps.length}` : "Manage milestones"}</Link>
        </div>
      </div>
      <ol className="flex flex-col gap-3 sm:flex-row sm:gap-0">
        {shown.map(({ m, state }, i) => (
          <li key={m.id} className="os-step flex items-start gap-3 sm:flex-col sm:gap-2">
            <div className="flex items-center sm:w-full">
              <span className="os-node" data-state={state === "later" ? undefined : state}>
                {state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                {state === "late" ? <AlertTriangle className="h-3 w-3 text-[hsl(var(--os-amber))]" aria-hidden /> : null}
              </span>
              {i < shown.length - 1 ? <span className="os-rail hidden sm:block" data-done={state === "done" ? "true" : "false"} aria-hidden /> : null}
            </div>
            <div className="min-w-0 pr-3">
              <p className="truncate text-sm font-semibold" title={m.title}>{m.title}</p>
              <p className={cn("text-[13px]", state === "late" ? "font-medium text-[hsl(var(--os-amber))]" : "text-muted-foreground")}>
                {state === "late" ? "Overdue · " : ""}{m.dueDate ? dateText(m.dueDate) : "No date"}
              </p>
              <p className="text-[13px] text-muted-foreground">{STATUS_WORDS[m.status] ?? m.status}{m.isRequired ? "" : " · optional"}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export interface ActionItem { key: string; href: string; title: string; detail: string; tone: "red" | "amber" | "blue" }

const ACTION_ICON = { red: AlertTriangle, amber: CalendarClock, blue: ClipboardCheck } as const;

/** What most needs someone's hand on this project, in order: blocked tasks, work waiting for the viewer's review, overdue milestones. Hidden when there is none. */
export function NextActionCard({ items, total }: { items: readonly ActionItem[]; total: number }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Needs action" className="os-card os-warm p-4">
      <h2 className="mb-2 font-heading text-base font-semibold">Needs action</h2>
      <ul className="space-y-2.5">
        {items.map((a) => {
          const Icon = ACTION_ICON[a.tone];
          return (
            <li key={a.key} className="flex items-start gap-2.5 text-sm">
              <Icon className={cn("mt-0.5 h-4 w-4 flex-none", a.tone === "red" ? "text-[hsl(var(--os-red))]" : a.tone === "amber" ? "text-[hsl(var(--os-amber))]" : "text-[hsl(var(--os-info))]")} aria-hidden />
              <div className="min-w-0">
                <Link href={a.href} scroll={false} className="block break-words font-medium underline-offset-4 hover:underline">{a.title}</Link>
                <p className="break-words text-[13px] text-muted-foreground">{a.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {total > items.length ? <p className="mt-2.5 text-[13px] text-muted-foreground">Showing {items.length} of {total}.</p> : null}
    </section>
  );
}

export interface SiteBooking { id: string; location: string; startsAt: string; endsAt: string; state: string; who: string }

/** The next site booking that has not ended, with its place, time and who is going. Hidden when none is booked. */
export function NextOnSiteCard({ booking, count, href, when }: { booking: SiteBooking | null; count: number; href: string; when: string }) {
  if (!booking) return null;
  return (
    <section aria-label="Next on site" className="os-card p-4">
      <h2 className="mb-2 font-heading text-base font-semibold">Next on site</h2>
      <div className="flex items-start gap-2.5 text-sm">
        <MapPin className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden />
        <div className="min-w-0">
          <p className="break-words font-medium">{booking.location}</p>
          <p className="text-[13px] text-muted-foreground">{when}</p>
          <p className="text-[13px] text-muted-foreground">{booking.who} · {booking.state === "confirmed" ? "Confirmed" : "Tentative"}</p>
        </div>
      </div>
      <Link href={href} className="mt-2.5 inline-block text-[13px] font-medium text-accent underline-offset-4 hover:underline">{count > 1 ? `View all ${count} site bookings` : "Open site plan"}</Link>
    </section>
  );
}
