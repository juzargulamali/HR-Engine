import Link from "next/link";
import { AlertTriangle, CalendarClock, Check, ClipboardCheck, Flag, Hourglass, MapPin, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { dateText } from "@/lib/projects/format";
import { stripSteps, type StripMilestone } from "@/app/(app)/projects/[id]/work/helpers";
import type { AttentionItem, AttentionKind } from "@/lib/projects/work-attention";

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

const TONE_TEXT = { red: "text-[hsl(var(--os-red))]", amber: "text-[hsl(var(--os-amber))]", blue: "text-[hsl(var(--os-info))]", quiet: "text-muted-foreground" } as const;
const KIND_ICON: Record<AttentionKind, typeof AlertTriangle> = { blocker: AlertTriangle, review: ClipboardCheck, overdue: CalendarClock, due_today: CalendarClock, in_review: Hourglass, milestone: Flag, equipment: Package };

function AttentionRow({ a, recovery }: { a: AttentionItem; recovery?: React.ReactNode }) {
  const Icon = KIND_ICON[a.kind];
  return (
    <li className="flex items-start gap-2.5 py-2 text-sm">
      <Icon className={cn("mt-0.5 h-4 w-4 flex-none", TONE_TEXT[a.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="break-words">
          <span className={cn("font-semibold", TONE_TEXT[a.tone])}>{a.label}</span>
          <span className="text-muted-foreground"> · </span>
          <Link href={a.href} scroll={false} className="font-medium underline-offset-4 hover:underline">{a.title}</Link>
        </p>
        <p className="break-words text-[13px] text-muted-foreground">Owner: {a.owner} · {a.due ? `Due ${dateText(a.due)}` : "No due date recorded"}</p>
        {a.detail ? <p className="break-words text-[13px] text-muted-foreground">{a.detail}</p> : null}
        {recovery ? <div className="mt-1.5">{recovery}</div> : null}
      </div>
    </li>
  );
}

/**
 * The first thing on a project's Work page: what needs the person looking at it, and what is waiting on someone else, each with its owner, its due date (or that none is
 * recorded) and a link to the task or record. Every line is a recorded fact; when nothing is waiting it says so in one line. `importRecovery` is the existing "import the
 * handover equipment" control, shown under the failed-import line only.
 */
export function WorkAttention({ needsYou, waiting, importRecovery, max = 5 }: { needsYou: readonly AttentionItem[]; waiting: readonly AttentionItem[]; importRecovery?: React.ReactNode; max?: number }) {
  if (needsYou.length === 0 && waiting.length === 0) {
    return (
      <section aria-label="What needs doing" className="os-card px-4 py-3" data-testid="work-attention">
        <p className="text-sm"><span className="font-semibold">Nothing needs you right now.</span> <span className="text-muted-foreground">No blocker, review, overdue task or equipment decision is recorded for this project.</span></p>
      </section>
    );
  }
  const group = (title: string, items: readonly AttentionItem[], testid: string, empty: string) => (
    <div className="min-w-0" data-testid={testid}>
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title} <span className="tabular-nums">({items.length})</span></h3>
      {items.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="divide-y divide-border/70">
          {items.slice(0, max).map((a) => <AttentionRow key={a.key} a={a} recovery={a.recovery === "import" ? importRecovery : undefined} />)}
        </ul>
      )}
      {items.length > max ? <p className="pt-1 text-[13px] text-muted-foreground">Showing {max} of {items.length}. The task list below has the rest.</p> : null}
    </div>
  );
  return (
    <section aria-label="What needs doing" className="os-card os-warm px-4 py-3.5 sm:px-5" data-testid="work-attention">
      <h2 className="mb-2 font-heading text-base font-semibold">What needs doing</h2>
      <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">
        {group("Needs you", needsYou, "attention-needs-you", "Nothing needs you right now.")}
        {group("Waiting on someone else", waiting, "attention-waiting", "Nothing is waiting on anyone else.")}
      </div>
    </section>
  );
}

export interface SummaryFact { label: string; value: string; detail?: string | null; href: string; linkText: string; tone?: "red" | "amber" | "quiet" }

/** The Project Manager's delivery summary: the next milestone, the next site booking and the equipment decision, each from existing records with a link to where it is managed. */
export function DeliverySummary({ facts }: { facts: readonly SummaryFact[] }) {
  return (
    <section aria-label="Delivery summary" className="os-card px-4 py-3 sm:px-5" data-testid="delivery-summary">
      <h2 className="mb-2 font-heading text-base font-semibold">Delivery summary</h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[13px] text-muted-foreground">{f.label}</dt>
            <dd className="break-words text-sm">
              <span className={cn("block font-medium", f.tone === "red" ? TONE_TEXT.red : f.tone === "amber" ? TONE_TEXT.amber : undefined)}>{f.value}</span>
              {f.detail ? <span className="block text-[13px] text-muted-foreground">{f.detail}</span> : null}
              <Link href={f.href} className="mt-0.5 block w-fit text-[13px] font-medium text-accent underline-offset-4 hover:underline">{f.linkText}</Link>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The prominent way into the Project Plan from the Work overview: where the Project Manager breaks each technology into requirements, assigns, schedules and releases. */
export function ProjectPlanEntry({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  return (
    <section aria-label="Project Plan" className="os-card flex flex-wrap items-center justify-between gap-3 border-primary/40 px-4 py-3 sm:px-5" data-testid="project-plan-entry">
      <div className="min-w-0">
        <h2 className="font-heading text-base font-semibold">Project Plan</h2>
        <p className="text-sm text-muted-foreground">{canManage ? "Break each technology into what it needs, assign and schedule it, release it, and see what holds up delivery." : "See what each technology needs, who does it and by when."} Tasks you update here show in the plan, and the other way round.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/projects/${projectId}/delivery`} className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Open the Project Plan</Link>
        <Link href={`/projects/${projectId}/delivery?view=timeline`} className="text-sm font-medium text-accent underline-offset-4 hover:underline">Work schedule</Link>
      </div>
    </section>
  );
}

export interface ActivityLine { key: string; subject: string; sentence: string; when: string; who: string; href: string }

/**
 * A short preview of what last changed on the project (dates, status, people), each with a link to where that record lives. It is the member-visible change log, not the
 * conversation: chat messages and task comments are never copied here. `failed` = the read failed (it then says so; an empty list would be a different statement).
 */
export function RecentActivity({ lines, failed, historyHref }: { lines: readonly ActivityLine[]; failed: boolean; historyHref: string }) {
  return (
    <section aria-label="Recent activity" className="os-card p-4" data-testid="recent-activity">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">Recent activity</h2>
        <Link href={historyHref} className="text-[13px] font-medium text-accent underline-offset-4 hover:underline">Full history</Link>
      </div>
      {failed ? <p className="text-sm text-destructive" role="alert">Could not load the recent activity. Reload to try again; the full record is on History.</p>
        : lines.length === 0 ? <p className="text-sm text-muted-foreground">No change to dates, status or people is recorded yet.</p> : (
          <ul className="space-y-2.5">
            {lines.map((l) => (
              <li key={l.key} className="text-sm">
                <Link href={l.href} className="block break-words font-medium underline-offset-4 hover:underline">{l.subject}</Link>
                <p className="break-words text-[13px] text-muted-foreground">{l.sentence}</p>
                <p className="text-[13px] text-muted-foreground">{l.who} · {l.when}</p>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/** Direct ways into the parts of the project the work depends on, each with the fact that makes it relevant. Only the ones given are shown. */
export function WorkShortcuts({ items }: { items: readonly { href: string; label: string; note: string }[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Go to" className="os-card p-4" data-testid="work-shortcuts">
      <h2 className="mb-2 font-heading text-base font-semibold">Go to</h2>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.href} className="text-sm">
            <Link href={i.href} className="font-medium text-accent underline-offset-4 hover:underline">{i.label}</Link>
            <span className="block text-[13px] text-muted-foreground">{i.note}</span>
          </li>
        ))}
      </ul>
    </nav>
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
