/**
 * Which company an Operations page shows. Pure and shared by the server pages and the small client piece that remembers the choice.
 *
 * The order is: the company named in the address, when the person is its Operations Manager; else the company they used last (a cookie, checked here against the companies they are
 * Operations Manager of today, so a revoked company is never restored); else their first company (the list is ordered by company name, which is the default). A value that is not one
 * of their companies is ignored, never trusted: the database checks the capability on every read anyway.
 */
export const OPS_COMPANY_COOKIE = "ops_company";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function choosePermittedCompany<T extends { id: string }>(companies: readonly T[], asked?: string | null, remembered?: string | null): { company: T | null; from: "address" | "remembered" | "default" | "none" } {
  const find = (id: string | null | undefined) => (id && UUID.test(id) ? (companies.find((c) => c.id === id) ?? null) : null);
  const a = find(asked);
  if (a) return { company: a, from: "address" };
  const r = find(remembered);
  if (r) return { company: r, from: "remembered" };
  const d = companies[0] ?? null;
  return { company: d, from: d ? "default" : "none" };
}
