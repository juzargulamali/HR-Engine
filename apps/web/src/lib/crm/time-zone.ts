import { companyTimeZone, CRM_TIME_ZONE, timeZoneCity } from "@enginious-hr/domain";

/**
 * Follow-up deadlines are typed and shown on the clock of the company they belong to (its Sales setting; Asia/Dubai unless the company set another).
 *
 * THE RULE when one person sees several companies in one list (Follow-ups, Enquiries, My Day): each row is judged and shown on ITS OWN company's clock, and the
 * place is written next to the time on every row ("19 Oct 2026, 15:00 (Warsaw)"). "Today" is that company's calendar day; "overdue" is the moment having passed,
 * which is the same everywhere. Nothing is converted to the reader's own zone: two people in two countries read the same words for the same follow-up.
 *
 * Pure: the zone comes from the companies the page already loaded (CrmContext.companies), so no page reads anything extra for it.
 */
export type ZoneOf = (companyId: string | null | undefined) => string;

/** The zone of each company the person can see. A company that is not among them (or has no settings yet) reads as Asia/Dubai. */
export function zoneOfCompanies(companies: readonly { id: string; settings: { follow_up_time_zone?: string | null } | null }[] | null | undefined): ZoneOf {
  const by = new Map((companies ?? []).map((c) => [c.id, companyTimeZone(c.settings)]));
  return (companyId) => (companyId ? (by.get(companyId) ?? CRM_TIME_ZONE) : CRM_TIME_ZONE);
}

/** Every company on the Dubai clock: what a caller that knows no company uses (and what every screen did before). */
export const DUBAI_ZONE: ZoneOf = () => CRM_TIME_ZONE;

/** The label of a time field: "Time (Warsaw)". The place is always named, so nobody has to know which clock a field means. */
export const dueTimeLabel = (zone: string) => `Time (${timeZoneCity(zone)})`;

/** "Warsaw time", for sentences. */
export const zoneWords = (zone: string) => `${timeZoneCity(zone)} time`;

/**
 * What does NOT follow a company's zone in this release (owner decision, 2026-11-15) and still runs on the Dubai clock for every company. Said in Sales settings
 * next to the zone, and in the staff guidance, so nobody assumes otherwise.
 */
export const STILL_ON_DUBAI_CLOCK = "Still on Dubai time for every company: the reminder for a hold's review date, the daily reminder for an enquiry with no next action, the dates of the Sales reports, and anything JARVIS saves or lists.";
