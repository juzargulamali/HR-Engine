/**
 * Deterministic mirror of the `get_contract_as_of()` Postgres function
 * (supabase/migrations/20260924000000_phase1_contracts_compensation_identity.sql).
 * Kept here, pure and unit-testable, for anywhere the UI needs to answer
 * "which contract version applies on date X" without a round trip — e.g.
 * client-side preview before a Server Action confirms it. The database
 * function is still the source of truth for anything actually persisted or
 * queried in bulk; this exists so the two can be tested against the same
 * fixtures and never quietly disagree.
 *
 * Dates are plain ISO 'YYYY-MM-DD' strings throughout, compared
 * lexicographically — exactly equivalent to date comparison for that
 * format, and it sidesteps timezone parsing entirely (docs/05-automation-rules.md
 * §5.2 on why HR dates are `date`, never `timestamptz`).
 */
export interface ContractVersionLike {
  startDate: string;
  endDate: string | null;
  versionNo: number;
}

export function resolveContractAsOf<T extends ContractVersionLike>(
  contracts: readonly T[],
  asOf: string,
): T | null {
  const covering = contracts.filter((c) => c.startDate <= asOf && (c.endDate === null || c.endDate >= asOf));
  if (covering.length === 0) return null;
  // Versions shouldn't overlap in practice, but if they ever do (a data
  // error), prefer the most recent rather than picking arbitrarily.
  return covering.reduce((latest, c) => (c.versionNo > latest.versionNo ? c : latest));
}
