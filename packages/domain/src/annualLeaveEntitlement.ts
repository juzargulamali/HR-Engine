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

export interface AnnualLeaveEntitlementToDateInput {
  countryCode: "AE" | "SA" | "PL";
  hireDate: string;
  asOfDate: string;
  /** Poland only — see PolandAnnualLeaveInput. Ignored for AE/SA. */
  recognisedPriorServiceYears?: number;
  /** Poland only — see PolandAnnualLeaveInput. Ignored for AE/SA. */
  fteFraction?: number;
}

/**
 * Single dispatcher the real accrual cron calls: cumulative Annual Leave
 * entitlement earned to date, in the resolved country's own rule shape.
 * The cron posts the ledger a running total's worth of accrual entries by
 * diffing this against what it already posted — see
 * apps/web/src/app/api/cron/leave-accrual/route.ts.
 */
export function computeAnnualLeaveEntitlementToDate(input: AnnualLeaveEntitlementToDateInput): number {
  const { countryCode, hireDate, asOfDate, recognisedPriorServiceYears = 0, fteFraction = 1 } = input;

  if (countryCode === "AE") return computeUaeAnnualLeaveEntitlementDays(hireDate, asOfDate);
  if (countryCode === "SA") return computeSaudiAnnualLeaveEntitlementDays(hireDate, asOfDate);

  // Poland: a fresh annual grant vests at each completed-year anniversary;
  // the first year instead vests proportionally per completed month
  // (Kodeks pracy Art. 153 §1). Years after the first reuse the CURRENT
  // rate for every completed year since — a deliberate simplification
  // given recognised prior service and FTE rarely change mid-service; a
  // rate change from crossing the 10-year threshold only affects years
  // from that point forward under this approximation, not a full
  // historical recompute of every prior year at its own then-current rate.
  const completedMonths = completedMonthsBetween(hireDate, asOfDate);
  const completedYears = Math.floor(completedMonths / 12);
  const annualAtHire = computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 0, recognisedPriorServiceYears, fteFraction });
  if (completedYears < 1) {
    return computePolandFirstYearAccruedDays(annualAtHire, completedMonths);
  }
  const currentAnnual = computePolandAnnualLeaveEntitlementDays({
    completedServiceYears: completedYears,
    recognisedPriorServiceYears,
    fteFraction,
  });
  return round2(annualAtHire + Math.max(0, completedYears - 1) * currentAnnual);
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
