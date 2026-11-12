import Link from "next/link";
import { dateRangeText, dateText, formatDateTime as dateTimeText } from "@/lib/projects/format";
import { Fact, Muted } from "./parts";
import type { ProjHandoverRow } from "@/types/projects";

type Brief = Pick<ProjHandoverRow, "client_name" | "location" | "site_timezone" | "install_start" | "event_start" | "event_end" | "technologies" | "scope" | "exclusions" | "risks" | "notes" | "crm_reference"> & Pick<Partial<ProjHandoverRow>, "edition_snapshot">;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-border p-3" aria-label={title}>
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-1 space-y-1 text-sm">{children}</div>
    </section>
  );
}

/**
 * The member-safe delivery brief of a handover, read-only. It is exactly what Sales chose to share: the database never copies a value,
 * budget, payment terms or purchase-order detail into it, so there is nothing commercial to show.
 * What a Project Manager needs to decide is first: the agreed scope, the site and dates, the equipment and what the job depends on, and the question to Sales if one is open.
 * Anything Sales did not record says so. `salesHref` is the source enquiry's handover page; it opens only for someone with Sales access to that company.
 */
export function HandoverBrief({ h, clarification, salesHref }: { h: Brief; clarification?: { note: string; at: string | null; answered: boolean } | null; salesHref?: string | null }) {
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
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Notes for the Project Manager</h3>
        {h.notes ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{h.notes}</p> : <Muted>None.</Muted>}
      </div>
    </div>
  );
}
