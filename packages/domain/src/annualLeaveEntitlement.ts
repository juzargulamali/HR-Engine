/**
 * Regional Annual Leave entitlement calculators (phase2b/leave-policy-configuration).
 * Pure functions only — the actual leave-type row an employee accrues
 * against still lives in policy_leave_types (accrual_method /
 * accrual_rate_per_period / per-service-year rate), same as every other
 * country's rules in this system; these functions compute the INPUTS that
 * feed that configuration (which annual rate currently applies, how many
 * days a partial first year has accrued), not a competing accrual engine.
 *
 * Dates are plain 'YYYY-MM-DD' strings, compared/parsed the same way as
 * resolveContractAsOf and resolvePolicyVersionAsOf elsewhere in this
 * package — never a JS Date across a timezone boundary.
 */

function dateParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

/**
 * Number of full calendar months between two dates — a month only counts
 * once `asOf`'s day-of-month has reached `from`'s (e.g. hired on the 15th,
 * "one completed month" is the 15th of the next month, not the 1st).
 */
export function completedMonthsBetween(from: string, asOf: string): number {
  const f = dateParts(from);
  const a = dateParts(asOf);
  let months = (a.year - f.year) * 12 + (a.month - f.month);
  if (a.day < f.day) months -= 1;
  return Math.max(0, months);
}

export function completedYearsBetween(from: string, asOf: string): number {
  return Math.floor(completedMonthsBetween(from, asOf) / 12);
}

/**
 * UAE Annual Leave: 30 calendar days per completed year of service once a
 * full year is reached; before that, two calendar days for each completed
 * month once six months have been completed (nothing before six months —
 * the rule set doesn't define a partial entitlement earlier than that).
 * Returns the entitlement accrued so far as of `asOfDate`, in days —
 * combine with computeLeaveDays({ deductionMode: "calendarDays" }) for
 * deducting an actual request against it.
 */
export function computeUaeAnnualLeaveEntitlementDays(hireDate: string, asOfDate: string): number {
  const completedMonths = completedMonthsBetween(hireDate, asOfDate);
  if (completedMonths >= 12) {
    return completedYearsBetween(hireDate, asOfDate) * 30;
  }
  if (completedMonths >= 6) {
    return completedMonths * 2;
  }
  return 0;
}

/**
 * Saudi Arabia Annual Leave: the annual RATE currently in effect (not an
 * accrued balance) — 21 calendar days/year for under five consecutive
 * years of service, 30 calendar days/year from the start of the fifth
 * year onward. Feeds policy_leave_types' per-service-year accrual rate;
 * combine with computeLeaveDays({ deductionMode: "calendarDays",
 * extendForHolidays: true }) for deducting an actual request.
 */
export function computeSaudiAnnualLeaveRateDaysPerYear(hireDate: string, asOfDate: string): number {
  return completedYearsBetween(hireDate, asOfDate) >= 5 ? 30 : 21;
}

/**
 * Saudi Arabia Annual Leave: cumulative entitlement earned to date (not
 * just the current rate) — each completed year is credited at whatever
 * rate applied for THAT year (21/year for the first five, 30/year from the
 * sixth year on), summed. This is what the real accrual cron needs to
 * compute a delta against what has already been posted; the plain rate
 * function above stays as the "what applies right now" figure used
 * elsewhere.
 */
export function computeSaudiAnnualLeaveEntitlementDays(hireDate: string, asOfDate: string): number {
  const years = completedYearsBetween(hireDate, asOfDate);
  const yearsAtBaseRate = Math.min(years, 5);
  const yearsAtHigherRate = Math.max(0, years - 5);
  return yearsAtBaseRate * 21 + yearsAtHigherRate * 30;
}

/** An FTE fraction that took effect on a given date — one entry per
 * employment_contracts row's (start_date, fte_fraction), covering the whole
 * tenure. Order doesn't matter; resolveFteFractionAsOf sorts internally. */
export interface FteFractionPeriod {
  effectiveFrom: string;
  fteFraction: number;
}

export interface AnnualLeaveEntitlementToDateInput {
  countryCode: "AE" | "SA" | "PL";
  hireDate: string;
  asOfDate: string;
  /** Poland only — see PolandAnnualLeaveInput. Ignored for AE/SA. */
  recognisedPriorServiceYears?: number;
  /**
   * Poland only — REQUIRED for a Poland calculation to run at all.
   * An explicit HR-confirmed fact (employees.is_first_ever_employment):
   *   true  = this is the employee's first job of their working life, ever
   *           — Kodeks pracy Art. 153 §1's progressive monthly-proration
   *           first year applies.
   *   false = they have worked before — anywhere, at any employer, at any
   *           point in their life — even if this is their first year AT
   *           ENGINIOUS specifically. Art. 1551's calendar-year
   *           proportional entitlement applies instead.
   * NEVER inferred from hireDate (a new Enginious hire is not necessarily a
   * first-time worker), and NEVER inferred from recognisedPriorServiceYears
   * being zero or unset (that field can be zero simply because HR hasn't
   * recorded any service recognised toward the 10-year threshold, which is
   * a different fact from "has never held a job before"). undefined/null
   * means HR has not yet confirmed this fact: the calculation returns
   * `null` (blocked) rather than guess.
   */
  isFirstEverEmployment?: boolean | null;
  /**
   * Poland only — REQUIRED for a Poland calculation to run at all (a
   * missing or empty history also returns `null`, blocked). Effective-dated
   * FTE history covering the employee's whole tenure, so a mid-service FTE
   * change (a later employment_contracts row) prices only the years it
   * actually affects — never a single current fte_fraction blanket-applied
   * across the employee's entire history, which is what silently
   * mispriced the years before an FTE change.
   */
  fteFractionHistory?: readonly FteFractionPeriod[];
}

function resolveFteFractionAsOf(history: readonly FteFractionPeriod[], asOfDate: string): number {
  let result = 1;
  for (const period of [...history].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0))) {
    if (period.effectiveFrom <= asOfDate) result = period.fteFraction;
  }
  return result;
}

/** Adds `months` calendar months to `dateISO`, clamping the day-of-month to
 * the target month's last day (e.g. 31 Jan + 1 month -> 28/29 Feb) — the
 * usual "add months" convention, needed to find each anniversary year's own
 * start date for looking up that year's applicable FTE fraction. */
function addMonths(dateISO: string, months: number): string {
  const { year, month, day } = dateParts(dateISO);
  const totalMonths = month - 1 + months;
  const newYear = year + Math.floor(totalMonths / 12);
  const newMonth = (((totalMonths % 12) + 12) % 12) + 1;
  const lastDayOfNewMonth = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfNewMonth);
  return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/**
 * Single dispatcher the real accrual cron calls: cumulative Annual Leave
 * entitlement earned to date, in the resolved country's own rule shape.
 * The cron posts the ledger a running total's worth of accrual entries by
 * diffing this against what it already posted — see
 * apps/web/src/app/api/cron/leave-accrual/route.ts.
 *
 * Returns `null` when Poland's required facts (isFirstEverEmployment,
 * fteFractionHistory) haven't been confirmed/recorded by HR yet — the
 * caller must treat that as "block automatic accrual for this employee and
 * surface the configuration requirement," never substitute a guessed
 * default. AE/SA never return null: nothing about their rules is
 * indeterminate from hireDate/asOfDate alone.
 */
export function computeAnnualLeaveEntitlementToDate(input: AnnualLeaveEntitlementToDateInput): number | null {
  const { countryCode, hireDate, asOfDate, recognisedPriorServiceYears = 0 } = input;

  if (countryCode === "AE") return computeUaeAnnualLeaveEntitlementDays(hireDate, asOfDate);
  if (countryCode === "SA") return computeSaudiAnnualLeaveEntitlementDays(hireDate, asOfDate);

  const { isFirstEverEmployment, fteFractionHistory } = input;
  if (isFirstEverEmployment === undefined || isFirstEverEmployment === null) return null;
  if (!fteFractionHistory || fteFractionHistory.length === 0) return null;

  return isFirstEverEmployment
    ? computePolandFirstEverEmploymentEntitlementToDate(hireDate, asOfDate, recognisedPriorServiceYears, fteFractionHistory)
    : computePolandExperiencedHireEntitlementToDate(hireDate, asOfDate, recognisedPriorServiceYears, fteFractionHistory);
}

/**
 * Kodeks pracy Art. 153 §1 — an employee's first-ever job: 1/12 of the
 * annual entitlement per completed month of service until the first
 * anniversary, then the full annual entitlement at each anniversary after
 * that. Unlike the earlier version of this function (which applied
 * whatever rate/FTE was current TODAY to every year since the first),
 * every completed year is priced using the recognised-service rate and FTE
 * fraction that actually applied DURING that specific year — so a 10-year-
 * threshold crossing or a mid-service FTE change only affects the years
 * from that point forward, never restated across earlier years that
 * already vested under a different rate.
 */
function computePolandFirstEverEmploymentEntitlementToDate(
  hireDate: string,
  asOfDate: string,
  recognisedPriorServiceYears: number,
  fteFractionHistory: readonly FteFractionPeriod[],
): number {
  const completedMonths = completedMonthsBetween(hireDate, asOfDate);
  const completedYears = Math.floor(completedMonths / 12);

  const fteAtHire = resolveFteFractionAsOf(fteFractionHistory, hireDate);
  const annualAtHire = computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 0, recognisedPriorServiceYears, fteFraction: fteAtHire });
  if (completedYears < 1) {
    return computePolandFirstYearAccruedDays(annualAtHire, completedMonths);
  }

  let total = annualAtHire; // year 1, fully vested at its own first-year rate/FTE
  for (let yearIndex = 1; yearIndex < completedYears; yearIndex++) {
    const yearStartDate = addMonths(hireDate, yearIndex * 12);
    const fteForYear = resolveFteFractionAsOf(fteFractionHistory, yearStartDate);
    total += computePolandAnnualLeaveEntitlementDays({ completedServiceYears: yearIndex, recognisedPriorServiceYears, fteFraction: fteForYear });
  }
  return round2(total);
}

/**
 * Kodeks pracy Art. 1551 — an employee who has worked before (anywhere, at
 * any point in their life — NOT specifically about whether it's their
 * first year at Enginious) is not subject to Art. 153's progressive
 * first-year proration. Instead they receive, immediately from their hire
 * date, a proportional entitlement for the remaining months of that
 * calendar year, then the FULL annual entitlement from 1 January of each
 * subsequent calendar year (Polish practice grants a continuing employee's
 * whole-year entitlement at the start of the year, not accrued
 * progressively through it) — each year priced at the recognised-service
 * rate and FTE fraction that applied AT THE START of that specific
 * calendar year, for the same reason as the first-ever-employment case.
 */
function computePolandExperiencedHireEntitlementToDate(
  hireDate: string,
  asOfDate: string,
  recognisedPriorServiceYears: number,
  fteFractionHistory: readonly FteFractionPeriod[],
): number {
  const hireYear = dateParts(hireDate).year;
  const asOfYear = dateParts(asOfDate).year;

  const fteAtHire = resolveFteFractionAsOf(fteFractionHistory, hireDate);
  const hireYearRate = computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 0, recognisedPriorServiceYears, fteFraction: fteAtHire });
  const monthsRemainingInHireYear = 12 - dateParts(hireDate).month + 1;
  let total = round2((hireYearRate / 12) * monthsRemainingInHireYear);

  for (let year = hireYear + 1; year <= asOfYear; year++) {
    const yearStart = `${String(year).padStart(4, "0")}-01-01`;
    const completedServiceYears = completedYearsBetween(hireDate, yearStart);
    const fteForYear = resolveFteFractionAsOf(fteFractionHistory, yearStart);
    total += computePolandAnnualLeaveEntitlementDays({ completedServiceYears, recognisedPriorServiceYears, fteFraction: fteForYear });
  }
  return round2(total);
}

export interface PolandAnnualLeaveInput {
  /** Actual tenure with Enginious, in completed years, as of the date being evaluated. */
  completedServiceYears: number;
  /**
   * HR-controlled input: prior service/education years the company has
   * recognised toward the statutory threshold (Kodeks pracy Art. 154 —
   * education can count toward the service-length calculation). Never
   * computed automatically; this system has no field that models it
   * correctly today, so it is entered by HR as a plain number of years
   * and added on top of actual tenure here. Defaults to 0 (no recognised
   * prior service) if not supplied.
   */
  recognisedPriorServiceYears?: number;
  /** 1.0 for full-time; a fraction (e.g. 0.5) for part-time, prorating the result. Defaults to 1.0. */
  fteFraction?: number;
}

/**
 * Poland Annual Leave: 20 working days/year under 10 years of legally
 * recognised service (actual tenure + any HR-recognised prior service),
 * 26 working days/year at 10+ years. Prorated for part-time by
 * `fteFraction`. Use with computeLeaveDays({ deductionMode: "workingDays" })
 * (the existing default) for deducting an actual request — Poland already
 * matches that mode exactly, no country-specific deduction change needed.
 */
export function computePolandAnnualLeaveEntitlementDays(input: PolandAnnualLeaveInput): number {
  const { completedServiceYears, recognisedPriorServiceYears = 0, fteFraction = 1 } = input;
  const recognisedServiceYears = completedServiceYears + Math.max(0, recognisedPriorServiceYears);
  const baseDays = recognisedServiceYears >= 10 ? 26 : 20;
  return round2(baseDays * clampFraction(fteFraction));
}

/**
 * Poland first-time employee accrual: 1/12 of the annual entitlement after
 * each completed month of the first year, capped at the full annual
 * amount once 12 months have passed (Kodeks pracy Art. 153 §1).
 */
export function computePolandFirstYearAccruedDays(annualEntitlementDays: number, completedMonthsOfService: number): number {
  const months = Math.max(0, Math.min(12, Math.floor(completedMonthsOfService)));
  return round2((annualEntitlementDays / 12) * months);
}

/**
 * Poland leave is deducted against scheduled working TIME, not a flat
 * day-count — a day normally equals eight hours, so a part-time
 * schedule's shorter day converts to a fractional day of entitlement
 * consumed, rather than a whole day for a partial shift.
 */
export function computePolandLeaveDaysFromHours(hoursRequested: number, scheduledHoursPerDay = 8): number {
  if (scheduledHoursPerDay <= 0) return 0;
  return round2(hoursRequested / scheduledHoursPerDay);
}

function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  return Math.min(fraction, 1);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
