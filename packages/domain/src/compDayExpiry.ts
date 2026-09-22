/**
 * Pure simulation of the comp-day expiry sweep (docs/05-automation-rules.md
 * §5.1) — given an employee's full comp_day_ledger history, works out which
 * "earned" amounts have not yet been consumed by the time they expire.
 *
 * FIFO order is by expiry_date first (soonest-expiring earned entries are
 * consumed first), then by when they were earned. Redemptions/negative
 * adjustments are treated as one pool of consumption applied against that
 * FIFO order — the ledger doesn't track which specific earned entry a
 * redemption came from (docs/02-database-schema.md §2.5 explains why: a
 * running SUM is all balance math needs, and FIFO only matters for expiry,
 * which is exactly this function).
 */
export interface CompDayLedgerEntryLike {
  id: string;
  entryType: "earned" | "redeemed" | "expired" | "adjustment" | "reversal";
  days: number; // signed: earned positive, redeemed/expired negative
  txnDate: string;
  expiryDate: string | null;
}

export interface CompDayExpiryPosting {
  earnedEntryId: string;
  expiredDays: number;
}

export function computeCompDayExpiry(entries: readonly CompDayLedgerEntryLike[], asOf: string): CompDayExpiryPosting[] {
  const earnedEntries = entries
    .filter((e) => e.entryType === "earned")
    .slice()
    .sort((a, b) => {
      const expiryA = a.expiryDate ?? "9999-12-31";
      const expiryB = b.expiryDate ?? "9999-12-31";
      if (expiryA !== expiryB) return expiryA < expiryB ? -1 : 1;
      return a.txnDate < b.txnDate ? -1 : a.txnDate > b.txnDate ? 1 : 0;
    });

  let consumptionPool = entries
    .filter((e) => e.entryType !== "earned")
    .reduce((sum, e) => sum + Math.max(0, -e.days), 0);

  const postings: CompDayExpiryPosting[] = [];

  for (const entry of earnedEntries) {
    let remaining = entry.days;
    if (consumptionPool > 0) {
      const consumed = Math.min(consumptionPool, remaining);
      remaining -= consumed;
      consumptionPool -= consumed;
    }
    if (remaining > 0 && entry.expiryDate !== null && entry.expiryDate <= asOf) {
      postings.push({ earnedEntryId: entry.id, expiredDays: remaining });
    }
  }

  return postings;
}
