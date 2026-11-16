/**
 * Which step or form a profile link asks to open. Every setup step, exception and renewal link carries `?tab=` plus one of these, so the right form opens with the
 * employee already chosen and nothing is retyped. The page parses the address once and hands the same object to the tab that owns the form.
 *
 *   step    which setup step the person came from: contract | pay | documents | opening-balances | account | job
 *   add     a document type key to open the shared Add document form with: `identity:passport`, `employee:visa` ...
 *   renew   "1" when the form was opened to renew an existing document (the earlier one is kept in the history)
 *   change  `salary` or `job`: which part of the one job-and-pay change form to lead with
 */
export interface ProfileFocus { step?: string; add?: string; renew?: boolean; change?: "salary" | "job" }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function parseFocus(sp: Record<string, string | string[] | undefined>): ProfileFocus {
  const change = one(sp.change);
  return {
    step: one(sp.step),
    add: one(sp.add),
    renew: one(sp.renew) === "1",
    change: change === "salary" || change === "job" ? change : undefined,
  };
}
