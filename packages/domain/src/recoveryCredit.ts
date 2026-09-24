/**
 * Recovery Leave credit rules (phase2b/leave-policy-configuration) — pure
 * functions only. The server never trusts a browser-supplied "this was
 * recovery-eligible" flag; these functions derive eligibility and the
 * credit amount from schedule/holiday facts and HR/manager-attested
 * working-time figures, mirroring the same "derive it server-side, don't
 * invent unreliable client input" principle as
 * record_attendance_and_recovery()'s existing recovery-day logic.
 *
 * Recovery Leave is entirely separate from Annual Leave: no function here
 * touches leave_ledger or annual-leave settlement math.
 */

export type RecoveryCreditReason = "rest_day_worked" | "public_holiday_worked" | "overnight_extension" | "none";

export interface RecoveryCreditResult {
  days: 0 | 0.5 | 1;
  reason: RecoveryCreditReason;
}

/**
 * Standard eligibility: the employee's scheduled weekly rest day, or an
 * applicable official public holiday. Routine late work on an ordinary
 * working day is never eligible on its own (see
 * computeOvernightRecoveryCredit for the separate overnight-extension
 * case). Thresholds: up to and including 4 active hours -> 0.5 day; more
 * than 4 -> 1 day (capped at 1 day per calendar date).
 */
export function computeStandardRecoveryCredit(params: {
  isScheduledRestDay: boolean;
  isPublicHoliday: boolean;
  activeHoursWorked: number;
}): RecoveryCreditResult {
  const { isScheduledRestDay, isPublicHoliday, activeHoursWorked } = params;
  if (!isScheduledRestDay && !isPublicHoliday) return { days: 0, reason: "none" };
  if (activeHoursWorked <= 0) return { days: 0, reason: "none" };

  const reason: RecoveryCreditReason = isPublicHoliday ? "public_holiday_worked" : "rest_day_worked";
  return { days: activeHoursWorked > 4 ? 1 : 0.5, reason };
}

/**
 * Exceptional overnight extension: the employee completed their normal
 * scheduled working day, then continued active work past midnight at the
 * company's request or with manager confirmation. Only active working
 * time between 00:00 and 06:00 counts toward the threshold — breaks,
 * sleeping time, passive hotel stays and ordinary travel are excluded by
 * the caller before `activeHoursAfterMidnight` reaches this function (it
 * has no way to distinguish active time from passive time on its own).
 * Working to exactly midnight and no further earns nothing.
 */
export function computeOvernightRecoveryCredit(params: {
  completedNormalScheduledDay: boolean;
  workContinuedPastMidnight: boolean;
  /** Active working time between 00:00 and 06:00, in hours — never raw clock-out minus clock-in. */
  activeHoursAfterMidnight: number;
}): RecoveryCreditResult {
  const { completedNormalScheduledDay, workContinuedPastMidnight, activeHoursAfterMidnight } = params;
  if (!completedNormalScheduledDay || !workContinuedPastMidnight) return { days: 0, reason: "none" };
  if (activeHoursAfterMidnight <= 0) return { days: 0, reason: "none" };

  return { days: activeHoursAfterMidnight > 4 ? 1 : 0.5, reason: "overnight_extension" };
}

export interface RecoveryLedgerEntryLike {
  id: string;
  entryType: "earned" | "redeemed" | "expired" | "adjustment" | "reversal";
  days: number; // signed, same convention as comp_day_ledger: earned positive, redeemed/expired/reversal negative
  txnDate: string;
  expiryDate: string | null;
}

/**
 * Selects which earned entries a requested number of days should be drawn
 * from, oldest-first by expiry date (then by when earned) — the same FIFO
 * convention computeCompDayExpiry already uses for expiry, applied here to
 * ordinary consumption so the two can never disagree about "oldest".
 * Returns null if the (already-reversal-adjusted) available balance can't
 * cover the request — recovery balances must never go negative.
 */
export function selectOldestFirstConsumption(
  entries: readonly RecoveryLedgerEntryLike[],
  requestedDays: number,
): { earnedEntryId: string; days: number }[] | null {
  const earnedEntries = entries
    .filter((e) => e.entryType === "earned")
    .slice()
    .sort((a, b) => {
      const expiryA = a.expiryDate ?? "9999-12-31";
      const expiryB = b.expiryDate ?? "9999-12-31";
      if (expiryA !== expiryB) return expiryA < expiryB ? -1 : 1;
      return a.txnDate < b.txnDate ? -1 : a.txnDate > b.txnDate ? 1 : 0;
    });

  // Every non-'earned' entry (redeemed/expired/reversal/adjustment) already
  // reduces some earned entry's remaining balance — same pooled-consumption
  // model as computeCompDayExpiry, so "how much of each earned entry is
  // already spoken for" is consistent between the two.
  let consumptionPool = entries.filter((e) => e.entryType !== "earned").reduce((sum, e) => sum + Math.max(0, -e.days), 0);

  const remainingByEntry: { id: string; remaining: number }[] = [];
  for (const entry of earnedEntries) {
    let remaining = entry.days;
    if (consumptionPool > 0) {
      const consumed = Math.min(consumptionPool, remaining);
      remaining -= consumed;
      consumptionPool -= consumed;
    }
    if (remaining > 0) remainingByEntry.push({ id: entry.id, remaining });
  }

  const totalAvailable = remainingByEntry.reduce((sum, e) => sum + e.remaining, 0);
  if (requestedDays <= 0 || requestedDays > totalAvailable) return null;

  const plan: { earnedEntryId: string; days: number }[] = [];
  let toDraw = requestedDays;
  for (const entry of remainingByEntry) {
    if (toDraw <= 0) break;
    const draw = Math.min(entry.remaining, toDraw);
    if (draw > 0) {
      plan.push({ earnedEntryId: entry.id, days: draw });
      toDraw -= draw;
    }
  }
  return plan;
}
