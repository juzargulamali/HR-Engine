import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProjectDayRow } from "@/lib/projects/my-day";

/**
 * The Projects part of My Day. Rendered only for people with Projects access when Projects & Tasks is installed (the caller passes
 * null otherwise and this shows nothing). Real counts only, from the same queries as My Work and the Projects overview.
 */
export function ProjectsToday({ rows }: { rows: ProjectDayRow[] | "error" | null }) {
  if (rows === null) return null;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Projects &amp; Tasks</CardTitle>
          <CardDescription>Your tasks, reviews, handovers and discussions.</CardDescription>
        </div>
        <Link href="/projects/work" className={buttonVariants({ variant: "outline", size: "sm" })}>Open My Work</Link>
      </CardHeader>
      <CardContent>
        {rows === "error" ? (
          <Alert variant="warning">Project work could not be loaded right now. Open My Work, or reload in a moment.</Alert>
        ) : rows.length === 0 ? (
          <EmptyState dense title="Nothing is waiting for you in Projects" description="Overdue tasks, reviews, handovers and unread discussion messages show here when there are any." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <Link href={r.href} className="min-w-0 break-words font-medium underline-offset-2 hover:underline">{r.label}</Link>
                <span className={`tabular-nums ${r.needsYou ? "font-semibold text-warning" : "text-muted-foreground"}`}>{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
