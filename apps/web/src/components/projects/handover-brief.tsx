import Link from "next/link";
import { dateRangeText, dateText, formatDateTime as dateTimeText } from "@/lib/projects/format";
import { Fact, Muted } from "./parts";
import type { ProjHandoverRow } from "@/types/projects";
import { agencyWords, noContactWords, type HandoverParties, type SiteContact } from "@/lib/projects/handover-parties";

type Brief = Pick<ProjHandoverRow, "client_name" | "location" | "site_timezone" | "install_start" | "event_start" | "event_end" | "technologies" | "scope" | "exclusions" | "risks" | "notes" | "crm_reference"> & Pick<Partial<ProjHandoverRow>, "edition_snapshot">;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-border p-3" aria-label={title}>
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-1 space-y-1 text-sm">{children}</div>
    </section>
  );
}

/** One person to call on site: the copy taken at handover. The links open the reader's own phone or mail app; nothing is sent from here. */
export function SiteContactLines({ contact }: { contact: SiteContact }) {
  return (
    <span data-testid="site-contact">
      <span className="block font-medium">{contact.name}</span>
      {contact.roleTitle ? <span className="block">{contact.roleTitle}</span> : null}
      {contact.phone ? <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="block break-all underline underline-offset-2">{contact.phone}</a> : <span className="block text-muted-foreground">No phone recorded</span>}
      {contact.email ? <a href={`mailto:${contact.email}`} className="block break-all underline underline-offset-2">{contact.email}</a> : <span className="block text-muted-foreground">No e-mail recorded</span>}
    </span>
  );
}

/**
 * The member-safe delivery brief of a handover, read-only. It is exactly what Sales chose to share: the database never copies a value,
 * budget, payment terms or purchase-order detail into it, so there is nothing commercial to show.
 * What a Project Manager needs to decide is first: the agreed scope, the site and dates, the equipment and what the job depends on, and the question to Sales if one is open.
 * Anything Sales did not record says so. `salesHref` is the source enquiry's handover page; it opens only for someone with Sales access to that company.
 */
export function HandoverBrief({ h, clarification, salesHref, parties }: {
  h: Brief; clarification?: { note: string; at: string | null; answered: boolean } | null; salesHref?: string | null;
  /** The agency and the site contact, when this reader may see them: left out (undefined) on a database without them, "error" when they could not be read. */
  parties?: HandoverParties | "error";
}) {
  const risks = (h.risks ?? []).filter((r): r is string => typeof r === "string");
  return (
    <div className="space-y-4" data-testid="handover-brief">
      {clarification ? (
        <Block title={clarification.answered ? "Your earlier question to Sales" : "Current clarification"}>
          <p className="whitespace-pre-wrap break-words">“{clarification.note}”</p>
          <p className="text-[13px] text-muted-foreground">{clarification.at ? `Asked ${dateTimeText(clarification.at)}. ` : ""}{clarification.answered ? "Sales resubmitted the brief after this question." : "Sales has not resubmitted yet."}</p>
        </Block>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <Block title="Agreed scope">
          {h.scope ? <p className="whitespace-pre-wrap break-words">{h.scope}</p> : <Muted>Not written down.</Muted>}
          <p className="text-[13px] text-muted-foreground">Exclusions: {h.exclusions ? <span className="whitespace-pre-wrap break-words text-foreground">{h.exclusions}</span> : "none recorded"}</p>
        </Block>
        <Block title="Site and dates">
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <Fact label="Client">{h.client_name ?? "Not given"}</Fact>
            {parties === "error" ? <Fact label="Agency"><span className="text-destructive">Could not load</span></Fact> : parties ? <Fact label="Agency"><span data-testid="brief-agency">{agencyWords(parties)}</span></Fact> : null}
            <Fact label="Location">{h.location ?? "Not given"}</Fact>
            <Fact label="Installation starts">{dateText(h.install_start)}</Fact>
            <Fact label="Show">{dateRangeText(h.event_start, h.event_end)}</Fact>
            {/* The edition Sales linked the enquiry to, as copied when the handover was submitted. Shown only when there is one. */}
            {h.edition_snapshot ? <Fact label="Event edition" className="sm:col-span-2">{h.edition_snapshot.label ?? h.edition_snapshot.event_name ?? "Edition without a name"}</Fact> : null}
            <Fact label="Site time zone">{h.site_timezone}</Fact>
            <Fact label="Sales reference">{salesHref ? <Link href={salesHref} className="underline underline-offset-2" title="Opens for people with Sales access to this company">{h.crm_reference}</Link> : h.crm_reference}</Fact>
          </dl>
        </Block>
        <Block title="Equipment">
          {h.technologies.length === 0 ? <Muted>None listed.</Muted> : (
            <ul className="space-y-1">{h.technologies.map((t, i) => <li key={`${i}-${t.name}`} className="flex justify-between gap-3"><span className="min-w-0 break-words">{t.name}</span><span className="tabular-nums">× {t.qty}</span></li>)}</ul>
          )}
          <p className="text-[13px] text-muted-foreground">After acceptance these become a draft equipment request on the project, which you review and submit.</p>
        </Block>
        <Block title="Dependencies and risks">
          {risks.length === 0 ? <Muted>None recorded.</Muted> : <ul className="list-disc space-y-0.5 pl-5">{risks.map((r, i) => <li key={`${i}-${r}`} className="break-words">{r}</li>)}</ul>}
        </Block>
      </div>
      {parties ? (
        <div data-testid="brief-site-contact">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Site contact</h3>
          {parties === "error" ? <p role="alert" className="mt-1 text-sm text-destructive">Could not load the site contact. It is not empty: reload to try again.</p>
            : parties.siteContact ? <p className="mt-1 text-sm"><SiteContactLines contact={parties.siteContact} /></p>
            : <Muted>{noContactWords(parties)}.</Muted>}
        </div>
      ) : null}
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Notes for the Project Manager</h3>
        {h.notes ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{h.notes}</p> : <Muted>None.</Muted>}
      </div>
    </div>
  );
}
