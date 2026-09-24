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
 * POLAND (Kodeks pracy) — sources cited inline throughout this file:
 *   - Art. 153 §1: an employee's first-ever job (in their life) accrues
 *     leave progressively, 1/12 per completed month, but ONLY within the
 *     calendar year they took up work.
 *   - "Prawo do kolejnych urlopów pracownik nabywa w każdym następnym roku
 *     kalendarzowym" (general rule, applying from Art. 153 §1's own second
 *     sentence onward): from 1 January of the FOLLOWING calendar year, the
 *     employee is on ordinary "kolejny urlop" (subsequent leave) rules —
 *     the full annual entitlement becomes available at the start of that
 *     year, regardless of whether their personal 12-month anniversary has
 *     occurred yet.
 *   - Art. 1551 + Art. 1553 §1: an employee who has worked before (at any
 *     point, anywhere — Art. 1551 is not about "first year at Enginious")
 *     gets a proportional entitlement for the remainder of their hire's
 *     calendar year, immediately, not accrued progressively; each
 *     incomplete calendar month of that period is rounded UP to a full
 *     month, and the resulting fractional day count is rounded UP to a
 *     full day (mandatory — Art. 1553 §1 names this explicitly for Art.
 *     1551/1552 calculations).
 *   - Art. 154 §2 + established rounding practice: a part-time employee's
 *     FTE-prorated entitlement is always rounded UP to a full day, never
 *     to the nearest day.
 *   - GIP (Główny Inspektorat Pracy) guidance: Art. 153's own progressive
 *     1/12 monthly figure has NO statutory whole-day rounding requirement
 *     (unlike Art. 1551/1552/154) — rounding up there is a permitted,
 *     more-generous EMPLOYER CHOICE this system does not currently
 *     implement, so this calculator reports the precise (2-decimal-place
 *     storage precision) fractional value for that specific figure only.
 *   - This system does NOT implement Art. 154's "urlop uzupełniający"
 *     (supplementary leave granted immediately upon crossing the 10-year
 *     threshold mid-calendar-year) — a period whose recognised-service
 *     threshold would cross mid-period is detected and BLOCKS automatic
 *     accrual for that employee rather than approximate it.
 *   - Hours-based leave-taking accounting (Art. 1542, "1 day = 8 hours") is
 *     a DEDUCTION-side concern, already handled by
 *     computePolandLeaveDaysFromHours below; it does not affect how
 *     entitlement itself accrues, so it is unaffected by this file.
 *
 * DELIBERATELY KEPT MINIMAL (per this branch's second correction round):
 * this calculator only ever computes automatically when a period (the hire
 * year, or a subsequent full calendar year) is covered by a SINGLE,
 * constant FTE fraction throughout and does not cross the 10-year
 * recognised-service threshold. A period where FTE changes at all —
 * whatever the split would otherwise work out to — BLOCKS automatic
 * accrual entirely, the same as a threshold crossing, a data gap, or an
 * unconfirmed fact: HR must post the confirmed statutory amount through
 * the existing audited postLeaveLedgerAdjustment() path instead. This
 * system does not attempt to compute or approximate a mid-year, mixed-FTE,
 * or mixed-rate figure under any circumstance.
 */

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
 * for actual tenure (staż pracy) throughout this file, and unchanged for
 * AE/SA — NOT used directly for Poland's Art. 153 first-year month count,
 * which has its own, separately-sourced day-counting convention below.
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
 * interval, or — deliberately, per this branch's second correction round —
 * the FTE fraction actually changes ANYWHERE within the interval. This
 * system does not compute a mixed-FTE period at all; a change mid-period
 * always blocks automatic accrual for that whole period, however small the
 * change or however the days would otherwise split.
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
// (Art. 154 §2 / Art. 1551 / established rounding practice)
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

/** True if the 20-vs-26-day recognised-service threshold (Art. 154 §1-2)
 * would cross somewhere strictly inside [startISO, endISO] — this system
 * does not implement Art. 154's mid-calendar-year "urlop uzupełniający"
 * (supplementary leave granted immediately on crossing), so such a period
 * is blocked rather than priced at either the pre- or post-threshold rate,
 * either of which would misstate the employee's actual entitlement. */
function baseDaysFor(recognisedServiceYears: number): 20 | 26 {
  return recognisedServiceYears >= 10 ? 26 : 20;
}

function thresholdCrossesWithin(hireDate: string, recognisedPriorServiceYears: number, startISO: string, endISO: string): boolean {
  const atStart = baseDaysFor(completedYearsBetween(hireDate, startISO) + recognisedPriorServiceYears);
  const atEnd = baseDaysFor(completedYearsBetween(hireDate, endISO) + recognisedPriorServiceYears);
  return atStart !== atEnd;
}

// -----------------------------------------------------------------------------
// Poland: Art. 153 §1 first-ever-employment month count (hire calendar year only)
// -----------------------------------------------------------------------------

/**
 * Completed months of work for Art. 153 §1's progressive 1/12 accrual, per
 * GIP/PIP worked-example guidance: a period starting on day D of a month
 * completes its "first month" the day BEFORE day D of the following month
 * (e.g. hired 15 October -> first month completes 14 November; hired
 * 1 October -> first month completes 31 October) — i.e. the hire day
 * itself counts as day 1 of employment, one day earlier than a plain
 * "same day next month" anniversary would give. Implemented as
 * completedMonthsBetween measured one day further forward than the actual
 * asOfDate, which reproduces exactly this day-before-the-anniversary
 * boundary. This is DELIBERATELY NOT the same function used for actual
 * tenure/staż pracy elsewhere in this file (completedMonthsBetween) — see
 * this file's own header for why that distinction is a documented, scoped
 * decision for this specific Art. 153 calculation only.
 */
function completedArt153Months(hireDate: string, asOfDate: string): number {
  return completedMonthsBetween(hireDate, addOneDay(asOfDate));
}

// -----------------------------------------------------------------------------
// Poland: single dispatcher
// -----------------------------------------------------------------------------

export interface AnnualLeaveEntitlementToDateInput {
  countryCode: "AE" | "SA" | "PL";
  hireDate: string;
  asOfDate: string;
  /**
   * Poland only. HR REFERENCE DATA ONLY — deliberately never applied to
   * automatic accrual (see this file's header). This system keeps this
   * field as a single, non-effective-dated scalar (employees.
   * recognised_prior_service_years); using it to compute automatically
   * would mean applying whichever value happens to be current across an
   * employee's entire multi-year history, silently restating years
   * already granted whenever it changes and possibly missing a 10-year
   * threshold crossing it would have caused earlier. ANY non-zero value
   * here therefore BLOCKS the Poland calculation entirely (returns null):
   * HR must confirm and post the correct statutory entitlement manually,
   * through the existing leave-ledger adjustment process, for any Poland
   * employee with recognised prior service. recognisedPriorServiceYears
   * === 0 (or omitted) is unaffected — there is only one possible value
   * for all of history — and computes normally.
   */
  recognisedPriorServiceYears?: number;
  /**
   * Poland only — REQUIRED for a Poland calculation to run at all.
   * An explicit HR-confirmed fact (employees.is_first_ever_employment):
   *   true  = this is the employee's first job of their working life, ever
   *           — Kodeks pracy Art. 153 §1's progressive monthly-proration
   *           applies, but ONLY within the calendar year they were hired.
   *   false = they have worked before — anywhere, at any employer, at any
   *           point in their life — even if this is their first year AT
   *           ENGINIOUS specifically. Art. 1551's calendar-year
   *           proportional entitlement applies instead.
   * NEVER inferred from hireDate, and NEVER inferred from
   * recognisedPriorServiceYears being zero/unset. undefined/null means HR
   * has not yet confirmed this: the calculation returns `null` (blocked).
   */
  isFirstEverEmployment?: boolean | null;
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
  const { countryCode, hireDate, asOfDate, recognisedPriorServiceYears = 0 } = input;

  if (asOfDate < hireDate) return 0;
  if (countryCode === "AE") return computeUaeAnnualLeaveEntitlementDays(hireDate, asOfDate);
  if (countryCode === "SA") return computeSaudiAnnualLeaveEntitlementDays(hireDate, asOfDate);

  const { isFirstEverEmployment, fteFractionHistory } = input;
  if (isFirstEverEmployment === undefined || isFirstEverEmployment === null) {
    return { ok: false, reason: "employees.is_first_ever_employment has not been confirmed by HR yet" };
  }
  if (!fteFractionHistory) {
    return { ok: false, reason: "no employment_contracts history is available to resolve an FTE fraction from" };
  }
  if (recognisedPriorServiceYears !== 0) {
    return {
      ok: false,
      reason:
        "recognisedPriorServiceYears is non-zero — this field is retained as HR reference data only and is never applied to automatic accrual, since a single current value has no effective date and could change (or already have changed) the 10-year threshold for years already granted. HR must confirm and post the statutory Annual Leave entitlement for this employee manually via the existing leave-ledger adjustment process.",
    };
  }

  const validated = validateFteFractionHistory(fteFractionHistory);
  if (!validated.ok) return validated;

  return isFirstEverEmployment
    ? computePolandFirstEverEmploymentEntitlementToDate(hireDate, asOfDate, recognisedPriorServiceYears, validated.sorted)
    : computePolandExperiencedHireEntitlementToDate(hireDate, asOfDate, recognisedPriorServiceYears, validated.sorted);
}

/**
 * Kodeks pracy Art. 153 §1: within the calendar year the employee is hired
 * in, 1/12 of the annual entitlement per completed month (per
 * completedArt153Months' own day-counting convention above), NOT rounded
 * up to a whole day (GIP: optional, not mandatory, for this specific
 * figure). From 1 January of the FOLLOWING calendar year onward, ordinary
 * "kolejny urlop" rules apply — the full annual entitlement is available
 * from the start of each calendar year, computed and rounded exactly like
 * the experienced-hire case below (this system's Art. 153 accrual NEVER
 * continues past the hire's own calendar year, regardless of whether the
 * employee's personal 12-month anniversary has occurred yet).
 */
function computePolandFirstEverEmploymentEntitlementToDate(
  hireDate: string,
  asOfDate: string,
  recognisedPriorServiceYears: number,
  sortedFteHistory: readonly FteFractionPeriod[],
): PolandEntitlementResult {
  const hireYear = dateParts(hireDate).year;
  const asOfYear = dateParts(asOfDate).year;
  const hireYearEnd = formatDate(hireYear, 12, 31);

  // Art. 153 §1's base rate is fixed at hire (0 completed service years)
  // for the whole of this special first-year mechanism — a threshold
  // crossing occurring later only ever matters from year 2 onward, checked
  // in the shared subsequent-years loop below.

  if (asOfYear === hireYear) {
    const months = completedArt153Months(hireDate, asOfDate);
    // A single, constant FTE must cover the whole hire-to-date span — any
    // change within the hire year at all blocks this period entirely (see
    // this file's header and resolveConstantFteForInterval).
    const fteResolved = resolveConstantFteForInterval(sortedFteHistory, hireDate, asOfDate);
    if (!fteResolved.ok) return fteResolved;
    const annualAtHire = computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 0, recognisedPriorServiceYears, fteFraction: fteResolved.fte });
    return { ok: true, days: computePolandFirstYearAccruedDays(annualAtHire, months) };
  }

  // Past the hire's own calendar year: the Art. 153 phase is over. Its
  // FINAL, fixed contribution is whatever had accrued by 31 December of
  // the hire year (never re-derived from the personal anniversary) — again
  // requiring a single, constant FTE for that whole hire-year span.
  const monthsInHireYear = completedArt153Months(hireDate, hireYearEnd);
  const fteResolved = resolveConstantFteForInterval(sortedFteHistory, hireDate, hireYearEnd);
  if (!fteResolved.ok) return fteResolved;
  const annualAtHire = computePolandAnnualLeaveEntitlementDays({ completedServiceYears: 0, recognisedPriorServiceYears, fteFraction: fteResolved.fte });
  const hireYearFinal = computePolandFirstYearAccruedDays(annualAtHire, monthsInHireYear);

  const subsequent = priceSubsequentCalendarYears(hireDate, hireYear, asOfYear, recognisedPriorServiceYears, sortedFteHistory);
  if (!subsequent.ok) return subsequent;
  return { ok: true, days: round2(hireYearFinal) + subsequent.days };
}

/**
 * Kodeks pracy Art. 1551 + Art. 1553 §1: an employee who has worked before
 * (at any point, ever) is not subject to Art. 153's progressive first-year
 * proration. They receive, immediately from their hire date, a
 * proportional entitlement for the remaining WHOLE calendar months of that
 * hire year (a partial month counts in full — "niepełny miesiąc... nie
 * jest zaokrąglany w dół"), rounded up, then the full annual entitlement
 * from each subsequent 1 January, priced and rounded the same way — but
 * only when a single, constant FTE covers each such period throughout; a
 * change anywhere within it blocks that period (see this file's header).
 */
function computePolandExperiencedHireEntitlementToDate(
  hireDate: string,
  asOfDate: string,
  recognisedPriorServiceYears: number,
  sortedFteHistory: readonly FteFractionPeriod[],
): PolandEntitlementResult {
  const hireYear = dateParts(hireDate).year;
  const asOfYear = dateParts(asOfDate).year;
  const hireYearEnd = formatDate(hireYear, 12, 31);
  const asOfOrYearEnd = asOfYear === hireYear ? asOfDate : hireYearEnd;

  if (thresholdCrossesWithin(hireDate, recognisedPriorServiceYears, hireDate, asOfOrYearEnd)) {
    return { ok: false, reason: `the 10-year recognised-service threshold crosses during the hire calendar year (${hireYear}) — Art. 154's mid-year "urlop uzupełniający" is not implemented` };
  }
  const baseDaysHireYear = baseDaysFor(completedYearsBetween(hireDate, hireDate) + recognisedPriorServiceYears);

  // Art. 1551: the proportional entitlement for the remainder of the hire
  // year is available IMMEDIATELY at hire, not accrued progressively
  // through it — so the full remaining-of-hire-year range is priced as
  // soon as asOfDate has reached this calendar year at all (asOfYear >=
  // hireYear, already established by the caller), regardless of exactly
  // which day within it asOfDate falls on.
  const firstOfDecemberHireYear = formatDate(hireYear, 12, 1);
  const hireYearPriced = priceWholePeriod(hireDate, firstOfDecemberHireYear, sortedFteHistory, baseDaysHireYear);
  if (!hireYearPriced.ok) return hireYearPriced;

  if (asOfYear === hireYear) return { ok: true, days: hireYearPriced.days };

  const subsequent = priceSubsequentCalendarYears(hireDate, hireYear, asOfYear, recognisedPriorServiceYears, sortedFteHistory);
  if (!subsequent.ok) return subsequent;
  return { ok: true, days: hireYearPriced.days + subsequent.days };
}

/**
 * Full calendar years hireYear+1..asOfYear — shared by both the first-ever
 * and experienced paths, since from the year after hire onward their rules
 * are identical: the FULL annual entitlement is available from 1 January
 * of each such year, immediately, not accrued progressively through it —
 * so every year in this range (asOfYear included) is priced in full,
 * regardless of which month of asOfYear we're actually being asked about.
 * (This function assumes continued employment through the full calendar
 * year being priced; it is NOT the right tool for a terminating employee's
 * own final, prorated exit-year entitlement — that is a separate
 * proportional-termination calculation this function does not perform.)
 */
function priceSubsequentCalendarYears(
  hireDate: string,
  hireYear: number,
  asOfYear: number,
  recognisedPriorServiceYears: number,
  sortedFteHistory: readonly FteFractionPeriod[],
): PolandEntitlementResult {
  let total = 0;
  for (let year = hireYear + 1; year <= asOfYear; year++) {
    const yearStart = formatDate(year, 1, 1);
    const yearEnd = formatDate(year, 12, 31);
    if (thresholdCrossesWithin(hireDate, recognisedPriorServiceYears, yearStart, yearEnd)) {
      return { ok: false, reason: `the 10-year recognised-service threshold crosses during calendar year ${year} — Art. 154's mid-year "urlop uzupełniający" is not implemented` };
    }
    const baseDaysThisYear = baseDaysFor(completedYearsBetween(hireDate, yearStart) + recognisedPriorServiceYears);
    const priced = priceWholePeriod(yearStart, formatDate(year, 12, 1), sortedFteHistory, baseDaysThisYear);
    if (!priced.ok) return priced;
    total += priced.days;
  }
  return { ok: true, days: total };
}

export interface PolandAnnualLeaveInput {
  /** Actual tenure with Enginious, in completed years, as of the date being evaluated. */
  completedServiceYears: number;
  /**
   * HR-controlled input: prior service/education years the company has
   * recognised toward the statutory threshold (Kodeks pracy Art. 154 —
   * education can count toward the service-length calculation). Never
   * computed automatically. Defaults to 0 (no recognised prior service) if
   * not supplied.
   */
  recognisedPriorServiceYears?: number;
  /** 1.0 for full-time; a fraction (e.g. 0.5) for part-time, prorating the result. Defaults to 1.0. */
  fteFraction?: number;
}

/**
 * Poland Annual Leave: 20 working days/year under 10 years of legally
 * recognised service (actual tenure + any HR-recognised prior service),
 * 26 working days/year at 10+ years. Prorated for part-time by
 * `fteFraction`, rounded UP to a whole day (Art. 154 §2 + established
 * rounding practice — a part-time entitlement is never rounded to the
 * nearest day, only ever up). Use with computeLeaveDays({ deductionMode:
 * "workingDays" }) (the existing default) for deducting an actual request.
 */
export function computePolandAnnualLeaveEntitlementDays(input: PolandAnnualLeaveInput): number {
  const { completedServiceYears, recognisedPriorServiceYears = 0, fteFraction = 1 } = input;
  const recognisedServiceYears = completedServiceYears + Math.max(0, recognisedPriorServiceYears);
  const baseDays = baseDaysFor(recognisedServiceYears);
  return Math.ceil(baseDays * clampFraction(fteFraction));
}

/**
 * Poland first-time employee accrual: 1/12 of the annual entitlement after
 * each completed month of the first calendar year (Kodeks pracy Art. 153
 * §1), capped at the full annual amount once 12 months have passed. NOT
 * rounded up to a whole day — see this file's header (GIP: optional here,
 * unlike every other Poland rounding in this file).
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
