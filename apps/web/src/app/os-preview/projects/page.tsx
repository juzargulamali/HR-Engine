"use client";

import { CheckCircle2, MapPin, TriangleAlert } from "lucide-react";
import { fmtDate } from "../_lib/data";
import { PROJECTS, SITE_BOOKINGS, TASKS, TEAM_PLAN, WEEK_DAYS, bookingWindow, fmtClock, siteConflicts, type SiteBooking } from "../_lib/delivery";
import { DesignOnlyButton, FutureBanner } from "../_components/future";
import { HealthChip } from "../_components/delivery-bits";
import { Chip, Hint, PageHeader, Panel, ScrollHint } from "../_components/ui";

const COLS: { id: "todo" | "doing" | "blocked" | "done"; label: string }[] = [{ id: "todo", label: "To do" }, { id: "doing", label: "In progress" }, { id: "blocked", label: "Blocked" }, { id: "done", label: "Done" }];

function BookingLine({ b }: { b: SiteBooking }) {
  const w = bookingWindow(b);
  return (
    <div className="rounded-md border border-border bg-card p-3 text-sm">
      <p className="font-semibold">{b.project}</p>
      <p className="flex items-start gap-1 text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />{b.place}</p>
      <p className="mt-1">On site {fmtClock(Date.parse(`${b.start}:00Z`) / 60000)}–{fmtClock(Date.parse(`${b.end}:00Z`) / 60000)} · {fmtDate(b.start)}</p>
      <p className="text-xs text-muted-foreground">Protected {fmtClock(w.from)}–{fmtClock(w.to)} (travel {b.travelMin} min and preparation {b.prepMin} min before, travel {b.travelMin} min after)</p>
    </div>
  );
}

export default function Projects() {
  const conflicts = siteConflicts();
  const ok = SITE_BOOKINGS.find((b) => b.id === "sb3")!;
  return (
    <>
      <PageHeader eyebrow="Projects & Tasks" title="Projects" actions={<DesignOnlyButton>New project</DesignOnlyButton>} />
      <FutureBanner />
      <div className="grid gap-6">
        <Panel title="Projects" description="Soonest installation first." flush>
          <ul className="divide-y divide-border/70">
            {[...PROJECTS].sort((a, b) => a.install.localeCompare(b.install)).map((p) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2"><p className="min-w-0 text-sm font-semibold">{p.name}</p><HealthChip h={p.health} /></div>
                <p className="text-xs text-muted-foreground">{p.client} · PM {p.pm}</p>
                <p className="mt-0.5 text-sm">{p.note}</p>
                <p className="mt-1 text-xs text-muted-foreground">Installation {fmtDate(p.install)} · Show {fmtDate(p.event)}{p.fromRef ? ` · from ${p.fromRef}` : ""}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Tasks">
          <div className="grid gap-3 md:grid-cols-4">
            {COLS.map((c) => (
              <section key={c.id} aria-labelledby={`tc-${c.id}`} className="rounded-lg border border-border bg-secondary/30 p-2.5">
                <h3 id={`tc-${c.id}`} className="mb-2 flex justify-between px-1 text-sm font-semibold">{c.label}<span className="text-xs font-medium text-muted-foreground">{TASKS.filter((t) => t.status === c.id).length}</span></h3>
                <ul className="space-y-2">
                  {TASKS.filter((t) => t.status === c.id).map((t) => (
                    <li key={t.id} className="rounded-md border border-border bg-card p-2.5 text-sm"><p className="font-medium">{t.title}</p><p className="text-xs text-muted-foreground">{PROJECTS.find((p) => p.id === t.projectId)!.name}</p><p className="mt-1 text-xs text-muted-foreground">{t.assignee} · {t.dept} · due {fmtDate(t.due)}</p></li>
                  ))}
                  {TASKS.filter((t) => t.status === c.id).length === 0 ? <li className="px-2 py-4 text-center text-xs text-muted-foreground">Nothing here</li> : null}
                </ul>
              </section>
            ))}
          </div>
        </Panel>

        <Panel title="Office work across projects" help="Programming, Content and workshop work can run across several projects on the same day. Departments plan in days and task deadlines, so this is normal and raises no warning. Only confirmed site commitments protect time.">
          <ScrollHint />
          <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Team plan, scroll sideways">
            <table className="w-full min-w-[38rem] text-sm">
              <caption className="sr-only">Sample team plan for the week</caption>
              <thead><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="sticky left-0 bg-card py-1.5 pr-2 font-medium">Person</th>{WEEK_DAYS.map((d) => <th key={d} scope="col" className="px-1.5 py-1.5 font-medium">{d}</th>)}</tr></thead>
              <tbody>
                {TEAM_PLAN.map((p) => (
                  <tr key={p.person} className="border-t border-border/60 align-top">
                    <th scope="row" className="sticky left-0 bg-card py-2 pr-2 text-left font-medium">{p.person}<div className="text-xs font-normal text-muted-foreground">{p.title}</div></th>
                    {p.days.map((d, i) => <td key={i} className="px-1.5 py-2 text-xs">{d.length ? d.map((x) => <div key={x.project}>{x.project} <span className="text-muted-foreground">· {x.type}</span></div>) : <span className="text-muted-foreground">No allocation recorded</span>}{d.length > 1 ? <div className="mt-0.5 text-muted-foreground">Multiple project assignments</div> : null}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-[hsl(var(--os-good))]" aria-hidden />Nadia Farouk works on Expo stand and Bank lobby on Tue 20 and Wed 21. This is allowed: both are office work.</p>
        </Panel>

        <Panel title="Site bookings" help="A confirmed site booking protects the person's time, including travel and preparation, whatever their job title. A programmer on site is protected the same way an engineer is. Overlaps between confirmed site bookings are blocked.">
          <div className="space-y-5">
            {conflicts.map(({ a, b }) => (
              <div key={`${a.id}-${b.id}`} role="alert" className="rounded-lg border border-destructive/50 bg-destructive/10 p-3.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold"><TriangleAlert className="h-4 w-4 text-[hsl(var(--os-bad))]" aria-hidden />Site booking conflict · {a.person} ({a.title})<Chip tone="bad">Blocked</Chip></p>
                <p className="mt-1 text-sm">Two confirmed site bookings overlap on {fmtDate(a.start)}, once travel and preparation are included.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2"><BookingLine b={a} /><BookingLine b={b} /></div>
                <div className="mt-3 flex flex-wrap gap-2"><DesignOnlyButton>Change times</DesignOnlyButton><DesignOnlyButton>Assign someone else</DesignOnlyButton></div>
              </div>
            ))}
            <div className="rounded-lg border border-border p-3.5">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-[hsl(var(--os-good))]" aria-hidden />No conflict · {ok.person} ({ok.title})</p>
              <p className="mt-1 text-sm">On site at the Expo stand on {fmtDate(ok.start)}. The Marina motion sequence is office work and can continue the same day outside the protected hours.</p>
              <div className="mt-3 max-w-md"><BookingLine b={ok} /></div>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
