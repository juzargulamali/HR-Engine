import type { CrmAgencyRole, CrmEventEditionRow, CrmEventKind, CrmEventRow, CrmObservationRow } from "@/types/crm";

/**
 * Events & Exhibitions: the pure rules the screens share (labels, edition status, counts, the exhibitor comparison and the outreach leads). The database owns
 * who may do what (migration 20261224000100); nothing here infers participation, an agency or a stand from anything that was not recorded.
 */

export const EVENT_KIND_LABEL: Record<CrmEventKind, string> = { exhibition: "Exhibition", conference: "Conference", other: "Other event" };
export const AGENCY_ROLES: readonly CrmAgencyRole[] = ["stand_builder", "stand_design", "av_technology", "fabrication", "other"];
export const AGENCY_ROLE_LABEL: Record<CrmAgencyRole, string> = { stand_builder: "Stand builder", stand_design: "Stand design", av_technology: "AV / technology", fabrication: "Fabrication", other: "Other role" };

export type EventLite = Pick<CrmEventRow, "id" | "name" | "kind" | "website" | "archived_at">;
export type EditionLite = Pick<CrmEventEditionRow, "id" | "event_id" | "start_date" | "end_date" | "city" | "country_code" | "venue" | "archived_at">;

export const yearOf = (isoDate: string): string => isoDate.slice(0, 4);

/** "GITEX Global · 2027 · Dubai": what an enquiry and every picker call an edition. The city is left out when it is not recorded. */
export const editionLabel = (e: Pick<EventLite, "name">, d: Pick<EditionLite, "start_date" | "city">): string => `${e.name} · ${yearOf(d.start_date)}${d.city ? ` · ${d.city}` : ""}`;

export type EditionPhase = "upcoming" | "ongoing" | "past";
/** `today` is the Dubai calendar day (YYYY-MM-DD). Dates are whole days: an edition ending today is still ongoing. */
export function editionPhase(d: Pick<EditionLite, "start_date" | "end_date">, today: string): EditionPhase {
  if (d.end_date < today) return "past";
  if (d.start_date > today) return "upcoming";
  return "ongoing";
}
export const PHASE_LABEL: Record<EditionPhase, string> = { upcoming: "Upcoming", ongoing: "On now", past: "Past" };

/** "13 to 17 Oct 2025", "30 Oct to 2 Nov 2025", or one day. */
export function dateRangeText(start: string, end: string): string {
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
  if (start === end) return f(start, { day: "numeric", month: "short", year: "numeric" });
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const head = sameMonth ? f(start, { day: "numeric" }) : sameYear ? f(start, { day: "numeric", month: "short" }) : f(start, { day: "numeric", month: "short", year: "numeric" });
  return `${head} to ${f(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Where an edition is: venue, city, country, whatever is recorded (empty when nothing is). */
export function placeText(d: Pick<EditionLite, "venue" | "city" | "country_code">, countryName: (code: string) => string): string {
  return [d.venue, d.city, d.country_code ? countryName(d.country_code) : null].filter(Boolean).join(", ");
}

// ------------------------------------------------------------------------------------------------------------------------------ counts
export interface StageCounts { total: number; open: number; closed: number; won: number; lost: number }
/** The existing CRM status rules: open = not won and not lost (On hold counts as open); closed = won or lost. Computed from the enquiries, never kept as a total. */
export function countEnquiries(opps: readonly { stage: string }[]): StageCounts {
  const won = opps.filter((o) => o.stage === "won").length;
  const lost = opps.filter((o) => o.stage === "lost").length;
  return { total: opps.length, open: opps.length - won - lost, closed: won + lost, won, lost };
}

export interface LinkedEnquiry { id: string; company_id: string; reference: string; title: string; stage: string; event_edition_id: string | null; agency_org_id: string | null; client_org_id: string | null }
/** Enquiries per edition, from the enquiries the VIEWER can read; `companyId` null = every company they can read. The figures and the drill-down list come from this ONE filter. */
export function enquiriesByEdition(opps: readonly LinkedEnquiry[], companyId: string | null): Map<string, LinkedEnquiry[]> {
  const out = new Map<string, LinkedEnquiry[]>();
  for (const o of opps) {
    if (!o.event_edition_id || (companyId !== null && o.company_id !== companyId)) continue;
    out.set(o.event_edition_id, [...(out.get(o.event_edition_id) ?? []), o]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------------ observations
export type ObservationLite = Pick<CrmObservationRow, "id" | "edition_id" | "exhibitor_org_id" | "kind" | "agency_org_id" | "agency_unknown" | "stand_no" | "agency_role" | "note" | "verification" | "created_by" | "created_at">;

/** What one exhibitor's cell of one edition says. "No observation" is the ABSENCE of a record and is never the same as "Did not exhibit". */
export type CellState = "no_observation" | "did_not_exhibit" | "exhibited";
export interface ExhibitorCell { state: CellState; observations: ObservationLite[] }

/** A short line for one observation: agency (or "Agency unknown"), stand, role, and "unverified" when it is not confirmed. */
export function observationLine(o: ObservationLite, agencyName: (id: string) => string): string {
  if (o.kind === "did_not_exhibit") return `Did not exhibit${o.verification === "unverified" ? " (unverified)" : ""}`;
  const who = o.agency_unknown || !o.agency_org_id ? "Agency unknown" : agencyName(o.agency_org_id);
  const parts = [who, o.stand_no ? `stand ${o.stand_no}` : null, o.agency_role ? AGENCY_ROLE_LABEL[o.agency_role] : null].filter(Boolean).join(" · ");
  return o.verification === "unverified" ? `${parts} (unverified)` : parts;
}

export interface ExhibitorRow { exhibitorId: string; name: string; cells: Map<string, ExhibitorCell> }

/**
 * One row per exhibitor that has at least one observation at any of `editions`, one cell per edition (several observations stay several lines: several stands, roles
 * or agencies in one edition are never merged). Rows are A to Z by name. An edition where the exhibitor has no record reads "No observation".
 */
export function buildExhibitorGrid(editions: readonly Pick<EditionLite, "id">[], observations: readonly ObservationLite[], nameOf: (orgId: string) => string): ExhibitorRow[] {
  const wanted = new Set(editions.map((e) => e.id));
  const byExhibitor = new Map<string, ObservationLite[]>();
  for (const o of observations) if (wanted.has(o.edition_id)) byExhibitor.set(o.exhibitor_org_id, [...(byExhibitor.get(o.exhibitor_org_id) ?? []), o]);
  return [...byExhibitor.entries()]
    .map(([exhibitorId, list]) => {
      const cells = new Map<string, ExhibitorCell>();
      for (const e of editions) {
        const here = list.filter((o) => o.edition_id === e.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
        const state: CellState = here.length === 0 ? "no_observation" : here.some((o) => o.kind === "exhibited") ? "exhibited" : "did_not_exhibit";
        cells.set(e.id, { state, observations: here });
      }
      return { exhibitorId, name: nameOf(exhibitorId), cells };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.exhibitorId.localeCompare(b.exhibitorId));
}

// ------------------------------------------------------------------------------------------------------------------------------ outreach leads
export interface LeadSighting { editionId: string; year: string; exhibitorId: string; standNo: string | null; role: CrmAgencyRole | null; verification: "unverified" | "confirmed" }
export interface AgencyLead { agencyId: string; sightings: LeadSighting[]; confirmed: boolean }

/**
 * Agencies to contact for `editionId`: every agency recorded at an EARLIER edition of the same event, however many years ago and whichever exhibitor it worked for.
 * Two agencies for the same exhibitor in two years are BOTH leads; neither is treated as confirmed for this edition. Agencies recorded "unknown" are not leads (there
 * is nobody to contact). `confirmed` says only that at least one sighting was confirmed, not that the agency is booked.
 */
export function outreachLeads(editions: readonly Pick<EditionLite, "id" | "start_date">[], observations: readonly ObservationLite[], editionId: string): AgencyLead[] {
  const target = editions.find((e) => e.id === editionId);
  if (!target) return [];
  const earlier = new Map(editions.filter((e) => e.start_date < target.start_date).map((e) => [e.id, e]));
  const byAgency = new Map<string, LeadSighting[]>();
  for (const o of observations) {
    const ed = earlier.get(o.edition_id);
    if (!ed || o.kind !== "exhibited" || o.agency_unknown || !o.agency_org_id) continue;
    byAgency.set(o.agency_org_id, [...(byAgency.get(o.agency_org_id) ?? []), { editionId: ed.id, year: yearOf(ed.start_date), exhibitorId: o.exhibitor_org_id, standNo: o.stand_no, role: o.agency_role, verification: o.verification }]);
  }
  return [...byAgency.entries()].map(([agencyId, sightings]) => ({
    agencyId,
    sightings: sightings.sort((a, b) => b.year.localeCompare(a.year) || a.exhibitorId.localeCompare(b.exhibitorId)),
    confirmed: sightings.some((s) => s.verification === "confirmed"),
  }));
}

/** Highest outreach priority first, Unrated last; then the most recent sighting, then name. */
export function sortLeads(leads: readonly AgencyLead[], priorityOf: (id: string) => number | null, nameOf: (id: string) => string): AgencyLead[] {
  return [...leads].sort((a, b) => (priorityOf(b.agencyId) ?? 0) - (priorityOf(a.agencyId) ?? 0)
    || (b.sightings[0]?.year ?? "").localeCompare(a.sightings[0]?.year ?? "") || nameOf(a.agencyId).localeCompare(nameOf(b.agencyId)));
}

// ------------------------------------------------------------------------------------------------------------------------------ list filters
export type WhenFilter = "upcoming" | "past" | "all";
export interface EventFilters { q: string; country: string; when: WhenFilter; from: string; to: string; archived: boolean }
export const EMPTY_EVENT_FILTERS: EventFilters = { q: "", country: "", when: "upcoming", from: "", to: "", archived: false };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function eventFiltersFromParams(sp: Record<string, string | string[] | undefined>): EventFilters {
  const when = one(sp.when);
  const country = one(sp.country).trim().toUpperCase();
  return {
    q: one(sp.q).trim(),
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    when: when === "past" || when === "all" || when === "upcoming" ? when : "upcoming",
    from: isDate(one(sp.from)) ? one(sp.from) : "",
    to: isDate(one(sp.to)) ? one(sp.to) : "",
    archived: one(sp.archived) === "1",
  };
}
export const hasEventFilters = (f: EventFilters) => f.q !== "" || f.country !== "" || f.when !== "upcoming" || f.from !== "" || f.to !== "" || f.archived;

export interface EditionRow { event: EventLite; edition: EditionLite }
/**
 * Editions worldwide, filtered by event name, country and date. A from / to date wins over "upcoming / past" (it IS the date filter): an edition matches when it overlaps
 * the range. Upcoming (the default) includes an edition that is on now. Upcoming sorts soonest first, past and all newest first.
 */
export function filterEditions(rows: readonly EditionRow[], f: EventFilters, today: string): EditionRow[] {
  const needle = f.q.toLowerCase();
  const out = rows.filter(({ event, edition }) => {
    if (!f.archived && (event.archived_at || edition.archived_at)) return false;
    if (needle && !`${event.name} ${edition.city ?? ""} ${edition.venue ?? ""}`.toLowerCase().includes(needle)) return false;
    if (f.country && edition.country_code !== f.country) return false;
    if (f.from || f.to) return (!f.from || edition.end_date >= f.from) && (!f.to || edition.start_date <= f.to);
    const phase = editionPhase(edition, today);
    return f.when === "all" || (f.when === "upcoming" ? phase !== "past" : phase === "past");
  });
  const asc = f.when === "upcoming" && !f.from && !f.to;
  return out.sort((a, b) => (asc ? a.edition.start_date.localeCompare(b.edition.start_date) : b.edition.start_date.localeCompare(a.edition.start_date)) || a.event.name.localeCompare(b.event.name));
}
