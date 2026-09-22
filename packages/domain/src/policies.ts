/**
 * Deterministic mirror of `resolve_policy()`
 * (supabase/migrations/20260925000000_phase2_country_policy_engine.sql) for
 * a fetched batch of policy versions — same reasoning as
 * `resolveContractAsOf` in contracts.ts: kept separate rather than shared,
 * since policy versions and contract versions have different field names
 * and evolve independently even though the "pick the version covering this
 * date" shape is the same.
 */
export interface PolicyVersionLike {
  effectiveFrom: string;
  effectiveTo: string | null;
  versionNo: number;
  status: "draft" | "active" | "superseded";
}

export function resolvePolicyVersionAsOf<T extends PolicyVersionLike>(
  versions: readonly T[],
  asOf: string,
): T | null {
  const covering = versions.filter(
    (v) => v.status === "active" && v.effectiveFrom <= asOf && (v.effectiveTo === null || v.effectiveTo >= asOf),
  );
  if (covering.length === 0) return null;
  return covering.reduce((latest, v) => (v.versionNo > latest.versionNo ? v : latest));
}
