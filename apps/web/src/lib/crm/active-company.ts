/**
 * Which Enginious company a Sales page or form works in ("the active company"). Pure, shared by the server pages and the small client piece that remembers the choice.
 *
 * Sales used to have no active company: every page and every Add enquiry form opened on the first company by name, so a person reviewing a UAE enquiry
 * was offered "Enginious Europe" and EUR. The order now is:
 *
 *   1. the current context: the company in the address, or the company of the record on screen (the caller passes it as `asked`);
 *   2. the company the person used last in Sales (a cookie, checked here against the companies they hold Sales access to today);
 *   3. their own employing company, when they hold Sales access to it (a configured fact, not a guess);
 *   4. their only company, when there is exactly one;
 *   5. otherwise nothing: `from` is "choose" and the page or form asks the person to choose. It never picks the first by name.
 *
 * A value that is not one of the person's companies is ignored, never trusted. The database checks access to the company on every read and write anyway.
 */
export const SALES_COMPANY_COOKIE = "sales_company";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActiveCompanySource = "context" | "remembered" | "home" | "only" | "choose" | "none";
export interface ActiveCompany<T> { company: T | null; from: ActiveCompanySource }

export function chooseSalesCompany<T extends { id: string }>(
  companies: readonly T[],
  options: { asked?: string | null; remembered?: string | null; home?: string | null } = {},
): ActiveCompany<T> {
  if (companies.length === 0) return { company: null, from: "none" };
  const find = (id: string | null | undefined) => (id && UUID.test(id) ? (companies.find((c) => c.id === id) ?? null) : null);
  const asked = find(options.asked);
  if (asked) return { company: asked, from: "context" };
  const remembered = find(options.remembered);
  if (remembered) return { company: remembered, from: "remembered" };
  const home = find(options.home);
  if (home) return { company: home, from: "home" };
  if (companies.length === 1) return { company: companies[0]!, from: "only" };
  return { company: null, from: "choose" };
}

/** In words, why this company is the one shown (for the ⓘ beside the company). */
export const ACTIVE_COMPANY_WHY: Record<ActiveCompanySource, string> = {
  context: "It is the company of what you have open.",
  remembered: "It is the company you used last in Sales.",
  home: "It is the company you are employed by.",
  only: "It is the only company you have Sales access to.",
  choose: "You have Sales access to more than one company, so choose one.",
  none: "You have no Sales access to any company.",
};
