import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { isAnyCrmFounder } from "@enginious-hr/domain";
import { OsBadge } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { LoadError } from "@/components/workspace/states";
import { StageBadge } from "@/components/sales/badges";
import { formatDate, todayInDubai } from "@/components/sales/format";
import { getCrmContext } from "@/lib/crm/context";
import { loadEvent, loadOrgChoices, type EventOrg, type OrgChoiceRow } from "@/lib/crm/events/data";
import {
  AGENCY_ROLE_LABEL, buildExhibitorGrid, countEnquiries, dateRangeText, editionLabel, editionPhase, enquiriesByEdition, EVENT_KIND_LABEL, observationLine, outreachLeads, PHASE_LABEL, placeText, sortLeads,
  type ExhibitorCell, type ObservationLite,
} from "@/lib/crm/events/model";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { PriorityControl } from "../../accounts/priority-control";
import { EditEventButton, EditionButton, RemoveButton } from "../event-forms";
import { RecordObservationButton, RemoveObservationButton, type ObservationValues } from "../observation-form";
import { eventsScope } from "../scope";
import { EditObservationDialog } from "./edit-observation-dialog";

export const metadata = { title: "Event" };
const GRID_EDITIONS = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const back = <Link href="/sales/events" className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden /> Events &amp; Exhibitions</Link>;
  let data: Awaited<ReturnType<typeof loadEvent>>;
  let orgChoices: OrgChoiceRow[];
  try { [data, orgChoices] = await Promise.all([loadEvent(id), loadOrgChoices()]); } catch (e) {
    console.error("[events] event failed", e);
    return <div className="space-y-4">{back}<LoadError what="this event" retryHref={`/sales/events/${id}`} /></div>;
  }
  if (!data) notFound();
  const { event, editions, observations, orgs, enquiries } = data;
  const scope = eventsScope(ctx.companies, sp);
  const today = todayInDubai();
  const founder = isAnyCrmFounder(ctx.grants);
  const companyForLinks = scope.companyId ?? ctx.companies[0]?.id ?? "";

  const nameOf = (orgId: string) => orgs.get(orgId)?.name ?? "Unknown account";
  const live = editions.filter((e) => !e.archived_at);
  // The edition in focus: the one in the address, else the next upcoming (or on now), else the most recent.
  const pick = typeof sp.edition === "string" && UUID.test(sp.edition) ? editions.find((e) => e.id === sp.edition) : undefined;
  const upcoming = [...live].filter((e) => editionPhase(e, today) !== "past").sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const selected = pick ?? upcoming ?? editions[0] ?? null;
  const showAll = sp.all === "1";
  const gridEditions = showAll ? editions : editions.slice(0, GRID_EDITIONS);
  const grid = buildExhibitorGrid(gridEditions, observations, nameOf);
  const byEdition = enquiriesByEdition(enquiries, scope.companyId);
  const leads = selected ? sortLeads(outreachLeads(editions, observations, selected.id), (a) => orgs.get(a)?.outreach_priority ?? null, nameOf) : [];
  const linked = selected ? (byEdition.get(selected.id) ?? []) : [];
  const q = (over: Record<string, string>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...(scope.all ? { scope: "all" } : {}), ...(showAll ? { all: "1" } : {}), ...(selected ? { edition: selected.id } : {}), ...over })) if (v) p.set(k, v); const s = p.toString(); return `/sales/events/${id}${s ? `?${s}` : ""}`; };

  const editionChoices = live.map((e) => ({ id: e.id, label: editionLabel(event, e) }));
  const orgsForForm = orgChoices.map((o) => ({ id: o.id, name: o.name, country: o.country, website: o.website, roles: o.roles, priority: o.priority }));
  const canEditObs = (o: ObservationLite) => o.created_by === ctx.userId || founder;
  const editing = typeof sp.edit === "string" ? observations.find((o) => o.id === sp.edit) : undefined;
  const editValues: ObservationValues | null = editing && canEditObs(editing) ? {
    id: editing.id, kind: editing.kind, agencyId: editing.agency_org_id ?? "", agencyUnknown: editing.agency_unknown, stand: editing.stand_no ?? "", role: editing.agency_role ?? "", note: editing.note ?? "",
    confirmed: editing.verification === "confirmed", exhibitorName: nameOf(editing.exhibitor_org_id), editionLabel: editionLabel(event, editions.find((e) => e.id === editing.edition_id) ?? { start_date: "----", city: null }),
  } : null;

  const verification = (o: ObservationLite) => <OsBadge tone={o.verification === "confirmed" ? "green" : "amber"}>{o.verification === "confirmed" ? "Confirmed" : "Unverified"}</OsBadge>;
  /** One cell of the comparison: what is recorded (every observation on its own line), or "No observation". Absence of a record never reads as non-participation. */
  const cellView = (cell: ExhibitorCell | undefined) => {
    if (!cell || cell.state === "no_observation") return <span className="text-muted-foreground">No observation</span>;
    return (
      <div className="space-y-1">
        <ul className="space-y-1">
          {cell.observations.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="break-words">{o.kind === "did_not_exhibit" ? "Did not exhibit" : o.agency_unknown || !o.agency_org_id
                ? <span>Exhibited · <span className="text-muted-foreground">Agency unknown</span></span>
                : <Link href={`/sales/accounts/${o.agency_org_id}?company=${companyForLinks}`} className="font-medium underline-offset-2 hover:underline">{nameOf(o.agency_org_id)}</Link>}
                {o.kind === "exhibited" && o.stand_no ? <span className="text-muted-foreground"> · stand {o.stand_no}</span> : null}
                {o.kind === "exhibited" && o.agency_role ? <span className="text-muted-foreground"> · {AGENCY_ROLE_LABEL[o.agency_role]}</span> : null}
              </span>
              {verification(o)}
            </li>
          ))}
        </ul>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Open the observation{cell.observations.length > 1 ? `s (${cell.observations.length})` : ""}</summary>
          <ul className="mt-1.5 space-y-2">
            {cell.observations.map((o) => (
              <li key={o.id} className="rounded-md border border-border p-2">
                <p className="break-words text-sm text-foreground">{observationLine(o, nameOf)}</p>
                <p>Recorded {formatDate(o.created_at)}{o.created_by ? ` by ${ctx.personName(o.created_by)}` : ""}. {o.verification === "confirmed" ? "Confirmed." : "Unverified: not yet confirmed."}</p>
                {o.note ? <p className="whitespace-pre-wrap break-words text-foreground">{o.note}</p> : null}
                {canEditObs(o) ? (
                  <span className="mt-1 flex items-center gap-1">
                    <Link href={q({ edit: o.id })} className={buttonVariants({ variant: "outline", size: "sm" })}>Edit</Link>
                    <RemoveObservationButton id={o.id} label={observationLine(o, nameOf)} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold">{event.name}{event.archived_at ? <span className="ml-2 align-middle"><OsBadge tone="amber">Archived</OsBadge></span> : null}</h1>
          <p className="text-muted-foreground">
            {EVENT_KIND_LABEL[event.kind]}{event.website ? <> · <a href={/^https?:\/\//i.test(event.website) ? event.website : `https://${event.website}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">{event.website}<ExternalLink className="h-3 w-3" aria-hidden /></a></> : null}
          </p>
          {event.note ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{event.note}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live.length > 0 ? <RecordObservationButton editions={editionChoices} orgs={orgsForForm} editionId={selected && !selected.archived_at ? selected.id : undefined} /> : null}
          {!event.archived_at ? <EditionButton eventId={event.id} label="Add next edition" variant="outline" /> : null}
          <EditEventButton values={{ id: event.id, name: event.name, kind: event.kind, website: event.website ?? "", note: event.note ?? "" }} />
          <RemoveButton kind="event" id={event.id} name={event.name} />
        </div>
      </div>

      {scope.canChooseAll ? (
        <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Enquiry figures scope">
          {selected ? <input type="hidden" name="edition" value={selected.id} /> : null}
          {showAll ? <input type="hidden" name="all" value="1" /> : null}
          <div className="space-y-1.5">
            <label htmlFor="ev-scope" className="text-sm font-medium leading-none">Enquiry figures for</label>
            <Select id="ev-scope" name="scope" defaultValue={scope.all ? "all" : ""}>
              <option value="">{ctx.companies.find((c) => c.id === scope.companyId)?.name ?? "Current company"}</option>
              <option value="all">All my companies</option>
            </Select>
          </div>
          <Button type="submit" variant="secondary" className="min-h-10">Apply</Button>
        </form>
      ) : null}

      {/* ---- Editions: the same event across years, with the enquiry figures of the chosen scope ---- */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>Editions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {editions.length === 0 ? <p className="text-sm text-muted-foreground">No edition yet. Add the first one with “Add next edition”.</p> : (
            <>
              <p className="text-sm text-muted-foreground">Enquiries linked to each edition, for <strong>{scope.label}</strong> (counted from the enquiries, never typed in; open = not won or lost, closed = won or lost). Enquiries of a company you cannot access are never counted.</p>
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm" aria-label="Editions of this event">
                  <thead><tr className="border-b border-border text-left"><th className="py-2 pr-3 font-medium">Edition</th><th className="py-2 pr-3 font-medium">Dates</th><th className="py-2 pr-3 font-medium">Where</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Enquiries</th><th className="py-2 pr-3 font-medium">Open</th><th className="py-2 pr-3 font-medium">Closed</th><th className="py-2 pr-3 font-medium">Won</th><th className="py-2 pr-3 font-medium">Lost</th><th className="py-2 font-medium"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {editions.map((d) => {
                      const c = countEnquiries(byEdition.get(d.id) ?? []);
                      const phase = editionPhase(d, today);
                      const on = selected?.id === d.id;
                      return (
                        <tr key={d.id} className={`border-b border-border/60 align-top ${on ? "bg-secondary/40" : ""}`}>
                          <td className="py-2 pr-3"><Link href={q({ edition: d.id })} aria-current={on ? "true" : undefined} className="font-medium underline-offset-2 hover:underline">{editionLabel(event, d)}</Link></td>
                          <td className="whitespace-nowrap py-2 pr-3">{dateRangeText(d.start_date, d.end_date)}</td>
                          <td className="py-2 pr-3">{placeText(d, countryLabel) || <span className="text-muted-foreground">Not recorded</span>}</td>
                          <td className="py-2 pr-3"><span className="flex flex-wrap gap-1"><OsBadge tone={phase === "past" ? "quiet" : phase === "ongoing" ? "green" : "blue"}>{PHASE_LABEL[phase]}</OsBadge>{d.archived_at ? <OsBadge tone="amber">Archived</OsBadge> : null}</span></td>
                          <td className="py-2 pr-3 tabular-nums">{c.total}</td><td className="py-2 pr-3 tabular-nums">{c.open}</td><td className="py-2 pr-3 tabular-nums">{c.closed}</td><td className="py-2 pr-3 tabular-nums">{c.won}</td><td className="py-2 pr-3 tabular-nums">{c.lost}</td>
                          <td className="py-2"><span className="flex items-center justify-end">{!d.archived_at ? <EditionButton values={{ id: d.id, start: d.start_date, end: d.end_date, city: d.city ?? "", country: d.country_code ?? "", venue: d.venue ?? "", note: "" }} /> : null}<RemoveButton kind="edition" id={d.id} name={editionLabel(event, d)} /></span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- Exhibitors compared across editions ---- */}
      <Card>
        <CardHeader className="pb-2"><CardTitle>Who exhibited, and with which agency</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            One row per exhibitor, recent editions side by side. <strong>No observation</strong> means nobody recorded it (not that they stayed away); <strong>Did not exhibit</strong> was recorded; <strong>Agency unknown</strong> means they exhibited and the agency was not identified. Several stands or agencies in one edition are listed separately; <strong>Unverified</strong> entries are kept and marked.
          </p>
          {grid.length === 0 ? <p className="text-sm text-muted-foreground">No observations recorded for {showAll ? "this event" : "the latest editions"} yet. Use “Record an observation”.</p> : (
            <>
              <div className="relative hidden overflow-x-auto md:block">
                <table className="w-full text-sm" aria-label="Exhibitors by edition">
                  <thead><tr className="border-b border-border text-left"><th className="py-2 pr-3 font-medium">Exhibitor</th>{gridEditions.map((d) => <th key={d.id} className="py-2 pr-3 font-medium">{editionLabel({ name: "" }, d).replace(/^ · /, "")}</th>)}</tr></thead>
                  <tbody>
                    {grid.map((r) => (
                      <tr key={r.exhibitorId} className="border-b border-border/60 align-top">
                        <th scope="row" className="py-2 pr-3 text-left font-medium"><Link href={`/sales/accounts/${r.exhibitorId}?company=${companyForLinks}`} className="underline-offset-2 hover:underline">{r.name}</Link></th>
                        {gridEditions.map((d) => <td key={d.id} className="py-2 pr-3">{cellView(r.cells.get(d.id))}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-3 md:hidden" aria-label="Exhibitors by edition">
                {grid.map((r) => (
                  <li key={r.exhibitorId} className="rounded-lg border border-border p-3">
                    <p className="font-medium"><Link href={`/sales/accounts/${r.exhibitorId}?company=${companyForLinks}`} className="underline-offset-2 hover:underline">{r.name}</Link></p>
                    <dl className="mt-2 space-y-2">
                      {gridEditions.map((d) => (<div key={d.id}><dt className="text-xs font-medium text-muted-foreground">{editionLabel({ name: "" }, d).replace(/^ · /, "")}</dt><dd>{cellView(r.cells.get(d.id))}</dd></div>))}
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
          {editions.length > GRID_EDITIONS ? <p className="text-sm"><Link href={q({ all: showAll ? "" : "1" })} className="underline underline-offset-2">{showAll ? `Show only the latest ${GRID_EDITIONS} editions` : `Show all ${editions.length} editions`}</Link></p> : null}
        </CardContent>
      </Card>

      {/* ---- Outreach leads for the edition in focus ---- */}
      {selected ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle>Agencies to contact for {editionLabel(event, selected)}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Every agency recorded at an <strong>earlier</strong> edition of this event: leads to approach, not confirmed for {yearOfLabel(selected.start_date)}. If one agency built a client&apos;s stand one year and another the next, both are listed. Open the account for its contacts and to start or log outreach and follow-ups.
            </p>
            {leads.length === 0 ? <p className="text-sm text-muted-foreground">No agency is recorded at an earlier edition yet.</p> : (
              <ul className="divide-y divide-border" aria-label="Past agencies">
                {leads.map((l) => {
                  const org: EventOrg | undefined = orgs.get(l.agencyId);
                  return (
                    <li key={l.agencyId} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0 space-y-1">
                        <p className="break-words font-medium">
                          <Link href={`/sales/accounts/${l.agencyId}?company=${companyForLinks}`} className="underline-offset-2 hover:underline">{nameOf(l.agencyId)}</Link>
                          {org?.country_code ? <span className="font-normal text-muted-foreground"> · {countryLabel(org.country_code)}</span> : null}
                        </p>
                        <ul className="space-y-0.5 text-sm text-muted-foreground">
                          {l.sightings.map((s, i) => (
                            <li key={`${s.editionId}-${s.exhibitorId}-${i}`} className="break-words">
                              {s.year}: for {nameOf(s.exhibitorId)}{s.standNo ? `, stand ${s.standNo}` : ""}{s.role ? `, ${AGENCY_ROLE_LABEL[s.role]}` : ""} · {s.verification === "confirmed" ? "confirmed" : "unverified"}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <PriorityControl orgId={l.agencyId} value={org?.outreach_priority ?? null} label={`Outreach priority for ${nameOf(l.agencyId)}`} compact />
                        <Link href={`/sales/accounts/${l.agencyId}?company=${companyForLinks}#outreach`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open account · outreach &amp; follow-up</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ---- The enquiries behind the figures of the edition in focus (same scope) ---- */}
      {selected ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle>Enquiries linked to {editionLabel(event, selected)} ({linked.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">For {scope.label}: exactly the enquiries behind the figures above. An enquiry of a company you have no Sales access to is not listed and not counted.</p>
            {linked.length === 0 ? <p className="text-sm text-muted-foreground">No enquiry is linked to this edition. Link one from its Edit details, or when adding the enquiry.</p> : (
              <ul className="divide-y divide-border">
                {linked.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 break-words"><Link href={`/sales/opportunities/${o.id}`} className="font-medium underline-offset-2 hover:underline">{o.reference}</Link> · {o.title}<span className="text-muted-foreground"> · {ctx.companyName(o.company_id)}</span></span>
                    <StageBadge stage={o.stage} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {editValues ? <EditObservationDialog values={editValues} orgs={orgsForForm} closeHref={q({ edit: "" })} /> : null}
      {typeof sp.edit === "string" && !editValues ? <Alert role="status">That observation can be changed only by the person who recorded it or a founder.</Alert> : null}
    </div>
  );
}

const yearOfLabel = (date: string) => date.slice(0, 4);
