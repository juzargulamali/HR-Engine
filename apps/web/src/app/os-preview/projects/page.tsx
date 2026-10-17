"use client";

import { Clock } from "lucide-react";
import { fmtDate } from "../_lib/data";
import { PROJECTS, SAMPLE_REQUESTS, TASKS, TEAM_PLAN, WEEK_DAYS } from "../_lib/delivery";
import { DesignOnlyButton, FutureBanner } from "../_components/future";
import { HealthChip } from "../_components/delivery-bits";
import { PageHeader, Panel } from "../_components/ui";
import { PLink } from "../_components/context";

const COLS: { id: "todo" | "doing" | "blocked" | "done"; label: string }[] = [{ id: "todo", label: "To do" }, { id: "doing", label: "In progress" }, { id: "blocked", label: "Blocked" }, { id: "done", label: "Done" }];

export default function Projects() {
  return (
    <>
      <PageHeader eyebrow="Projects & Tasks" title="Projects" description="Won jobs become projects once a Project Manager accepts the handover. Department heads plan their people in days; tasks carry the daily work." actions={<DesignOnlyButton>New project</DesignOnlyButton>} />
      <FutureBanner release="Release 2" />
      <div className="grid gap-6">
        <Panel title="Projects" description="Sorted by installation date." flush>
          <ul className="divide-y divide-border/70">
            {[...PROJECTS].sort((a, b) => a.install.localeCompare(b.install)).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-[12rem] flex-1"><p className="text-sm font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.client} · PM {p.pm}</p><p className="text-xs">{p.note}</p></div>
                <p className="text-xs text-muted-foreground">Install {fmtDate(p.install)} · Event {fmtDate(p.event)}</p>
                <HealthChip h={p.health} />
                {p.fromRef ? <PLink href="/os-preview/sales" className="text-xs text-[hsl(var(--os-link))] hover:underline">From {p.fromRef}</PLink> : null}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Tasks" description="Daily work assigned by department heads.">
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

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Team plan (Programming)" description="Days, not hours. Two projects on one day is flagged.">
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table"><table className="w-full min-w-[28rem] text-sm"><caption className="sr-only">Programming team plan for the week</caption>
              <thead><tr className="text-left text-xs text-muted-foreground"><th scope="col" className="py-1.5 pr-2 font-medium">Person</th>{WEEK_DAYS.map((d) => <th key={d} scope="col" className="px-1.5 py-1.5 font-medium">{d}</th>)}</tr></thead>
              <tbody>{TEAM_PLAN.map((p) => <tr key={p.person} className="border-t border-border/60 align-top"><th scope="row" className="py-2 pr-2 text-left font-medium">{p.person}</th>{p.days.map((d, i) => <td key={i} className="px-1.5 py-2 text-xs">{d ? d.join(" + ") : <span className="text-muted-foreground">Free</span>}{d && d.length > 1 ? <span className="block font-semibold text-foreground">Competing</span> : null}</td>)}</tr>)}</tbody>
            </table></div>
          </Panel>
          <Panel title="Site reservations" description="Exact, non-overlapping times for physical work, by assignment type (not job title).">
            <ul className="space-y-3 text-sm">
              {SAMPLE_REQUESTS.reservations.map((r) => <li key={r.what} className="flex gap-2"><Clock className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" aria-hidden /><div><p className="font-medium">{r.what}</p><p className="text-xs text-muted-foreground">{r.when} · {r.who}</p><p className="text-xs text-muted-foreground">{r.note}</p></div></li>)}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Overlapping reservations for the same person are blocked, including the travel and preparation buffer.</p>
          </Panel>
        </div>
      </div>
    </>
  );
}
