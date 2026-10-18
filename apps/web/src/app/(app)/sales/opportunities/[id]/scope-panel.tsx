import { AvailabilityBadge } from "@/components/sales/badges";
import { formatDate } from "@/components/sales/format";
import { EditDetailsButton, type EditableOpportunity } from "./edit-details";
import { dateRangeText } from "./helpers";
import { Fact, Muted, Panel, SubHeading } from "./parts";
import type { OppView } from "./view";

const NOT_SET = <span className="text-muted-foreground">Not recorded</span>;

export function toEditable(view: OppView): EditableOpportunity {
  const { opp, detail } = view;
  return {
    id: opp.id, version: opp.version, title: opp.title, brief: opp.brief, currency: opp.currency, value: detail.item.value, budgetNote: opp.budget_note,
    paymentTerms: opp.payment_terms, eventStart: opp.event_start, eventEnd: opp.event_end, installStart: opp.install_start, location: opp.location,
    scope: opp.scope, exclusions: opp.exclusions, waitingOn: opp.waiting_on, technologies: opp.technologies, risks: opp.risks,
  };
}

/** Scope, dates and quantities as they stand now. Equipment availability is judged against exactly these. */
export function ScopePanel({ view, compact = false }: { view: OppView; compact?: boolean }) {
  const { opp, detail, editMode } = view;
  const display = detail.item.availability;
  const show = dateRangeText(opp.event_start, opp.event_end, formatDate);
  return (
    <div className={compact ? "space-y-6" : "grid gap-6 lg:grid-cols-3"}>
      <div className={compact ? "space-y-6" : "space-y-6 lg:col-span-2"}>
        <Panel
          title="Scope"
          actions={editMode ? <EditDetailsButton data={toEditable(view)} mode={editMode} availabilityWillNeedRecheck={display === "confirmed" || display === "unavailable"} /> : undefined}
        >
          <div className="space-y-4">
            <div><SubHeading>What is being supplied</SubHeading>{opp.scope ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{opp.scope}</p> : <Muted className="mt-1">No scope written down yet.</Muted>}</div>
            <div><SubHeading>Exclusions</SubHeading>{opp.exclusions ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{opp.exclusions}</p> : <Muted className="mt-1">None recorded.</Muted>}</div>
            <div>
              <SubHeading>Risks</SubHeading>
              {opp.risks.length === 0 ? <Muted className="mt-1">None recorded.</Muted> : <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{opp.risks.map((r, i) => <li key={`${i}-${r}`} className="break-words">{r}</li>)}</ul>}
            </div>
          </div>
        </Panel>
        <Panel title="Technologies and quantities">
          {opp.technologies.length === 0 ? <Muted>No technologies listed yet.</Muted> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {opp.technologies.map((t, i) => (
                <li key={`${i}-${t.name}`} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="min-w-0 break-words">{t.name}</span>
                  <span className="shrink-0 font-medium tabular-nums">× {t.qty}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel title="Dates and place">
          <dl className="space-y-3">
            <Fact label="Installation starts">{opp.install_start ? formatDate(opp.install_start) : <span className="text-muted-foreground">Not confirmed</span>}</Fact>
            <Fact label="Show">{show ?? <span className="text-muted-foreground">Not confirmed</span>}</Fact>
            <Fact label="Location">{opp.location ?? NOT_SET}</Fact>
          </dl>
        </Panel>
        <Panel title="Money and terms">
          <dl className="space-y-3">
            <Fact label="Budget as the client stated it">{opp.budget_note ?? NOT_SET}</Fact>
            <Fact label="Payment terms">{opp.payment_terms ?? NOT_SET}</Fact>
            <Fact label="Waiting on">{opp.waiting_on === "client" ? "The client" : opp.waiting_on === "internal" ? "Our own team" : "Nobody"}</Fact>
          </dl>
        </Panel>
        <Panel title="Equipment availability">
          <AvailabilityBadge state={display} />
          <p className="mt-2 text-sm text-muted-foreground">A dated check against these dates and quantities. Change them and it must be repeated. Details are on the Commercial tab.</p>
        </Panel>
      </div>
    </div>
  );
}
