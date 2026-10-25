import Link from "next/link";
import { Info } from "lucide-react";
import { OsCollapsible } from "@/components/os/collapsible";
import { Fact } from "@/components/projects/parts";
import { dateRangeText, dateText } from "@/lib/projects/format";

interface Details {
  install_start: string | null; event_start: string | null; event_end: string | null; client_name: string | null; location: string | null; site_timezone: string;
  scope: string | null; exclusions: string | null; technologies: { name: string; qty: number }[];
}

/**
 * Who, when and what the project is, read-only, in the right rail. Everything here used to be the project's Overview page; it moved
 * next to the work so nothing was dropped. Folded on a phone and a narrow window; open when there is room.
 */
export function ProjectDetailsCard({ pmName, acting, team, peopleCount, start, end, details, internal, feedbackOpen, feedbackHref }: {
  pmName: string; acting: string[]; team: string[]; peopleCount: number; start: string | null; end: string | null; details: Details; internal: boolean; feedbackOpen: number; feedbackHref: string;
}) {
  return (
    <>
      <OsCollapsible title="Project details" label="Project details" icon={<Info className="h-4 w-4 text-accent" aria-hidden />}>
        <h2 className="mb-3 hidden font-heading text-base font-semibold xl:block">Project details</h2>
        <dl className="space-y-3.5">
          <Fact label="Project Manager">{pmName}{acting.length > 0 ? <span className="block text-muted-foreground">Temporary leader: {acting.join(", ")}</span> : null}</Fact>
          <Fact label="Team">{team.length > 0 ? team.join("; ") : "No department team yet"}<span className="block text-muted-foreground">{peopleCount} {peopleCount === 1 ? "person" : "people"} on the project</span></Fact>
          <Fact label="Project dates">{dateRangeText(start, end)}</Fact>
          <Fact label="Installation starts">{dateText(details.install_start)}</Fact>
          <Fact label="Event">{dateRangeText(details.event_start, details.event_end)}</Fact>
          {!internal ? <Fact label="Client">{details.client_name ?? "Not recorded"}</Fact> : null}
          <Fact label="Location">{details.location ?? "Not recorded"}<span className="block text-muted-foreground">Site time zone {details.site_timezone}</span></Fact>
          {feedbackOpen > 0 ? (
            <Fact label="Client feedback">
              <Link href={feedbackHref} className="font-medium text-accent underline-offset-4 hover:underline">{feedbackOpen} open {feedbackOpen === 1 ? "item" : "items"}</Link>
            </Fact>
          ) : null}
        </dl>
      </OsCollapsible>

      <OsCollapsible title={internal ? "Scope" : "Agreed scope"} label={internal ? "Scope" : "Agreed scope"}>
        <h2 className="mb-1 hidden font-heading text-base font-semibold xl:block">{internal ? "Scope" : "Agreed scope"}</h2>
        {internal ? null : <p className="mb-3 text-[13px] text-muted-foreground">As handed over from Sales. It changes only through a recorded scope change (Manage project, Feedback &amp; changes), which keeps the original.</p>}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium">Scope of work</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{details.scope ?? <span className="text-muted-foreground">Not recorded.</span>}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium">Exclusions</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{details.exclusions ?? <span className="text-muted-foreground">None recorded.</span>}</p>
          </div>
          {details.technologies.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium">Technologies</h3>
              <ul className="mt-1 flex flex-wrap gap-2">
                {details.technologies.map((t, i) => <li key={`${t.name}-${i}`} className="rounded-full border border-border px-2.5 py-0.5 text-sm">{t.name} × {t.qty}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </OsCollapsible>
    </>
  );
}
