import "server-only";
import { companyTimeZone, CRM_TIME_ZONE, isSkippedLocalTime, timeZoneCity, zonedDateTimeToIso } from "@enginious-hr/domain";

/**
 * The clock a follow-up deadline is typed on: the Sales time zone of the company the follow-up belongs to (crm_company_settings.follow_up_time_zone, migration
 * 20270112000500; Asia/Dubai unless the company set another, and on a database without the setting). Resolved on the server for every save, from the record
 * itself, never from the form: a deadline can never be saved on another company's clock by a changed request.
 */

type Res = { data?: unknown; error?: { message: string } | null };
/** The little of the database client this needs (so it takes the real client and a test's stand-in alike). */
interface Reader { from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<Res> } } } }

export type ZoneKey = { companyId: string } | { opportunityId: string } | { followUpId: string };
export type ZoneResult = { zone: string } | { error: string };

const COULD_NOT_CHECK = "Could not check which time zone this company's follow-ups use, so nothing was saved. What you entered is still here: try again.";

async function companyOf(supabase: Reader, table: "crm_opportunities" | "crm_follow_ups", id: string): Promise<{ companyId: string | null } | { error: true }> {
  const r = await supabase.from(table).select("company_id").eq("id", id).maybeSingle();
  if (r.error) return { error: true };
  const companyId = (r.data as { company_id?: unknown } | null)?.company_id;
  return { companyId: typeof companyId === "string" ? companyId : null };
}

/**
 * The zone for a save. A record this person cannot read comes back as no row: the zone is then the default and the database function, which checks access itself,
 * refuses the save in its own words. A read that FAILS is different: nothing is saved, and the person is told.
 */
export async function followUpZone(supabase: unknown, key: ZoneKey): Promise<ZoneResult> {
  const db = supabase as Reader;
  try {
    let companyId: string | null;
    if ("companyId" in key) companyId = key.companyId;
    else {
      const found = "opportunityId" in key ? await companyOf(db, "crm_opportunities", key.opportunityId) : await companyOf(db, "crm_follow_ups", key.followUpId);
      if ("error" in found) return { error: COULD_NOT_CHECK };
      companyId = found.companyId;
    }
    if (!companyId) return { zone: CRM_TIME_ZONE };
    const s = await db.from("crm_company_settings").select("*").eq("company_id", companyId).maybeSingle();
    if (s.error) return { error: COULD_NOT_CHECK };
    return { zone: companyTimeZone(s.data as { follow_up_time_zone?: string | null } | null) };
  } catch (e) {
    console.error("[crm] follow-up time zone lookup failed", e);
    return { error: COULD_NOT_CHECK };
  }
}

/**
 * The moment to store for a date and a time typed on the clock of `zone` (a missing or malformed time is 09:00, as before). A time that does not exist that day
 * in that zone (the hour skipped when the clocks go forward) is refused in words that say why; it is never moved to another time.
 */
export function dueInZone(zone: string, date: string | undefined, time: string | undefined, invalid = "Enter a valid date and time."): { iso: string } | { error: string } {
  if (!date) return { error: invalid };
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : "09:00";
  const iso = zonedDateTimeToIso(zone, date, t);
  if (iso) return { iso };
  if (isSkippedLocalTime(zone, date, t)) return { error: `${t} does not exist on that date in ${timeZoneCity(zone)}: the clocks go forward that night. Choose another time.` };
  return { error: invalid };
}

/** Both steps: the company's zone for this record, then the moment. */
export async function dueFor(supabase: unknown, key: ZoneKey, date: string | undefined, time: string | undefined, invalid?: string): Promise<{ iso: string; zone: string } | { error: string }> {
  const z = await followUpZone(supabase, key);
  if ("error" in z) return z;
  const d = dueInZone(z.zone, date, time, invalid);
  return "error" in d ? d : { iso: d.iso, zone: z.zone };
}
