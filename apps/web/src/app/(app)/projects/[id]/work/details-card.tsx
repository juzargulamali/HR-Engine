import Link from "next/link";
import { InfoHint } from "@/components/ui/info-hint";
import { Info } from "lucide-react";
import { OsCollapsible } from "@/components/os/collapsible";
import { Fact } from "@/components/projects/parts";
import { dateRangeText, dateText } from "@/lib/projects/format";
import type { ProjEditionSnapshot } from "@/types/projects";
import { SiteContactLines } from "@/components/projects/handover-brief";
import { agencyWords, noContactWords, type ProjectHandoverRead } from "@/lib/projects/handover-parties";

export const EDITION_NOTE = "These are the dates the organiser published when the handover was submitted. Later changes to the event in Sales do not change this project.";

/**
 * The event edition, kept apart from the project's own delivery dates above: the label, the venue and the show dates the organiser had published when the handover was
 * submitted. It is a copy, so it never moves when the event is edited in Sales. The link to Sales is offered only to someone who can read the edition there.
 */
function EditionFact({ edition, link }: { edition: ProjEditionSnapshot; link: string | "none" | "error" }) {
  const place = [edition.venue, edition.city].filter(Boolean).join(", ");
  return (
    <Fact label="Event edition" className="rounded-md border border-border p-2.5">
      <span className="block font-medium" data-testid="edition-label">{edition.label ?? edition.event_name ?? "Edition without a name"}</span>
      <span className="block">Venue: {place || "Not recorded"}</span>
      <span className="block">Published show dates: {edition.start_date || edition.end_date ? dateRangeText(edition.start_date, edition.end_date) : "Not recorded"}</span>
      <span className="mt-1 block text-[13px] text-muted-foreground">Published dates, as copied at handover<InfoHint label="the published dates" className="ml-1">{EDITION_NOTE}</InfoHint></span>
      {link === "error" ? <span className="mt-1 block text-[13px] text-muted-foreground">Could not check whether you can open this event in Sales. Reload to try again.</span>
        : link !== "none" ? <Link href={link} className="mt-1 inline-block font-medium text-accent underline-offset-4 hover:underline" data-testid="edition-sales-link">Open event in Sales</Link> : null}
    </Fact>
  );
}

/**
 * What the accepted handover says about who the job is for and who to call: the agency (or that it is a direct job), the site contact Sales chose, and the notes Sales
 * wrote for the Project Manager. It is the accepted brief, so it does not move when Sales edits the enquiry or the contact afterwards. The database sends the contact
 * only to whoever manages the project and to Operations Managers; a project accepted before these were recorded says so instead of showing nothing.
 */
export function HandoverPartiesFacts({ read }: { read: ProjectHandoverRead }) {
  if (read.status === "none") return null;
  if (read.status === "error") return <Fact label="From the handover"><span role="alert" className="text-destructive" data-testid="project-handover-error">Could not load the agency, the site contact and the notes from the handover. They are not empty: reload to try again.</span></Fact>;
  const d = read.details;
  if (!d.hasHandover) return null;
  return (
    <div className="space-y-3.5 rounded-md border border-border p-2.5" data-testid="project-handover-parties">
      <p className="text-[13px] text-muted-foreground">From the handover, as accepted<InfoHint label="what the handover carried" className="ml-1">The agency, the site contact and the notes as Sales submitted them. Later changes in Sales do not change this project. The site contact is shown to the Project Manager, a temporary leader, founders and Operations Managers.</InfoHint></p>
      <Fact label="Agency"><span data-testid="project-agency">{agencyWords(d)}</span></Fact>
      <Fact label="Site contact">
        {d.siteContact ? <SiteContactLines contact={d.siteContact} /> : <span className="text-muted-foreground" data-testid="project-no-contact">{noContactWords(d, d.contactRestricted)}</span>}
      </Fact>
      <Fact label="Notes for the Project Manager">{d.notes ? <span className="whitespace-pre-wrap" data-testid="project-pm-notes">{d.notes}</span> : <span className="text-muted-foreground">None</span>}</Fact>
    </div>
  );
}

interface Details {
  install_start: string | null; event_start: string | null; event_end: string | null; client_name: string | null; location: string | null; site_timezone: string;
  scope: string | null; exclusions: string | null; technologies: { name: string; qty: number }[];
}

/**
 * Who, when and what the project is, read-only, in the right rail. Everything here used to be the project's Overview page; it moved
 * next to the work so nothing was dropped. Folded on a phone and a narrow window; open when there is room.
 */
export function ProjectDetailsCard({ pmName, acting, team, peopleCount, start, end, details, internal, feedbackOpen, feedbackHref, edition, editionLink, handover }: {
  pmName: string; acting: string[]; team: string[]; peopleCount: number; start: string | null; end: string | null; details: Details; internal: boolean; feedbackOpen: number; feedbackHref: string;
  /** The event edition the project was sold for, as copied at the handover. Absent = the project has none. */
  edition?: ProjEditionSnapshot | null;
  /** Where the event opens in Sales: an address when the viewer can read the edition there, "none" when they cannot (no link, nothing said), "error" when that could not be checked. */
  editionLink?: string | "none" | "error";
  /** The agency, site contact and notes of the accepted handover (client projects only). */
  handover?: ProjectHandoverRead;
}) {
  return (
    <>
      <OsCollapsible title="Project details" label="Project details" icon={<Info className="h-4 w-4 text-accent" aria-hidden />}>
        <h2 className="mb-3 hidden font-heading text-base font-semibold xl:block">Project details</h2>
        <dl className="space-y-3.5">
          <Fact label="Project Manager">{pmName}{acting.length > 0 ? <span className="block text-muted-foreground">Temporary leader: {acting.join(", ")}</span> : null}</Fact>
          <Fact label="Team">{team.length > 0 ? team.join("; ") : "No project team yet"}<span className="block text-muted-foreground">{peopleCount} {peopleCount === 1 ? "person" : "people"} on the project</span></Fact>
          <Fact label="Project dates">{dateRangeText(start, end)}</Fact>
          <Fact label="Installation starts">{dateText(details.install_start)}</Fact>
          <Fact label="Event">{dateRangeText(details.event_start, details.event_end)}</Fact>
          {edition ? <EditionFact edition={edition} link={editionLink ?? "none"} /> : null}
          {!internal ? <Fact label="Client">{details.client_name ?? "Not recorded"}</Fact> : null}
          <Fact label="Location">{details.location ?? "Not recorded"}<span className="block text-muted-foreground">Site time zone {details.site_timezone}</span></Fact>
          {!internal && handover ? <HandoverPartiesFacts read={handover} /> : null}
          {feedbackOpen > 0 ? (
            <Fact label="Client feedback">
              <Link href={feedbackHref} className="font-medium text-accent underline-offset-4 hover:underline">{feedbackOpen} open {feedbackOpen === 1 ? "item" : "items"}</Link>
            </Fact>
          ) : null}
        </dl>
      </OsCollapsible>

      <OsCollapsible title={internal ? "Scope" : "Agreed scope"} label={internal ? "Scope" : "Agreed scope"}>
        <h2 className="mb-1 hidden font-heading text-base font-semibold xl:block">{internal ? "Scope" : "Agreed scope"}</h2>
        {internal ? null : <p className="mb-3 text-[13px] text-muted-foreground">As handed over from Sales<InfoHint label="the agreed scope" className="ml-1">It changes only through a recorded scope change (Manage project, Feedback &amp; changes), which keeps the original.</InfoHint></p>}
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
