import { OsBadge } from "@/components/os/pills";
import { ACTIVITY_KIND_LABELS, CREW_ROLE_LABELS, EFFECTIVE_LABELS, effectiveReadyText, effectiveTone, type EffectiveReadiness, type EffectiveState } from "@/lib/projects/phase2/model";
import { assignmentWhen, callWord, hardwareStateWord, venueWord, type SiteAssignment } from "@/lib/projects/site-assignments";

/** The readiness shown for the day: the joined view when the database sent it, else the hand-entered values (an older read). */
function readinessOf(a: SiteAssignment): EffectiveReadiness {
  if (a.ready_effective) return a.ready_effective;
  const one = (l: string) => ({ state: (l === "unknown" ? "not_recorded" : l) as EffectiveState, source: l === "unknown" ? null : ("pm" as const) });
  return { hardware: one(a.ready.hardware), content: one(a.ready.content), app: one(a.ready.app), note: a.ready.note };
}

/** One card per assignment. Everything on it comes from the scoped read; nothing links into the project, because a site-only technician has no access to it. */
export function SiteAssignmentList({ rows }: { rows: SiteAssignment[] }) {
  return (
    <ul className="space-y-3" data-testid="site-assignments">
      {rows.map((a) => (
        <li key={a.assignment_id} className="os-card space-y-2 p-4" data-testid={`site-assignment-${a.activity_id}`}>
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
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="text-[13px] text-muted-foreground">When</dt><dd className="break-words font-medium" data-testid="sa-when">{assignmentWhen(a)}</dd></div>
            <div><dt className="text-[13px] text-muted-foreground">Your call time</dt><dd className="break-words font-medium" data-testid="sa-call">{callWord(a)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-[13px] text-muted-foreground">Venue</dt><dd className="break-words" data-testid="sa-venue">{venueWord(a)}</dd></div>
          </dl>
          {a.instructions || a.crew_instructions ? (
            <div className="space-y-1 text-sm" data-testid="sa-instructions">
              <p className="text-[13px] text-muted-foreground">Instructions</p>
              {a.instructions ? <p className="whitespace-pre-wrap break-words">{a.instructions}</p> : null}
              {a.crew_instructions ? <p className="whitespace-pre-wrap break-words">{a.crew_instructions}</p> : null}
            </div>
          ) : null}
          <div className="space-y-1" data-testid="sa-ready">
            <p className="text-[13px] text-muted-foreground">Ready for the day</p>
            {(() => {
              const r = readinessOf(a);
              return (
                <>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm">
                    {(["hardware", "content", "app"] as const).map((k) => (
                      <span key={k} title={effectiveReadyText(r[k])}><OsBadge tone={effectiveTone(r[k].state)}>{k === "app" ? "App" : k === "hardware" ? "Hardware" : "Content"}: {EFFECTIVE_LABELS[r[k].state].toLowerCase()}</OsBadge></span>
                    ))}
                  </p>
                  <ul className="text-[13px] text-muted-foreground" data-testid="sa-ready-detail">
                    {(["hardware", "content", "app"] as const).filter((k) => r[k].detail || r[k].source === "plan").map((k) => <li key={k}>{k === "app" ? "App" : k === "hardware" ? "Hardware" : "Content"}: {effectiveReadyText(r[k])}</li>)}
                  </ul>
                  {hardwareStateWord(a.hardware_state) ? <p className="text-[13px] text-muted-foreground">Equipment, from the warehouse: {hardwareStateWord(a.hardware_state)}</p> : null}
                  {r.note ? <p className="break-words text-sm">{r.note}</p> : null}
                </>
              );
            })()}
          </div>
          {a.site_only ? <p className="text-[13px] text-muted-foreground" data-testid="sa-site-only">You are assigned to this activity only. The project&apos;s chat, tasks, files and reviews are not part of it.</p> : null}
        </li>
      ))}
    </ul>
  );
}
