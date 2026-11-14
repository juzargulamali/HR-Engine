import Link from "next/link";
import { OsDonut } from "@/components/os/donut";
import { InfoHint } from "@/components/ui/info-hint";
import type { Portfolio } from "@/lib/my-day/loaders";
import { cardLink, MyDayCard } from "./card-shell";

/** The card's name says what is measured: tasks and milestones only (classifyProjects in lib/my-day/portfolio.ts). It is not the project's own status, which lives on Projects. */
export const HEALTH_TITLE = "Task & milestone health";
const HEALTH_LABEL = "Task & milestone health by deadlines and blockers";

/**
 * Live projects grouped by two plain facts: a task marked blocked, or something past its due date. Not a score, not a forecast, and the
 * rule is printed on the card (the full definition is behind the ⓘ). Projects the viewer sees only as a summary have no tasks to read, so they are counted separately, not guessed.
 */
export function ProjectHealth({ portfolio }: { portfolio: Portfolio | "error" }) {
  const actions = (
    <>
      <InfoHint label="task and milestone health" testId="project-health-hint">
        <p>Each live project is in one group, decided only by its tasks and milestones.</p>
        <p className="mt-1.5"><strong>Blocked</strong>: an open task is marked blocked.</p>
        <p className="mt-1.5"><strong>At risk</strong>: an open task or an open milestone is past its due date.</p>
        <p className="mt-1.5"><strong>On track</strong>: neither of those.</p>
        <p className="mt-1.5">It is a count, not a score or a forecast. Equipment, site work, budget and the project&apos;s own status (planning, on hold and so on) are not part of it.</p>
      </InfoHint>
      <Link href="/projects" className={cardLink}>View projects</Link>
    </>
  );
  if (portfolio === "error") return <MyDayCard title={HEALTH_TITLE} actions={actions}><p className="text-sm text-muted-foreground">Task and milestone health could not be loaded right now. Reload in a moment.</p></MyDayCard>;
  const { health, activeCount, summaryOnlyCount } = portfolio;
  const grouped = health.blocked + health.at_risk + health.on_track;
  const needLook = health.blocked + health.at_risk;
  return (
    <MyDayCard title={HEALTH_TITLE} actions={actions} label={HEALTH_LABEL}>
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
