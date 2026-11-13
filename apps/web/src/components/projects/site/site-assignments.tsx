import { OsBadge } from "@/components/os/pills";
import { ACTIVITY_KIND_LABELS, CREW_ROLE_LABELS, READY_LABELS, type ReadyLevel } from "@/lib/projects/phase2/model";
import { assignmentWhen, callWord, hardwareStateWord, type SiteAssignment } from "@/lib/projects/site-assignments";

const tone = (l: ReadyLevel) => (l === "ready" ? "green" : l === "not_ready" ? "amber" : "quiet");

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
            <div className="sm:col-span-2"><dt className="text-[13px] text-muted-foreground">Venue</dt><dd className="break-words">{a.location ?? "Not recorded yet"}</dd></div>
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
            <p className="flex flex-wrap items-center gap-1.5 text-sm">
              <OsBadge tone={tone(a.ready.hardware)}>Hardware: {READY_LABELS[a.ready.hardware].toLowerCase()}</OsBadge>
              <OsBadge tone={tone(a.ready.content)}>Content: {READY_LABELS[a.ready.content].toLowerCase()}</OsBadge>
              <OsBadge tone={tone(a.ready.app)}>App: {READY_LABELS[a.ready.app].toLowerCase()}</OsBadge>
            </p>
            {hardwareStateWord(a.hardware_state) ? <p className="text-[13px] text-muted-foreground">Equipment, from the warehouse: {hardwareStateWord(a.hardware_state)}</p> : null}
            {a.ready.note ? <p className="break-words text-sm">{a.ready.note}</p> : null}
          </div>
          {a.site_only ? <p className="text-[13px] text-muted-foreground" data-testid="sa-site-only">You are assigned to this activity only. The project&apos;s chat, tasks, files and reviews are not part of it.</p> : null}
        </li>
      ))}
    </ul>
  );
}
