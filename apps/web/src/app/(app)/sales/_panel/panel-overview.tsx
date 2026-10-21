import { crmSourceLabel } from "@enginious-hr/domain";
import { AvailabilityBadge } from "@/components/sales/badges";
import { formatDate, formatDateTime, formatMoney } from "@/components/sales/format";
import { Badge } from "@/components/ui/badge";
import { buildTimeline, dateRangeText, describeEvent } from "../opportunities/[id]/helpers";
import { describeHistoryEvent } from "../opportunities/[id]/closure-helpers";
import type { ContactPickerData } from "../opportunities/[id]/contact-helpers";
import { ContactsPanel } from "../opportunities/[id]/contacts-panel";
import { FollowUpsPanel } from "../opportunities/[id]/follow-ups-panel";
import { Fact, Muted, Panel, SubHeading } from "../opportunities/[id]/parts";
import type { OppView } from "../opportunities/[id]/view";

const KIND_LABEL = { call: "Call", email: "Email", meeting: "Meeting", note: "Note", client_response: "Client response" } as const;

/**
 * The overview inside the side panel: the short facts people need while working a list, who is involved, every follow-up, and the
 * last few things that happened. The long forms (scope, commercial, proposals, files) are the other tabs.
 */
export function PanelOverview({ view, picker }: { view: OppView; picker: ContactPickerData | null }) {
  const { opp, detail, ctx } = view;
  const { item } = detail;
  const show = dateRangeText(opp.event_start, opp.event_end, formatDate);
  const recent = buildTimeline(detail.activities, detail.events).slice(0, 4);
  return (
    <div className="space-y-5">
      <Panel title="At a glance">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Fact label="Value">{formatMoney(item.value, opp.currency)}</Fact>
          <Fact label="Source">{crmSourceLabel(opp.source)}</Fact>
          <Fact label="Installation">{opp.install_start ? formatDate(opp.install_start) : <span className="text-muted-foreground">Not confirmed</span>}</Fact>
          <Fact label="Show">{show ?? <span className="text-muted-foreground">Not confirmed</span>}</Fact>
          <Fact label="Location">{opp.location ?? <span className="text-muted-foreground">Not recorded</span>}</Fact>
          <Fact label="Equipment availability"><AvailabilityBadge state={item.availability} /></Fact>
          <Fact label="Created">{formatDate(opp.created_at)} by {ctx.personName(opp.created_by)}</Fact>
          <Fact label="First response">{opp.first_response_at ? formatDateTime(opp.first_response_at) : "None recorded yet"}</Fact>
        </dl>
        {opp.brief ? <p className="mt-4 line-clamp-4 whitespace-pre-wrap break-words text-sm">{opp.brief}</p> : null}
      </Panel>

      <Panel title="Who is involved">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <SubHeading>Agency</SubHeading>
            <p className="mt-1 break-words text-sm font-medium">{item.agency ? item.agency.name : "No agency (direct client)"}</p>
          </div>
          <div className="min-w-0">
            <SubHeading>End client</SubHeading>
            <p className="mt-1 break-words text-sm font-medium">{item.client ? item.client.name : "Not recorded"}</p>
          </div>
        </div>
        <div className="mt-4"><SubHeading>Contacts</SubHeading><div className="mt-2"><ContactsPanel contacts={detail.contacts} manage={{ view, picker }} /></div></div>
      </Panel>

      <FollowUpsPanel view={view} />

      <Panel title="Recent activity">
        {recent.length === 0 ? (
          <Muted>Nothing has been recorded yet.</Muted>
        ) : (
          <ol className="divide-y divide-border/70">
            {recent.map((t) => (
              <li key={t.id} className="py-2.5 first:pt-0 last:pb-0">
                {t.kind === "activity" ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{KIND_LABEL[t.activity.kind]}</Badge>
                      {t.activity.is_internal ? <Badge variant="secondary">Internal note</Badge> : null}
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm">{t.activity.body}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{ctx.personName(t.activity.created_by)} · {formatDateTime(t.at)}</p>
                  </>
                ) : (
                  <>
                    <p className="break-words text-sm">{describeHistoryEvent(t.event) ?? describeEvent(t.event, ctx.personName)}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{t.event.actor_id ? ctx.personName(t.event.actor_id) : "System"} · {formatDateTime(t.at)}</p>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        <Muted className="mt-3">The full timeline is under Updates.</Muted>
      </Panel>
    </div>
  );
}
