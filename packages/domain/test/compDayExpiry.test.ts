import { describe, expect, it } from "vitest";
import { computeCompDayExpiry, type CompDayLedgerEntryLike } from "../src/compDayExpiry";

describe("computeCompDayExpiry", () => {
  it("expires an untouched earned entry once its expiry date has passed", () => {
    const entries: CompDayLedgerEntryLike[] = [
      { id: "e1", entryType: "earned", days: 2, txnDate: "2026-01-01", expiryDate: "2026-03-01" },
    ];
    expect(computeCompDayExpiry(entries, "2026-04-01")).toEqual([{ earnedEntryId: "e1", expiredDays: 2 }]);
  });

  it("does not expire an entry before its expiry date arrives", () => {
    const entries: CompDayLedgerEntryLike[] = [
      { id: "e1", entryType: "earned", days: 2, txnDate: "2026-01-01", expiryDate: "2026-03-01" },
    ];
    expect(computeCompDayExpiry(entries, "2026-02-01")).toEqual([]);
  });

  it("fully consumes an earned entry via redemption before expiry — nothing left to expire", () => {
    const entries: CompDayLedgerEntryLike[] = [
      { id: "e1", entryType: "earned", days: 2, txnDate: "2026-01-01", expiryDate: "2026-03-01" },
      { id: "r1", entryType: "redeemed", days: -2, txnDate: "2026-02-01", expiryDate: null },
    ];
    expect(computeCompDayExpiry(entries, "2026-04-01")).toEqual([]);
  });

  it("consumes the earliest-expiring entry first (FIFO), expiring only what's left unconsumed", () => {
    const entries: CompDayLedgerEntryLike[] = [
      { id: "e1", entryType: "earned", days: 2, txnDate: "2026-01-01", expiryDate: "2026-02-01" }, // expires first
      { id: "e2", entryType: "earned", days: 2, txnDate: "2026-01-15", expiryDate: "2026-05-01" }, // expires later
      { id: "r1", entryType: "redeemed", days: -1, txnDate: "2026-01-20", expiryDate: null },
    ];
    // The 1-day redemption should draw from e1 (FIFO by expiry date) first,
    // leaving e1 with 1 unconsumed day that expires on 2026-02-01, and e2
    // fully intact (not yet expired as of the asOf date used below).
    expect(computeCompDayExpiry(entries, "2026-03-01")).toEqual([{ earnedEntryId: "e1", expiredDays: 1 }]);
  });

  it("never double-expires the same shortfall across two separately-expiring entries", () => {
    const entries: CompDayLedgerEntryLike[] = [
      { id: "e1", entryType: "earned", days: 2, txnDate: "2026-01-01", expiryDate: "2026-02-01" },
      { id: "e2", entryType: "earned", days: 2, txnDate: "2026-01-15", expiryDate: "2026-02-15" },
      { id: "r1", entryType: "redeemed", days: -3, txnDate: "2026-01-20", expiryDate: null },
    ];
    // 3 days redeemed consumes all of e1 (2) plus 1 of e2's 2, leaving e2
    // with exactly 1 unconsumed day.
    expect(computeCompDayExpiry(entries, "2026-03-01")).toEqual([{ earnedEntryId: "e2", expiredDays: 1 }]);
  });

  it("returns nothing for an employee with no earned entries", () => {
    expect(computeCompDayExpiry([], "2026-01-01")).toEqual([]);
  });
});
