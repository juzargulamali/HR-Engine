import { dateRangeText, dateText } from "@/lib/projects/format";
import { Fact, Muted } from "./parts";
import type { ProjHandoverRow } from "@/types/projects";

type Brief = Pick<ProjHandoverRow, "client_name" | "location" | "site_timezone" | "install_start" | "event_start" | "event_end" | "technologies" | "scope" | "exclusions" | "risks" | "notes" | "crm_reference">;

/**
 * The member-safe delivery brief of a handover, read-only. It is exactly what Sales chose to share: the database never copies a value,
 * budget, payment terms or purchase-order detail into it, so there is nothing commercial to show.
 */
export function HandoverBrief({ h }: { h: Brief }) {
  const risks = (h.risks ?? []).filter((r): r is string => typeof r === "string");
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Client">{h.client_name ?? "Not given"}</Fact>
        <Fact label="Location">{h.location ?? "Not given"}</Fact>
        <Fact label="Site time zone">{h.site_timezone}</Fact>
        <Fact label="Installation starts">{dateText(h.install_start)}</Fact>
        <Fact label="Show">{dateRangeText(h.event_start, h.event_end)}</Fact>
        <Fact label="Sales reference">{h.crm_reference}</Fact>
      </dl>
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Scope</h3>
        {h.scope ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{h.scope}</p> : <Muted>Not written down.</Muted>}
      </div>
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Exclusions</h3>
        {h.exclusions ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{h.exclusions}</p> : <Muted>None recorded.</Muted>}
      </div>
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Technologies</h3>
        {h.technologies.length === 0 ? <Muted>None listed.</Muted> : (
          <ul className="mt-1 space-y-1 text-sm">{h.technologies.map((t, i) => <li key={`${i}-${t.name}`} className="flex justify-between gap-3"><span className="min-w-0 break-words">{t.name}</span><span className="tabular-nums">× {t.qty}</span></li>)}</ul>
        )}
      </div>
      {risks.length > 0 ? (
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Risks</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{risks.map((r, i) => <li key={`${i}-${r}`} className="break-words">{r}</li>)}</ul>
        </div>
      ) : null}
      <div>
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Notes for the Project Manager</h3>
        {h.notes ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{h.notes}</p> : <Muted>None.</Muted>}
      </div>
    </div>
  );
}
