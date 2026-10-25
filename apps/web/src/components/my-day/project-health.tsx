import Link from "next/link";
import { OsDonut } from "@/components/os/donut";
import type { Portfolio } from "@/lib/my-day/loaders";
import { cardLink, MyDayCard } from "./card-shell";

/**
 * Live projects grouped by two plain facts: a task marked blocked, or something past its due date. Not a score, not a forecast, and the
 * rule is printed on the card. Projects the viewer sees only as a summary have no tasks to read, so they are counted separately, not guessed.
 */
export function ProjectHealth({ portfolio }: { portfolio: Portfolio | "error" }) {
  const actions = <Link href="/projects" className={cardLink}>View projects</Link>;
  if (portfolio === "error") return <MyDayCard title="Project status" actions={actions}><p className="text-sm text-muted-foreground">Project status could not be loaded right now. Reload in a moment.</p></MyDayCard>;
  const { health, activeCount, summaryOnlyCount } = portfolio;
  const grouped = health.blocked + health.at_risk + health.on_track;
  const needLook = health.blocked + health.at_risk;
  return (
    <MyDayCard title="Project status" actions={actions} label="Project status by deadlines and blockers">
      {activeCount === 0 ? (
        <p className="text-sm text-muted-foreground">No live projects.</p>
      ) : grouped === 0 ? (
        <p className="text-sm text-muted-foreground">You can see {activeCount === 1 ? "this project" : "these projects"} only as a summary, so there are no tasks or milestones to group.</p>
      ) : (
        <OsDonut
          caption="Live projects by deadlines and blockers"
          segments={[
            { key: "on_track", label: "On track", value: health.on_track, color: "hsl(var(--fill-teal))" },
            { key: "at_risk", label: "At risk", value: health.at_risk, color: "hsl(var(--fill-amber))" },
            { key: "blocked", label: "Blocked", value: health.blocked, color: "hsl(var(--fill-red))" },
          ]}
          center={needLook === 0 ? <span className="px-3 text-sm font-semibold leading-tight">All on track</span> : <><span className="font-heading text-3xl font-semibold leading-none tabular-nums">{needLook}</span><span className="mt-0.5 text-[13px] text-muted-foreground">need a look</span></>}
        />
      )}
      <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">
        Blocked: a task is marked blocked. At risk: a task or milestone is past its due date. Otherwise on track.
        {summaryOnlyCount > 0 ? ` ${summaryOnlyCount} project${summaryOnlyCount === 1 ? "" : "s"} you see only as a summary ${summaryOnlyCount === 1 ? "is" : "are"} not grouped.` : ""}
      </p>
    </MyDayCard>
  );
}
