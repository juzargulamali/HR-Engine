import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { InfoHint } from "@/components/ui/info-hint";
import { Panel } from "@/components/projects/parts";
import { formatDateTime } from "@/lib/projects/format";
import { CHECK_NOT_RESERVED, formatInZone, type ProjectCheckView } from "@/lib/inventory/planning";
import { groupByRun, runStateWords, type RunCoverRow } from "@/lib/inventory/runs";
import type { Read } from "@/lib/inventory/job-data";
import { cn } from "@/lib/utils";
import { TONE_BADGE, TONE_TEXT } from "./planning/status";

/**
 * Two read-only panels of one equipment job that the project and Operations screens share (Inventory Phase 1). Both read what the database derives from the same
 * requests, reservations and movements the warehouse works with; neither stores a status of its own. A failed read says it could not load; a database without the
 * Phase 1 update shows nothing.
 */

/** The availability check recorded on the enquiry this project came from: what Sales was told, and what changed since. */
export function ProjectAvailabilityCheck({ check, equipmentHref }: { check: Read<ProjectCheckView>; equipmentHref?: string }) {
  if (check.state === "not_installed" || check.state === "none") return null;
  if (check.state === "error") {
    return <Panel title="Availability check from Sales"><Alert variant="destructive" role="alert">The availability check recorded on the enquiry could not be loaded. Reload to try again. It does not mean no check was made.</Alert></Panel>;
  }
  const v = check.value;
  if (v.state === "no_enquiry") return null;
  const flagged = v.review.length > 0;
  return (
    <Panel
      id="sales-availability-check" title="Availability check from Sales"
      hint="What the warehouse found when Sales asked, before the job was won. It is the starting point for the equipment request below, not a booking."
      className={flagged ? "border-[hsl(var(--os-amber)/0.5)]" : undefined}
    >
      <div className="space-y-3 text-sm" data-testid="project-sales-check" data-review={flagged ? "true" : "false"}>
        {v.state === "none" ? <p>No availability check was recorded on enquiry {v.enquiryReference ?? ""} before it was won. The warehouse answers on the equipment request itself.</p> : null}
        {v.state === "pending" ? <p>Sales asked the warehouse for a check on enquiry {v.enquiryReference ?? ""}, and it was not answered before the job was won. The warehouse answers on the equipment request itself.</p> : null}
        {v.state === "checked" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1 font-semibold">{CHECK_NOT_RESERVED}
                <InfoHint label="availability checked">A check is a dated statement about stock for the dates of the enquiry. Nothing was held. Stock is reserved only when the warehouse reserves it for the equipment request of this project.</InfoHint>
              </p>
              <Badge variant="outline" className={cn("whitespace-nowrap", TONE_BADGE[v.tone])}>{v.headline}</Badge>
            </div>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Enquiry</dt><dd>{v.enquiryReference ?? "Not shown"}</dd></div>
              <div><dt className="text-muted-foreground">Checked</dt><dd>{v.checkedAt ? formatDateTime(v.checkedAt) : "Date not recorded"}{v.checkedBy ? ` by ${v.checkedBy}` : ""}</dd></div>
              <div><dt className="text-muted-foreground">Warehouse</dt><dd>{v.locationName ?? "Not recorded"}</dd></div>
              <div><dt className="text-muted-foreground">Proposed dates checked</dt><dd>{v.coversRange ?? "The enquiry had no dates when it was checked"}</dd></div>
            </dl>
            {v.note ? <p className="text-muted-foreground">Note from the warehouse: {v.note}</p> : null}
            {v.rows.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border border-border">
                {v.rows.map((r, i) => (
                  <li key={`${r.name}-${i}`} className="px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="min-w-0 break-words font-medium">{r.name}{r.qty ? <span className="font-normal text-muted-foreground"> × {r.qty}</span> : null}</span>
                      <span className={cn("font-medium", TONE_TEXT[r.tone])}>{r.status}</span>
                    </div>
                    {r.shortages.map((sh) => <p key={sh} className="text-muted-foreground">{sh}</p>)}
                  </li>
                ))}
              </ul>
            ) : null}
            {flagged ? (
              <Alert variant="warning" role="status" data-testid="project-sales-check-review">
                <p className="font-medium">Review this check: the project has changed since it was made.</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{v.review.map((t) => <li key={t}>{t}</li>)}</ul>
                <p className="mt-1">The check is kept as it was recorded. What the warehouse can cover now is answered on the equipment request, when it reserves{equipmentHref ? <> (<Link href={equipmentHref} className="font-medium underline underline-offset-2">open the requests</Link>)</> : null}.</p>
              </Alert>
            ) : <p className="text-muted-foreground">The dates, the equipment and the warehouse of the project are the ones this check covered.</p>}
          </>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Each site run with the equipment request (or requests) that serves it: the request's state in the warehouse's own words, the quantities, and what is wrong
 * for THAT run, with how many and who acts. Used on the project's Equipment tab (one project) and on the Operations Overview (every live project of a company).
 */
export function RunEquipmentList({ rows, projectId, timezone }: { rows: readonly RunCoverRow[]; projectId: string; timezone?: string }) {
  const groups = groupByRun(rows);
  if (groups.length === 0) return null;
  return (
    <ul className="space-y-3" data-testid={`run-equipment-${projectId}`}>
      {groups.map((g) => (
        <li key={g.runId} className="rounded-md border border-border p-3 text-sm" data-run={g.runTitle} data-exceptions={g.exceptions.length}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="font-semibold">{g.runTitle}</p>
            <p className="text-muted-foreground">{g.runStart ? `${formatInZone(g.runStart, timezone ?? g.rows[0]?.timezone ?? "UTC")}${g.runEnd ? ` to ${formatInZone(g.runEnd, timezone ?? g.rows[0]?.timezone ?? "UTC")}` : ""}` : "No date yet"}</p>
          </div>
          <ul className="mt-1.5 space-y-1">
            {g.rows.map((r) => (
              <li key={r.requestId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Link href={`/projects/${projectId}/equipment?request=${r.requestId}`} className="font-mono font-medium text-accent underline-offset-4 hover:underline">{r.requestCode}</Link>
                <Badge variant={r.problems.some((p) => p !== "run_not_dated" && p !== "request_not_dated") ? "warning" : "outline"}>{runStateWords(r.state)}</Badge>
                <span className="text-muted-foreground">requested {r.unitsAsked} · sent {r.unitsDispatched} · back {r.unitsReturned} · out {r.unitsOut}{r.unitsShort > 0 ? ` · short ${r.unitsShort}` : ""}</span>
              </li>
            ))}
          </ul>
          {g.exceptions.length > 0 ? (
            <ul className="mt-2 space-y-1" aria-label={`What needs attention for ${g.runTitle}`}>
              {g.exceptions.map((t) => <li key={t} className="flex items-start gap-1.5 font-medium text-[hsl(var(--os-amber))]"><span aria-hidden>⚠</span><span>{t}</span></li>)}
            </ul>
          ) : <p className="mt-2 text-muted-foreground">Nothing needs attention for this run.</p>}
        </li>
      ))}
    </ul>
  );
}

export function RunEquipmentPanel({ cover, projectId, siteScheduleHref }: { cover: Read<RunCoverRow[]>; projectId: string; siteScheduleHref?: string }) {
  if (cover.state === "not_installed" || cover.state === "none") return null;
  return (
    <Panel id="run-equipment" title="Equipment by site run" hint="Each site run with the request that serves it. The state and the quantities are read from the warehouse's own records; when one request serves two runs, the same equipment stays out between them.">
      {cover.state === "error" ? <Alert variant="destructive" role="alert">The equipment status of each site run could not be loaded. Reload to try again; the requests below are still shown.</Alert>
        : cover.value.length === 0 ? <p className="text-sm text-muted-foreground">No request is linked to a site run yet. Open a request below and tick the site runs it serves{siteScheduleHref ? <> (<Link href={siteScheduleHref} className="underline underline-offset-2">Site schedule</Link>)</> : null}.</p>
        : <RunEquipmentList rows={cover.value} projectId={projectId} />}
    </Panel>
  );
}
