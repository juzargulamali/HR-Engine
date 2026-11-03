import Link from "next/link";
import { ArrowRight, CheckCircle2, TriangleAlert } from "lucide-react";
import type { WorkGroup, WorkToday } from "@/lib/my-day/work-today";
import { cardLink, MyDayCard } from "./card-shell";

const GROUP_TITLE: Record<WorkGroup, string> = { overdue: "Overdue", today: "Due today", blocked: "Blocked", later: "Later" };
const GROUP_ORDER: WorkGroup[] = ["overdue", "today", "blocked", "later"];

/**
 * "My work today": the person's own open project tasks by title (assigned to them or shared with them), what is overdue, what is due today, what blocks them and
 * what comes next. Each title opens the task in the existing task panel. Nothing here repeats a count that another card states. A failed read says so.
 */
export function MyWorkToday({ work }: { work: WorkToday | "error" }) {
  if (work === "error") {
    return (
      <MyDayCard title="My work today" tone="cool" label="My work today">
        <Link href="/projects/work" className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <TriangleAlert className="h-4 w-4 flex-none" aria-hidden />
          <span className="min-w-0 flex-1 break-words">Your tasks could not be loaded. Open My Work to try again.</span>
        </Link>
      </MyDayCard>
    );
  }
  const summary = [work.overdue > 0 ? `${work.overdue} overdue` : null, work.dueToday > 0 ? `${work.dueToday} due today` : null, work.blocked > 0 ? `${work.blocked} blocked` : null].filter(Boolean).join(" · ");
  return (
    <MyDayCard title="My work today" tone="cool" label="My work today" actions={<Link href="/projects/work" className={cardLink}>All my work ({work.total})</Link>}>
      {work.rows.length === 0 ? (
        <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-green))]" aria-hidden />
          No open tasks assigned to you or shared with you.
        </p>
      ) : (
        <div className="space-y-3">
          {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
          {GROUP_ORDER.map((g) => {
            const rows = work.rows.filter((r) => r.group === g);
            if (rows.length === 0) return null;
            return (
              <div key={g}>
                <h3 className="mb-0.5 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{GROUP_TITLE[g]}</h3>
                <ul className="-mx-2 divide-y divide-border/60">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <Link href={r.href} className="group flex items-start gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--primary)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-medium">{r.title}</span>
                          <span className="block break-words text-[13px] text-muted-foreground">
                            {r.project} · <span className={r.overdue ? "font-medium text-destructive" : undefined}>{r.dueText}</span>
                          </span>
                          {r.blocked ? (
                            <span className="mt-0.5 block break-words text-[13px] text-[hsl(var(--os-amber))]">
                              Blocked: {r.blocked.reason}
                              {r.blocked.unblockBy ? ` · ${r.blocked.unblockBy} can unblock it` : ""}
                            </span>
                          ) : null}
                        </span>
                        <ArrowRight className="mt-0.5 h-4 w-4 flex-none text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </MyDayCard>
  );
}
