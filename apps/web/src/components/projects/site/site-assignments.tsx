import { OsBadge } from "@/components/os/pills";
import { ScrollIntoViewOnMount } from "@/components/projects/site/site-scroll";
import { ACTIVITY_KIND_LABELS, CREW_ROLE_LABELS, EFFECTIVE_LABELS, effectiveReadyText, effectiveTone, type EffectiveReadiness, type EffectiveState } from "@/lib/projects/phase2/model";
import { assignmentWhen, callWord, contactWord, hardwareStateWord, needsProvisionalNote, projectReadyText, reportingText, venueWord, type SiteAssignment, type SiteChangeNote } from "@/lib/projects/site-assignments";
import { describeSitePhase, provisionalPassedText } from "@/lib/projects/site-state";

/** The readiness shown for the day: the joined view when the database sent it, else the hand-entered values (an older read). */
function readinessOf(a: SiteAssignment): EffectiveReadiness {
  if (a.ready_effective) return a.ready_effective;
  const one = (l: string) => ({ state: (l === "unknown" ? "not_recorded" : l) as EffectiveState, source: l === "unknown" ? null : ("pm" as const) });
  return { hardware: one(a.ready.hardware), content: one(a.ready.content), app: one(a.ready.app), note: a.ready.note };
}

const TONE_TEXT = { green: "text-[hsl(var(--os-green))]", amber: "text-[hsl(var(--os-amber))]", blue: "text-[hsl(var(--os-info))]", quiet: "text-muted-foreground" } as const;

/**
 * One card per assignment, ordered for a phone: where the activity stands and whether the reporting details are complete, then the call time, the venue and who to ask, and only then the
 * instructions and readiness. Everything comes from the scoped read; nothing links into the project, because a site-only technician has no access to it.
 * `highlightId` marks the card a change notice linked to; `changes` are that person's unread "previous → new" notices, shown on the card they belong to.
 */
export function SiteAssignmentList({ rows, highlightId, changes }: { rows: SiteAssignment[]; highlightId?: string | null; changes?: Record<string, SiteChangeNote[]> }) {
  return (
    <ul className="space-y-3" data-testid="site-assignments">
      {rows.map((a) => {
        const state = describeSitePhase(a.phase);
        const reporting = reportingText(a);
        const contact = contactWord(a);
        const moved = changes?.[a.activity_id] ?? [];
        const focus = highlightId === a.activity_id;
        return (
          <li key={a.assignment_id} id={`sa-${a.activity_id}`} className={`os-card scroll-mt-24 space-y-2 p-4 ${focus ? "ring-2 ring-[hsl(var(--primary))]" : ""}`} data-testid={`site-assignment-${a.activity_id}`} data-highlighted={focus ? "true" : undefined}>
            {focus ? <ScrollIntoViewOnMount /> : null}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-medium">{a.title}{a.run_label ? <span className="font-normal text-muted-foreground"> · {a.run_label}</span> : null}</p>
                <p className="break-words text-[13px] text-muted-foreground">{a.kind ? ACTIVITY_KIND_LABELS[a.kind] : "Activity"} · {a.project_name}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <OsBadge tone="blue">{CREW_ROLE_LABELS[a.role]}</OsBadge>
                <OsBadge tone={a.state === "confirmed" ? "green" : "amber"}>{a.state === "confirmed" ? "Confirmed" : "Tentative"}</OsBadge>
              </div>
            </div>
            {moved.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-sm" role="status" data-testid="sa-changed">
                {moved.map((c) => <p key={c.field} className="break-words"><span className="font-medium">Changed: {c.field}</span> · {c.from} → {c.to}</p>)}
              </div>
            ) : null}
            {a.phase ? (
              <div className="space-y-0.5 text-sm" data-testid="sa-status">
                <p className={`break-words font-medium ${TONE_TEXT[state.tone]}`} data-testid="sa-phase">{state.label}</p>
                {reporting.text ? <p className={`break-words text-[13px] ${reporting.complete ? "text-muted-foreground" : "font-medium text-[hsl(var(--os-amber))]"}`} data-testid="sa-reporting">{reporting.complete ? "" : "⚠ "}{reporting.text}</p> : null}
                {needsProvisionalNote(a) ? <p className="break-words text-[13px] font-medium" role="status" data-testid="sa-provisional">{provisionalPassedText(a.contact?.name)}</p> : null}
              </div>
            ) : null}
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="text-[13px] text-muted-foreground">Your call time</dt><dd className="break-words font-medium" data-testid="sa-call">{callWord(a)}</dd></div>
              <div><dt className="text-[13px] text-muted-foreground">Venue</dt><dd className="break-words" data-testid="sa-venue">{venueWord(a)}</dd></div>
              <div><dt className="text-[13px] text-muted-foreground">When</dt><dd className="break-words font-medium" data-testid="sa-when">{assignmentWhen(a)}</dd></div>
              {contact ? <div><dt className="text-[13px] text-muted-foreground">Who to ask</dt><dd className="break-words" data-testid="sa-contact">{contact}</dd></div> : null}
            </dl>
            {a.instructions || a.crew_instructions ? (
              <div className="space-y-1 text-sm" data-testid="sa-instructions">
                <p className="text-[13px] text-muted-foreground">Instructions</p>
                {a.instructions ? <p className="whitespace-pre-wrap break-words">{a.instructions}</p> : null}
                {a.crew_instructions ? <p className="whitespace-pre-wrap break-words">{a.crew_instructions}</p> : null}
              </div>
            ) : null}
            <div className="space-y-1" data-testid="sa-ready">
              <p className="text-[13px] text-muted-foreground">Ready for this run</p>
              {(() => {
                const r = readinessOf(a);
                const project = projectReadyText(a.ready_effective);
                return (
                  <>
                    <p className="flex flex-wrap items-center gap-1.5 text-sm">
                      {(["hardware", "content", "app"] as const).map((k) => (
                        <span key={k} title={effectiveReadyText(r[k])}><OsBadge tone={effectiveTone(r[k].state)}>{k === "app" ? "App" : k === "hardware" ? "Hardware" : "Content"}: {EFFECTIVE_LABELS[r[k].state].toLowerCase()}</OsBadge></span>
                      ))}
                    </p>
                    <ul className="text-[13px] text-muted-foreground" data-testid="sa-ready-detail">
                      {(["hardware", "content", "app"] as const).filter((k) => r[k].detail || r[k].source === "plan" || r[k].source === "run").map((k) => <li key={k}>{k === "app" ? "App" : k === "hardware" ? "Hardware" : "Content"}: {effectiveReadyText(r[k])}</li>)}
                    </ul>
                    {hardwareStateWord(a.hardware_state) ? <p className="text-[13px] text-muted-foreground">Equipment, from the warehouse: {hardwareStateWord(a.hardware_state)}</p> : null}
                    {r.note ? <p className="break-words text-sm">{r.note}</p> : null}
                    {project ? <p className="break-words text-[13px] text-muted-foreground" data-testid="sa-project-ready">{project}</p> : null}
                  </>
                );
              })()}
            </div>
            {a.site_only ? <p className="text-[13px] text-muted-foreground" data-testid="sa-site-only">You are assigned to this activity only. The project&apos;s chat, tasks, files and reviews are not part of it.</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
