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
 * package — never a JS Date across a timezone boundary (Date.UTC is used
 * only for pure calendar arithmetic — days-in-month, adding a day — never
 * to read a local-timezone "now").
 *
 * POLAND — Enginious company benefit (supersedes the statutory Kodeks pracy
 * Art. 153/154 tiered-threshold rules this file previously implemented):
 *   - Every Poland employee, regardless of tenure, prior service, or
 *     whether this is their first-ever job, receives POLAND_ANNUAL_LEAVE_
 *     BASE_DAYS (26) working days of Annual Leave for a complete calendar
 *     year, full-time. This is a flat company benefit decision, not a
 *     computation of the statutory 20-or-26-day threshold — the 10-year
 *     recognised-service threshold, the Art. 153 §1 first-ever-employment
 *     progressive-monthly-accrual mechanism, and Art. 154's mid-year
 *     "urlop uzupełniający" supplementary-leave mechanic are NOT
 *     implemented or relied upon anywhere in this file.
 *   - The PRORATION METHOD for a new starter's or leaver's partial year is
 *     retained from Art. 1551 + Art. 1553 §1 established practice: the
 *     remaining WHOLE calendar months of the hire year (a partial month
 *     counts in full) are priced against the full annual rate, rounded UP
 *     to a whole day; the full annual amount is available immediately from
 *     each subsequent 1 January, also rounded up. Only the BASE RATE
 *     changed (flat 26 instead of a threshold-dependent 20-or-26) — the
 *     rounding/proration mechanics themselves are unchanged.
 *   - A part-time employee's FTE-prorated entitlement is always rounded UP
 *     to a full day, never to the nearest day (established rounding
 *     practice, same as before).
 *   - This calculator only ever computes automatically when a period (the
 *     hire year, or a subsequent full calendar year) is covered by a
 *     SINGLE, constant FTE fraction throughout. A period where FTE changes
 *     at all — whatever the split would otherwise work out to — BLOCKS
 *     automatic accrual entirely, the same as a data gap or ambiguous
 *     contract history: HR must post the confirmed amount through the
 *     existing audited postLeaveLedgerAdjustment() path instead. This
 *     system does not attempt to compute or approximate a mid-year,
 *     mixed-FTE figure under any circumstance.
 *   - employees.recognised_prior_service_years and
 *     employees.is_first_ever_employment are kept as optional HR reference
 *     fields only (avoiding an unnecessary schema reversal) — neither is
 *     read by, nor has any effect on, Poland's Annual Leave computation.
 *   - Hours-based leave-taking accounting (Art. 1542, "1 day = 8 hours") is
 *     a DEDUCTION-side concern, already handled by
 *     computePolandLeaveDaysFromHours below; it does not affect how
 *     entitlement itself accrues, so it is unaffected by this file.
 */

/** Flat Enginious company benefit: every full-time Poland employee receives
 * this many working days of Annual Leave per complete calendar year,
 * regardless of tenure, prior service, or first-ever-employment status. */
export const POLAND_ANNUAL_LEAVE_BASE_DAYS = 26;

function dateParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addOneDay(iso: string): string {
  const { year, month, day } = dateParts(iso);
  if (day < daysInMonth(year, month)) return formatDate(year, month, day + 1);
  if (month < 12) return formatDate(year, month + 1, 1);
  return formatDate(year + 1, 1, 1);
}

/**
 * Number of full calendar months between two dates — a month only counts
 * once `asOf`'s day-of-month has reached `from`'s (e.g. hired on the 15th,
 * "one completed month" is the 15th of the next month, not the 1st). Used
 * for actual tenure throughout this file, for AE/SA's own accrual rules.
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

// -----------------------------------------------------------------------------
// Poland: effective-dated FTE resolution over an arbitrary date interval
// -----------------------------------------------------------------------------

/** An FTE fraction that took effect on a given date — one entry per
 * employment_contracts row's (start_date, fte_fraction), covering the whole
 * tenure. Each period is open-ended forward until the next entry's
 * effectiveFrom (or the present, for the last one) — this matches
 * employment_contracts' own append-only, no-end-date shape. Order doesn't
 * matter; every resolver here sorts internally. */
export interface FteFractionPeriod {
  effectiveFrom: string;
  fteFraction: number;
}

/** A block reason surfaced when a Poland calculation cannot be completed
 * accurately from the data supplied — the caller (the accrual cron) must
 * treat this as "block automatic accrual for this employee," never fall
 * back to a guessed number. */
export interface PolandEntitlementBlocked {
  ok: false;
  reason: string;
}

interface PolandEntitlementComputed {
  ok: true;
  days: number;
}

type PolandEntitlementResult = PolandEntitlementComputed | PolandEntitlementBlocked;

function validateFteFractionHistory(history: readonly FteFractionPeriod[]): { ok: true; sorted: FteFractionPeriod[] } | PolandEntitlementBlocked {
  for (const period of history) {
    if (!Number.isFinite(period.fteFraction) || period.fteFraction <= 0 || period.fteFraction > 1) {
      return { ok: false, reason: `invalid FTE fraction ${period.fteFraction} effective ${period.effectiveFrom} (must be > 0 and <= 1)` };
    }
  }
  const sorted = [...history].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const previous = sorted[i - 1]!;
    if (current.effectiveFrom === previous.effectiveFrom && current.fteFraction !== previous.fteFraction) {
      return { ok: false, reason: `overlapping/conflicting employment_contracts rows both start ${current.effectiveFrom} with different FTE fractions` };
    }
  }
  return { ok: true, sorted };
}

/**
 * Resolves the SINGLE, constant FTE fraction that covers the whole of
 * [startISO, endISO] (inclusive). Blocks (returns ok:false) rather than
 * guess or split when: no contract covers any part of the interval, the
 * first contract starts after the interval, a gap exists inside the
 * interval, or the FTE fraction actually changes ANYWHERE within the
 * interval. This system does not compute a mixed-FTE period at all; a
 * change mid-period always blocks automatic accrual for that whole period,
 * however small the change or however the days would otherwise split.
 */
function resolveConstantFteForInterval(sortedHistory: readonly FteFractionPeriod[], startISO: string, endISO: string): { ok: true; fte: number } | PolandEntitlementBlocked {
  if (sortedHistory.length === 0) {
    return { ok: false, reason: `no employment_contracts history at all to resolve an FTE fraction for ${startISO}..${endISO}` };
  }
  const firstPeriod = sortedHistory[0]!;
  if (firstPeriod.effectiveFrom > startISO) {
    return { ok: false, reason: `no contract covers ${startISO} — the first known contract starts ${firstPeriod.effectiveFrom}` };
  }

  let cursor = startISO;
  let coveredDays = 0;
  const totalDays = dayCount(startISO, endISO);
  let resultFte: number | null = null;
  let change: { from: number; to: number; effectiveFrom: string } | null = null;

  for (let i = 0; i < sortedHistory.length && cursor <= endISO; i++) {
    const period = sortedHistory[i]!;
    if (period.effectiveFrom > cursor) {
      // A gap: this period starts after `cursor`, but nothing covers
      // [cursor, period.effectiveFrom).
      return { ok: false, reason: `gap in employment_contracts history between ${cursor} and ${period.effectiveFrom}` };
    }
    const nextPeriod = sortedHistory[i + 1];
    const periodEnd = nextPeriod ? addOneDay2Before(nextPeriod.effectiveFrom) : endISO;
    const segmentStart = cursor;
    const segmentEnd = periodEnd < endISO ? periodEnd : endISO;
    if (segmentEnd < segmentStart) continue; // this contract ends before our interval starts covering
    coveredDays += dayCount(segmentStart, segmentEnd);
    if (resultFte === null) {
      resultFte = period.fteFraction;
    } else if (period.fteFraction !== resultFte && !change) {
      change = { from: resultFte, to: period.fteFraction, effectiveFrom: period.effectiveFrom };
    }
    cursor = addOneDay(segmentEnd);
  }

  if (coveredDays < totalDays) {
    return { ok: false, reason: `gap in employment_contracts history covering part of ${startISO}..${endISO}` };
  }
  if (change) {
    return {
      ok: false,
      reason: `FTE changes during ${startISO}..${endISO} (from ${change.from} to ${change.to} effective ${change.effectiveFrom}) — automatic accrual for a period whose FTE isn't constant throughout is not computed; post the confirmed amount manually instead`,
    };
  }
  return { ok: true, fte: resultFte! };
}

function addOneDay2Before(iso: string): string {
  // The day before `iso` — used to close off the preceding contract's
  // open-ended period at the day just before the next one's effectiveFrom.
  const { year, month, day } = dateParts(iso);
  if (day > 1) return formatDate(year, month, day - 1);
  const prevMonth = month > 1 ? month - 1 : 12;
  const prevYear = month > 1 ? year : year - 1;
  return formatDate(prevYear, prevMonth, daysInMonth(prevYear, prevMonth));
}

function dayCount(startISO: string, endISO: string): number {
  const start = Date.UTC(dateParts(startISO).year, dateParts(startISO).month - 1, dateParts(startISO).day);
  const end = Date.UTC(dateParts(endISO).year, dateParts(endISO).month - 1, dateParts(endISO).day);
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// -----------------------------------------------------------------------------
// Poland: a whole period (the hire year, or one subsequent calendar year),
// priced only when a SINGLE FTE fraction covers it throughout
// (established rounding practice, Art. 1551 proration method)
// -----------------------------------------------------------------------------

/** Prices a whole-calendar-months range [trueRangeStartISO, firstOfEndMonth]
 * at `baseDaysForYear` (a partial first month, e.g. the hire month, still
 * counts as one whole month — "niepełny miesiąc... nie jest zaokrąglany w
 * dół") — but ONLY when a single, constant FTE fraction covers the whole
 * range: any FTE change anywhere inside it blocks the whole period rather
 * than being split and priced (see resolveConstantFteForInterval, and this
 * file's header). */
function priceWholePeriod(
  trueRangeStartISO: string,
  firstOfEndMonthISO: string,
  sortedFteHistory: readonly FteFractionPeriod[],
  baseDaysForYear: number,
): PolandEntitlementResult {
  const start = dateParts(trueRangeStartISO);
  const end = dateParts(firstOfEndMonthISO);
  const totalMonths = (end.year - start.year) * 12 + (end.month - start.month) + 1;
  if (totalMonths <= 0) return { ok: true, days: 0 };

  const periodEndISO = formatDate(end.year, end.month, daysInMonth(end.year, end.month));
  const resolved = resolveConstantFteForInterval(sortedFteHistory, trueRangeStartISO, periodEndISO);
  if (!resolved.ok) return resolved;

  return { ok: true, days: Math.ceil((totalMonths / 12) * baseDaysForYear * resolved.fte) };
}

// -----------------------------------------------------------------------------
// Poland: single dispatcher
// -----------------------------------------------------------------------------

export interface AnnualLeaveEntitlementToDateInput {
  countryCode: "AE" | "SA" | "PL";
  hireDate: string;
  asOfDate: string;
  /**
   * Poland only — REQUIRED for a Poland calculation to run at all (a
   * missing or empty history returns `null`, blocked; so does any gap,
   * gap-at-start, overlapping/conflicting row, or out-of-range fraction
   * found in it). See resolveConstantFteForInterval — deliberately, an FTE
   * change ANYWHERE within a period being priced (the hire year, or a
   * subsequent calendar year) blocks that whole period; this calculator
   * never splits or approximates a mixed-FTE period.
   */
  fteFractionHistory?: readonly FteFractionPeriod[];
}

/**
 * Single dispatcher the real accrual cron calls: cumulative Annual Leave
 * entitlement earned to date, in the resolved country's own rule shape.
 * The cron posts the ledger a running total's worth of accrual entries by
 * diffing this against what it already posted — see
 * apps/web/src/app/api/cron/leave-accrual/route.ts.
 *
 * Returns `null` whenever a Poland calculation cannot be completed
 * accurately from the data supplied (see each blocking condition
 * documented above) — the caller must treat that as "block automatic
 * accrual for this employee and surface the configuration requirement,"
 * never substitute a guessed default. AE/SA never return null.
 */
export function computeAnnualLeaveEntitlementToDate(input: AnnualLeaveEntitlementToDateInput): number | null {
  const result = computePolandEntitlementOrDispatch(input);
  return typeof result === "number" ? result : result.ok ? result.days : null;
}

/**
 * Companion to computeAnnualLeaveEntitlementToDate: when that function
 * returns `null` for a Poland employee, this returns the specific,
 * human-readable reason (for surfacing to HR — e.g. in the accrual cron's
 * response payload) instead of a bare null. Returns null itself whenever
 * the main function would NOT be blocked (a non-Poland country, an
 * asOfDate before hireDate, or a Poland calculation that completed
 * successfully) — callers should only display this alongside an actual
 * null result from computeAnnualLeaveEntitlementToDate.
 */
export function explainPolandEntitlementBlock(input: AnnualLeaveEntitlementToDateInput): string | null {
  const result = computePolandEntitlementOrDispatch(input);
  return typeof result === "number" ? null : result.ok ? null : result.reason;
}

function computePolandEntitlementOrDispatch(input: AnnualLeaveEntitlementToDateInput): number | PolandEntitlementResult {
  const { countryCode, hireDate, asOfDate } = input;

  if (asOfDate < hireDate) return 0;
  if (countryCode === "AE") return computeUaeAnnualLeaveEntitlementDays(hireDate, asOfDate);
  if (countryCode === "SA") return computeSaudiAnnualLeaveEntitlementDays(hireDate, asOfDate);

  const { fteFractionHistory } = input;
  if (!fteFractionHistory) {
    return { ok: false, reason: "no employment_contracts history is available to resolve an FTE fraction from" };
  }

  const validated = validateFteFractionHistory(fteFractionHistory);
  if (!validated.ok) return validated;

  return computePolandEntitlementToDate(hireDate, asOfDate, validated.sorted);
}

/**
 * Poland Annual Leave — flat Enginious company benefit of
 * POLAND_ANNUAL_LEAVE_BASE_DAYS per complete calendar year, for every
 * employee regardless of tenure or first-ever-employment status. A new
 * starter receives, immediately from their hire date, a proportional
 * entitlement for the remaining WHOLE calendar months of that hire year (a
 * partial month counts in full — "niepełny miesiąc... nie jest
 * zaokrąglany w dół"), rounded up, then the full annual entitlement from
 * each subsequent 1 January, priced and rounded the same way — but only
 * when a single, constant FTE covers each such period throughout; a change
 * anywhere within it blocks that period (see this file's header).
 */
function computePolandEntitlementToDate(hireDate: string, asOfDate: string, sortedFteHistory: readonly FteFractionPeriod[]): PolandEntitlementResult {
  const hireYear = dateParts(hireDate).year;
  const asOfYear = dateParts(asOfDate).year;

  // Art. 1551: the proportional entitlement for the remainder of the hire
  // year is available IMMEDIATELY at hire, not accrued progressively
  // through it — so the full remaining-of-hire-year range is priced as
  // soon as asOfDate has reached this calendar year at all (asOfYear >=
  // hireYear, already established by the caller), regardless of exactly
  // which day within it asOfDate falls on.
  const firstOfDecemberHireYear = formatDate(hireYear, 12, 1);
  const hireYearPriced = priceWholePeriod(hireDate, firstOfDecemberHireYear, sortedFteHistory, POLAND_ANNUAL_LEAVE_BASE_DAYS);
  if (!hireYearPriced.ok) return hireYearPriced;

  if (asOfYear === hireYear) return { ok: true, days: hireYearPriced.days };

  const subsequent = priceSubsequentCalendarYears(hireYear, asOfYear, sortedFteHistory);
  if (!subsequent.ok) return subsequent;
  return { ok: true, days: hireYearPriced.days + subsequent.days };
}

/**
 * Full calendar years hireYear+1..asOfYear: the FULL annual entitlement
 * (POLAND_ANNUAL_LEAVE_BASE_DAYS) is available from 1 January of each such
 * year, immediately, not accrued progressively through it — so every year
 * in this range (asOfYear included) is priced in full, regardless of which
 * month of asOfYear we're actually being asked about. (This function
 * assumes continued employment through the full calendar year being
 * priced; it is NOT the right tool for a terminating employee's own final,
 * prorated exit-year entitlement — that is a separate
 * proportional-termination calculation this function does not perform.)
 */
function priceSubsequentCalendarYears(hireYear: number, asOfYear: number, sortedFteHistory: readonly FteFractionPeriod[]): PolandEntitlementResult {
  let total = 0;
  for (let year = hireYear + 1; year <= asOfYear; year++) {
    const yearStart = formatDate(year, 1, 1);
    const priced = priceWholePeriod(yearStart, formatDate(year, 12, 1), sortedFteHistory, POLAND_ANNUAL_LEAVE_BASE_DAYS);
    if (!priced.ok) return priced;
    total += priced.days;
  }
  return { ok: true, days: total };
}

// -----------------------------------------------------------------------------
// Poland: entitlement through an employee's actual LEAVING date (termination)
// -----------------------------------------------------------------------------

export interface PolandTerminationEntitlementInput {
  hireDate: string;
  terminationDate: string;
  /** See AnnualLeaveEntitlementToDateInput's own field of the same name — identical contract. */
  fteFractionHistory?: readonly FteFractionPeriod[];
}

/**
 * Single dispatcher for a Poland employee's cumulative Annual Leave
 * entitlement through their actual termination date — used by the
 * termination workflow to true up the leave_ledger balance before Final
 * Settlement reads it (apps/web/src/lib/actions/polandTermination.ts),
 * NEVER by the ongoing-accrual cron (see computeAnnualLeaveEntitlementToDate
 * for that — it deliberately prices the current/asOfYear in FULL because an
 * ongoing employee's full annual entitlement is available from 1 January
 * regardless of the month; a LEAVING employee's final, partial year must
 * instead be prorated through their actual last day, which is exactly what
 * this function does and that one explicitly does not).
 *
 * Returns `null` under the same conditions as computeAnnualLeaveEntitlementToDate
 * (missing/gappy/overlapping/invalid FTE history, or an FTE change within a
 * priced period) — see explainPolandTerminationEntitlementBlock for the
 * reason. The caller must treat `null` as "block automatic final-settlement
 * preparation; require an audited HR adjustment," never substitute a
 * guessed default.
 */
export function computePolandAnnualLeaveEntitlementAtTermination(input: PolandTerminationEntitlementInput): number | null {
  const result = computePolandTerminationEntitlementOrDispatch(input);
  return typeof result === "number" ? result : result.ok ? result.days : null;
}

/** Companion to computePolandAnnualLeaveEntitlementAtTermination — see explainPolandEntitlementBlock's own doc comment for the identical contract. */
export function explainPolandTerminationEntitlementBlock(input: PolandTerminationEntitlementInput): string | null {
  const result = computePolandTerminationEntitlementOrDispatch(input);
  return typeof result === "number" ? null : result.ok ? null : result.reason;
}

function computePolandTerminationEntitlementOrDispatch(input: PolandTerminationEntitlementInput): number | PolandEntitlementResult {
  const { hireDate, terminationDate, fteFractionHistory } = input;

  if (terminationDate < hireDate) return 0;
  if (!fteFractionHistory) {
    return { ok: false, reason: "no employment_contracts history is available to resolve an FTE fraction from" };
  }

  const validated = validateFteFractionHistory(fteFractionHistory);
  if (!validated.ok) return validated;

  return computePolandEntitlementThroughExitDate(hireDate, terminationDate, validated.sorted);
}

/**
 * Kodeks pracy Art. 1551 §1 point 2 / Art. 155 §1's proportional-leave
 * mechanic applies symmetrically at BOTH ends of employment — the same
 * whole-calendar-month, round-up-a-partial-month convention this file
 * already uses for a new starter's hire year applies to a leaver's final
 * (exit) year too: the months from 1 January (or the hire date, if hire and
 * termination fall in the same calendar year) through the termination date
 * are priced, with a partial final month still counting as a whole month.
 * Every full calendar year strictly between the hire year and the exit year
 * is priced in full, exactly as computePolandEntitlementToDate does for an
 * ongoing employee — only the LAST year differs, prorated through the exit
 * month instead of priced in full.
 */
function computePolandEntitlementThroughExitDate(hireDate: string, exitDate: string, sortedFteHistory: readonly FteFractionPeriod[]): PolandEntitlementResult {
  const hireYear = dateParts(hireDate).year;
  const exitYear = dateParts(exitDate).year;
  const exitDateParts = dateParts(exitDate);
  const firstOfExitMonth = formatDate(exitDateParts.year, exitDateParts.month, 1);

  if (exitYear === hireYear) {
    return priceWholePeriod(hireDate, firstOfExitMonth, sortedFteHistory, POLAND_ANNUAL_LEAVE_BASE_DAYS);
  }

  const hireYearPriced = priceWholePeriod(hireDate, formatDate(hireYear, 12, 1), sortedFteHistory, POLAND_ANNUAL_LEAVE_BASE_DAYS);
  if (!hireYearPriced.ok) return hireYearPriced;

  let total = hireYearPriced.days;
  for (let year = hireYear + 1; year < exitYear; year++) {
    const priced = priceWholePeriod(formatDate(year, 1, 1), formatDate(year, 12, 1), sortedFteHistory, POLAND_ANNUAL_LEAVE_BASE_DAYS);
    if (!priced.ok) return priced;
    total += priced.days;
  }

  const exitYearPriced = priceWholePeriod(formatDate(exitYear, 1, 1), firstOfExitMonth, sortedFteHistory, POLAND_ANNUAL_LEAVE_BASE_DAYS);
  if (!exitYearPriced.ok) return exitYearPriced;
  total += exitYearPriced.days;

  return { ok: true, days: total };
}

export interface PolandAnnualLeaveInput {
  /** 1.0 for full-time; a fraction (e.g. 0.5) for part-time, prorating the result. Defaults to 1.0. */
  fteFraction?: number;
}

/**
 * Poland Annual Leave: POLAND_ANNUAL_LEAVE_BASE_DAYS (26) working days/year,
 * flat, as an Enginious company benefit — regardless of tenure or
 * first-ever-employment status. Prorated for part-time by `fteFraction`,
 * rounded UP to a whole day (established rounding practice — a part-time
 * entitlement is never rounded to the nearest day, only ever up). Use with
 * computeLeaveDays({ deductionMode: "workingDays" }) (the existing default)
 * for deducting an actual request.
 */
export function computePolandAnnualLeaveEntitlementDays(input: PolandAnnualLeaveInput = {}): number {
  const { fteFraction = 1 } = input;
  return Math.ceil(POLAND_ANNUAL_LEAVE_BASE_DAYS * clampFraction(fteFraction));
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
