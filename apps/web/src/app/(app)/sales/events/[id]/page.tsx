import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { isAnyCrmFounder } from "@enginious-hr/domain";
import { OsBadge } from "@/components/os/pills";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackLink } from "@/components/workspace/list-memory";
import { LoadError } from "@/components/workspace/states";
import { Panel } from "@/components/projects/parts";
import { ChooseCompanyNotice, CompanySwitch } from "@/components/sales/company-switch";
import { StageBadge } from "@/components/sales/badges";
import { ProjectStatusBadge } from "@/components/projects/badges";
import { isNotInstalled } from "@/lib/projects/errors";
import { createClient } from "@/lib/supabase/server";
import { formatDate, todayInDubai } from "@/components/sales/format";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext } from "@/lib/crm/context";
import { loadEvent, loadOrgChoices, type EventOrg, type OrgChoiceRow } from "@/lib/crm/events/data";
import {
  addEditionLabel, AGENCY_ROLE_LABEL, buildExhibitorGrid, countEnquiries, dateRangeText, editionLabel, editionPhase, enquiriesByEdition, EVENT_KIND_LABEL, observationLine, outreachLeads, PHASE_LABEL, placeText, sortLeads,
  type ExhibitorCell, type LinkedEnquiry, type ObservationLite,
} from "@/lib/crm/events/model";
import { countryLabel } from "@/lib/crm/clients-agencies/normalise";
import { PriorityControl } from "../../accounts/priority-control";
import { EditionButton, EditionMenu, EventMenu } from "../event-forms";
import { RecordObservationButton, RemoveObservationButton, type ObservationValues } from "../observation-form";
import { address, eventsScope, scopeParams } from "../scope";
import { EditObservationDialog } from "./edit-observation-dialog";

export const metadata = { title: "Event" };

type DeliveryProject = { project_id: string; reference: string; name: string; status: string };
/**
 * The delivery projects on one edition that the signed-in person may see (proj_projects_for_edition: someone without Projects access gets no row). Three answers kept apart:
 * the rows (possibly none, and then nothing is drawn), a database without the function (also nothing: there is nothing to show yet), and a failed read, which is said.
 */
async function loadDeliveryProjects(editionId: string): Promise<DeliveryProject[] | "error"> {
  try {
    const { data, error } = await (await createClient()).rpc("proj_projects_for_edition", { p_edition_id: editionId });
    if (!error) return data ?? [];
    if (isNotInstalled(error)) return [];
    console.error("[events] delivery projects failed", error.message);
  } catch (e) {
    console.error("[events] delivery projects failed", e);
  }
  return "error";
}
const GRID_EDITIONS = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // The company the figures are counted for: the one in the address (every link from the Events list carries it), else the active Sales company. With several
  // companies and none to assume, nothing is counted until the person chooses; it never falls back to the first company by name.
  const active = await pickSalesCompany(ctx, sp.company);
  const scope = eventsScope(ctx.companies, sp, active);
  const keep = scopeParams(scope);
  // Back returns to the list as the person left it (filters, List or Calendar and its month); without a remembered list it opens the list for the same company.
  const back = <BackLink section="events" fallback={address("/sales/events", keep)}>Events &amp; Exhibitions</BackLink>;
  let data: Awaited<ReturnType<typeof loadEvent>>;
  let orgChoices: OrgChoiceRow[];
  try { [data, orgChoices] = await Promise.all([loadEvent(id), loadOrgChoices()]); } catch (e) {
    console.error("[events] event failed", e);
    return <div className="space-y-4">{back}<LoadError what="this event" retryHref={address(`/sales/events/${id}`, { ...(typeof sp.edition === "string" ? { edition: sp.edition } : {}), ...keep })} /></div>;
  }
  if (!data) notFound();
  const { event, editions, observations, orgs, enquiries } = data;
  const today = todayInDubai();
  const founder = isAnyCrmFounder(ctx.grants);
  // An account opens in the company the figures are counted for; with no single company (All my companies, or none chosen yet) the Accounts page decides for itself.
  const accountHref = (orgId: string, hash = "") => `${address(`/sales/accounts/${orgId}`, scope.companyId ? { company: scope.companyId } : {})}${hash}`;

  const nameOf = (orgId: string) => orgs.get(orgId)?.name ?? "Unknown account";
  const live = editions.filter((e) => !e.archived_at);
  // The edition in focus: the one in the address, else the next upcoming (or on now), else the most recent.
  const pick = typeof sp.edition === "string" && UUID.test(sp.edition) ? editions.find((e) => e.id === sp.edition) : undefined;
  const upcoming = [...live].filter((e) => editionPhase(e, today) !== "past").sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const selected = pick ?? upcoming ?? editions[0] ?? null;
  const showAll = sp.all === "1";
  const gridEditions = showAll ? editions : editions.slice(0, GRID_EDITIONS);
  const grid = buildExhibitorGrid(gridEditions, observations, nameOf);
  // No company chosen yet: nothing is counted (null here would mean "every company", which nobody asked for).
  const byEdition = scope.choose ? new Map<string, LinkedEnquiry[]>() : enquiriesByEdition(enquiries, scope.companyId);
  const leads = selected ? sortLeads(outreachLeads(editions, observations, selected.id), (a) => orgs.get(a)?.outreach_priority ?? null, nameOf) : [];
  const linked = selected ? (byEdition.get(selected.id) ?? []) : [];
  const deliveryProjects = selected ? await loadDeliveryProjects(selected.id) : [];
  // Every link on this page keeps the company, the edition in focus and "show all editions".
  const q = (over: Record<string, string>) => address(`/sales/events/${id}`, { ...keep, ...(showAll ? { all: "1" } : {}), ...(selected ? { edition: selected.id } : {}), ...over });
  const keepQuery = new URLSearchParams(keep).toString();
  const latest = [...live].sort((a, b) => b.start_date.localeCompare(a.start_date))[0];

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
                : <Link href={accountHref(o.agency_org_id)} className="font-medium underline-offset-2 hover:underline">{nameOf(o.agency_org_id)}</Link>}
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

  const scopeNote = scope.choose ? null : <span className="text-muted-foreground" data-testid="event-scope">for <strong className="font-medium text-foreground">{scope.label}</strong></span>;
  const selectedCounts = selected ? countEnquiries(linked) : null;
  const selectedPhase = selected ? editionPhase(selected, today) : null;

  return (
    <div className="space-y-5">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold">{event.name}{event.archived_at ? <span className="ml-2 align-middle"><OsBadge tone="amber">Archived</OsBadge></span> : null}</h1>
          <p className="text-muted-foreground">
            {EVENT_KIND_LABEL[event.kind]}{event.website ? <> · <a href={/^https?:\/\//i.test(event.website) ? event.website : `https://${event.website}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all underline-offset-2 hover:underline">{event.website}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden /></a></> : null}
          </p>
          {event.note ? <p className="mt-1 whitespace-pre-wrap break-words text-sm">{event.note}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live.length > 0 ? <RecordObservationButton editions={editionChoices} orgs={orgsForForm} editionId={selected && !selected.archived_at ? selected.id : undefined} /> : null}
          {!event.archived_at ? (
            <EditionButton eventId={event.id} eventName={event.name} label={addEditionLabel(editions.length)} variant="outline" keep={keepQuery}
              prefill={latest ? { city: latest.city ?? "", country: latest.country_code ?? "", venue: latest.venue ?? "", from: editionLabel(event, latest) } : undefined} />
          ) : null}
          <EventMenu values={{ id: event.id, name: event.name, kind: event.kind, website: event.website ?? "", note: event.note ?? "" }} archived={!!event.archived_at} />
        </div>
      </div>

      <CompanySwitch companies={ctx.companies} current={scope.all ? null : scope.companyId} from={active.from}
        hrefFor={(companyId) => address(`/sales/events/${id}`, { ...(selected ? { edition: selected.id } : {}), ...(showAll ? { all: "1" } : {}), company: companyId })}
        all={scope.canChooseAll ? { href: address(`/sales/events/${id}`, { ...(selected ? { edition: selected.id } : {}), ...(showAll ? { all: "1" } : {}), scope: "all" }), active: scope.all } : undefined} />
      {scope.choose ? <ChooseCompanyNotice what="the enquiry figures and the linked enquiries" /> : null}

      {/* ---- 1. Venue and dates: the edition in focus, then every edition of the event with the enquiry figures of the chosen company ---- */}
      <Panel title="Editions" hint={<><p>An edition is one dated occurrence of this event, with its own dates and place. Enquiries and observations are linked to an edition.</p><p className="mt-2">The enquiry figures are counted from the enquiries, never typed in: open = not won or lost (On hold counts as open); closed = won or lost. Enquiries of a company you cannot access are never counted.</p></>}>
        {editions.length === 0 ? <p className="text-sm text-muted-foreground">No edition yet. Add the first one with “Add first edition”.</p> : (
          <div className="space-y-4">
            {selected && selectedPhase ? (
              <div className="os-card space-y-2 p-3" data-testid="edition-in-focus">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-semibold">{editionLabel(event, selected)}</span>
                  <OsBadge tone={selectedPhase === "past" ? "quiet" : selectedPhase === "ongoing" ? "green" : "blue"}>{PHASE_LABEL[selectedPhase]}</OsBadge>
                  {selected.archived_at ? <OsBadge tone="amber">Archived</OsBadge> : null}
                </p>
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div className="min-w-0"><dt className="text-muted-foreground">Dates</dt><dd>{dateRangeText(selected.start_date, selected.end_date)}</dd></div>
                  <div className="min-w-0"><dt className="text-muted-foreground">Venue and place</dt><dd className="break-words">{placeText(selected, countryLabel) || <span className="text-muted-foreground">Not recorded</span>}</dd></div>
                </dl>
                {selectedCounts ? (
                  <p className="text-sm" data-testid="edition-counts">
                    <span className="tabular-nums"><strong>{selectedCounts.total}</strong> {selectedCounts.total === 1 ? "enquiry" : "enquiries"}: {selectedCounts.open} open, {selectedCounts.won} won, {selectedCounts.lost} lost</span> {scopeNote}
                  </p>
                ) : null}
              </div>
            ) : null}
            {scope.choose ? null : <p className="text-sm">Enquiry figures in this table are {scopeNote}.</p>}
            <Table stack aria-label="Editions of this event">
              <TableHeader>
                <TableRow>
                  <TableHead>Edition</TableHead><TableHead>Dates</TableHead><TableHead>Where</TableHead><TableHead>Status</TableHead>
                  {scope.choose ? null : <><TableHead>Enquiries</TableHead><TableHead>Open</TableHead><TableHead>Closed</TableHead><TableHead>Won</TableHead><TableHead>Lost</TableHead></>}
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editions.map((d) => {
                  const c = countEnquiries(byEdition.get(d.id) ?? []);
                  const phase = editionPhase(d, today);
                  const on = selected?.id === d.id;
                  return (
                    <TableRow key={d.id} className={on ? "bg-secondary/40" : undefined}>
                      <TableCell><Link href={q({ edition: d.id })} aria-current={on ? "true" : undefined} className="font-medium underline-offset-2 hover:underline">{editionLabel(event, d)}</Link>{on ? <span className="ml-2 text-xs text-muted-foreground">shown below</span> : null}</TableCell>
                      <TableCell className="whitespace-nowrap">{dateRangeText(d.start_date, d.end_date)}</TableCell>
                      <TableCell>{placeText(d, countryLabel) || <span className="text-muted-foreground">Not recorded</span>}</TableCell>
                      <TableCell><span className="flex flex-wrap gap-1 max-md:justify-end"><OsBadge tone={phase === "past" ? "quiet" : phase === "ongoing" ? "green" : "blue"}>{PHASE_LABEL[phase]}</OsBadge>{d.archived_at ? <OsBadge tone="amber">Archived</OsBadge> : null}</span></TableCell>
                      {scope.choose ? null : <><TableCell className="tabular-nums">{c.total}</TableCell><TableCell className="tabular-nums">{c.open}</TableCell><TableCell className="tabular-nums">{c.closed}</TableCell><TableCell className="tabular-nums">{c.won}</TableCell><TableCell className="tabular-nums">{c.lost}</TableCell></>}
                      <TableCell data-label={d.archived_at ? undefined : "Actions"}><span className="flex items-center justify-end">{!d.archived_at ? <EditionMenu name={editionLabel(event, d)} values={{ id: d.id, start: d.start_date, end: d.end_date, city: d.city ?? "", country: d.country_code ?? "", venue: d.venue ?? "", note: "" }} /> : null}</span></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {/* ---- 2. The enquiries behind the figures of the edition in focus (same company) ---- */}
      {selected && !scope.choose ? (
        <Panel title={`Enquiries linked to ${editionLabel(event, selected)} (${linked.length})`} description={`For ${scope.label}.`}
          hint="Exactly the enquiries behind the figures above. An enquiry of a company you have no Sales access to is not listed and not counted. Link an enquiry from its Edit details, or when adding the enquiry.">
          {linked.length === 0 ? <p className="text-sm text-muted-foreground">No enquiry of {scope.label} is linked to this edition.</p> : (
            <ul className="divide-y divide-border">
              {linked.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 break-words"><Link href={`/sales/opportunities/${o.id}`} className="font-medium underline-offset-2 hover:underline">{o.reference}</Link> · {o.title}<span className="text-muted-foreground"> · {ctx.companyName(o.company_id)}</span></span>
                  <StageBadge stage={o.stage} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {/* ---- The delivery projects of the edition in focus: only those this person may see in Projects (the database decides); nothing is drawn when there are none ---- */}
      {selected && deliveryProjects === "error" ? <Alert variant="destructive" role="alert" data-testid="delivery-projects-error">The delivery projects of {editionLabel(event, selected)} could not be loaded. Reload to try again.</Alert> : null}
      {selected && deliveryProjects !== "error" && deliveryProjects.length > 0 ? (
        <Panel title={`Delivery projects for ${editionLabel(event, selected)} (${deliveryProjects.length})`} hint="Projects delivered for this edition that you can see in Projects. A project keeps the edition it was handed over with.">
          <ul className="divide-y divide-border" data-testid="delivery-projects">
            {deliveryProjects.map((p) => (
              <li key={p.project_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 break-words"><Link href={`/projects/${p.project_id}`} className="font-medium underline-offset-2 hover:underline">{p.reference}</Link> · {p.name}</span>
                <ProjectStatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ---- 3. Observations: exhibitors compared across editions (shared by every company) ---- */}
      <Panel title="Who exhibited, and with which agency" description="Observations are shared by every company."
        hint={<>One row per exhibitor, recent editions side by side. <strong>No observation</strong> means nobody recorded it (not that they stayed away); <strong>Did not exhibit</strong> was recorded; <strong>Agency unknown</strong> means they exhibited and the agency was not identified. Several stands or agencies in one edition are listed separately; <strong>Unverified</strong> entries are kept and marked.</>}>
        <div className="space-y-3">
          {grid.length === 0 ? <p className="text-sm text-muted-foreground">No observations recorded for {showAll ? "this event" : "the latest editions"} yet. Use “Record an observation”.</p> : (
            <>
              <div className="relative hidden overflow-x-auto md:block">
                <table className="w-full text-sm" aria-label="Exhibitors by edition">
                  <thead><tr className="border-b border-border text-left"><th className="py-2 pr-3 font-medium">Exhibitor</th>{gridEditions.map((d) => <th key={d.id} className="py-2 pr-3 font-medium">{editionLabel({ name: "" }, d).replace(/^ · /, "")}</th>)}</tr></thead>
                  <tbody>
                    {grid.map((r) => (
                      <tr key={r.exhibitorId} className="border-b border-border/60 align-top">
                        <th scope="row" className="py-2 pr-3 text-left font-medium"><Link href={accountHref(r.exhibitorId)} className="underline-offset-2 hover:underline">{r.name}</Link></th>
                        {gridEditions.map((d) => <td key={d.id} className="py-2 pr-3">{cellView(r.cells.get(d.id))}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-3 md:hidden" aria-label="Exhibitors by edition">
                {grid.map((r) => (
                  <li key={r.exhibitorId} className="rounded-lg border border-border p-3">
                    <p className="break-words font-medium"><Link href={accountHref(r.exhibitorId)} className="underline-offset-2 hover:underline">{r.name}</Link></p>
                    <dl className="mt-2 space-y-2">
                      {gridEditions.map((d) => (<div key={d.id}><dt className="text-xs font-medium text-muted-foreground">{editionLabel({ name: "" }, d).replace(/^ · /, "")}</dt><dd>{cellView(r.cells.get(d.id))}</dd></div>))}
                    </dl>
                  </li>
                ))}
              </ul>
            </>
          )}
          {editions.length > GRID_EDITIONS ? <p className="text-sm"><Link href={q({ all: showAll ? "" : "1" })} className="underline underline-offset-2">{showAll ? `Show only the latest ${GRID_EDITIONS} editions` : `Show all ${editions.length} editions`}</Link></p> : null}
        </div>
      </Panel>

      {/* ---- 4. Outreach leads for the edition in focus ---- */}
      {selected ? (
        <Panel title={`Agencies to contact for ${editionLabel(event, selected)}`} description={`Leads to approach, not confirmed for ${yearOfLabel(selected.start_date)}.`}
          hint={<>Every agency recorded at an <strong>earlier</strong> edition of this event. If one agency built a client&apos;s stand one year and another the next, both are listed. Open the account for its contacts and to start or log outreach and follow-ups.</>}>
          {leads.length === 0 ? <p className="text-sm text-muted-foreground">No agency is recorded at an earlier edition yet.</p> : (
            <ul className="divide-y divide-border" aria-label="Past agencies">
              {leads.map((l) => {
                const org: EventOrg | undefined = orgs.get(l.agencyId);
                return (
                  <li key={l.agencyId} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0 space-y-1">
                      <p className="break-words font-medium">
                        <Link href={accountHref(l.agencyId)} className="underline-offset-2 hover:underline">{nameOf(l.agencyId)}</Link>
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
                      <Link href={accountHref(l.agencyId, "#outreach")} className={buttonVariants({ variant: "outline", size: "sm" })}>Open account · outreach &amp; follow-up</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      ) : null}

      {editValues ? <EditObservationDialog values={editValues} orgs={orgsForForm} closeHref={q({ edit: "" })} /> : null}
      {typeof sp.edit === "string" && !editValues ? <Alert role="status">That observation can be changed only by the person who recorded it or a founder.</Alert> : null}
    </div>
  );
}

const yearOfLabel = (date: string) => date.slice(0, 4);
