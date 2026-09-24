// Shared with apps/web/src/lib/actions/polandTermination.ts: the leave-accrual
// cron (route.ts) needs this to compute an employee's lifetime "already
// granted" Annual Leave baseline across ALL leave types it accrues; the
// Poland termination true-up needs the exact same classification for a
// single employee/leave-type key. Extracted here rather than duplicated so
// both stay byte-for-byte consistent with each other.

// The only leave_ledger entry_types that may ever unambiguously count toward
// an employee's lifetime Annual Leave "already granted" baseline. 'accrual'
// and 'carryover' are exclusively written by automated, self-describing
// mechanisms (the accrual cron; a future carryover-expiry cron), so their
// presence alone is proof of a grant. 'adjustment' is NOT in this set — it's
// also used for arbitrary, unclassified manual corrections
// (postLeaveLedgerAdjustment), so an 'adjustment' row only counts when its
// reference_type says specifically 'opening_balance' (see
// isUnambiguousGrantRow below). 'deduction' and 'encashment' are
// consumption, never a grant. 'reversal' is resolved by looking up what it
// reverses (see classifyLedgerRows).
const UNCONDITIONAL_GRANT_ENTRY_TYPES = new Set(["accrual", "carryover"]);

export interface AnnualLeaveLedgerRow {
  id: string;
  employee_id: string;
  leave_type_code: string;
  entry_type: string;
  amount_days: number;
  reference_type: string | null;
  reversal_of_id: string | null;
}

export interface AmbiguousBaseline {
  employeeId: string;
  leaveTypeCode: string;
  reason: string;
}

function isUnambiguousGrantRow(row: AnnualLeaveLedgerRow): boolean {
  if (UNCONDITIONAL_GRANT_ENTRY_TYPES.has(row.entry_type)) return true;
  return row.entry_type === "adjustment" && row.reference_type === "opening_balance";
}

function isAmbiguousGrantCandidateRow(row: AnnualLeaveLedgerRow): boolean {
  // Any 'adjustment' NOT tagged 'opening_balance' could be a genuine opening
  // grant recorded before that tag existed, or could be a wholly unrelated
  // correction (a mistake fix, a policy-transition true-up, anything) —
  // there is no way to tell which from the stored schema, so it can never
  // safely be counted as a grant, but its mere existence also means the
  // employee's true lifetime baseline can't be trusted either way.
  return row.entry_type === "adjustment" && row.reference_type !== "opening_balance";
}

/**
 * Inventories every historical Annual Leave ledger row for the given
 * employee/leave-type keys and classifies each one as: an unambiguous grant
 * (counts toward the "already granted" baseline), an ambiguous candidate
 * (the whole key is flagged and excluded from automatic accrual), or
 * irrelevant (deduction/encashment — consumption, never a grant).
 *
 * 'reversal' rows are resolved by looking up the entry_type of the row they
 * reverse (via reversal_of_id): reversing a grant nets out of that grant's
 * total (e.g. an accrual posted then corrected); reversing a deduction is a
 * consumption-side correction (e.g. cancel_leave_request restoring a used
 * day) and must NOT inflate the grant baseline; reversing an ambiguous
 * adjustment, or a reversal whose target can't be found, flags the key
 * ambiguous rather than guessing.
 *
 * Never infers a baseline from the net balance (leave_balances) — deductions
 * and reversals make that unreliable per Phase 2b's correction brief.
 */
export function classifyLedgerRows(rows: AnnualLeaveLedgerRow[]): {
  grantTotalByKey: Map<string, number>;
  ambiguousKeys: Set<string>;
} {
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const grantTotalByKey = new Map<string, number>();
  const ambiguousKeys = new Set<string>();

  const addGrant = (key: string, amount: number) => grantTotalByKey.set(key, (grantTotalByKey.get(key) ?? 0) + amount);

  for (const row of rows) {
    const key = `${row.employee_id}:${row.leave_type_code}`;

    if (row.entry_type === "reversal") {
      const original = row.reversal_of_id ? rowsById.get(row.reversal_of_id) : undefined;
      if (!original) {
        // An orphan reversal (target not found in this fetch) can't be
        // classified safely — treat the key as ambiguous rather than assume
        // either direction.
        ambiguousKeys.add(key);
      } else if (isUnambiguousGrantRow(original)) {
        addGrant(key, Number(row.amount_days));
      } else if (isAmbiguousGrantCandidateRow(original)) {
        ambiguousKeys.add(key);
      }
      // else: reverses a deduction/encashment — consumption-side, correctly excluded.
      continue;
    }

    if (isUnambiguousGrantRow(row)) {
      addGrant(key, Number(row.amount_days));
    } else if (isAmbiguousGrantCandidateRow(row)) {
      ambiguousKeys.add(key);
    }
    // else: deduction/encashment — consumption, not a grant, ignored.
  }

  return { grantTotalByKey, ambiguousKeys };
}
