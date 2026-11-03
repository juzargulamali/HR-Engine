/**
 * Plain wording for staff reading a policy: the policy's own values as "Label: value" lines instead of the stored JSON. Nothing is added, hidden or
 * reinterpreted except bookkeeping (the seed marker and the machine-readable model/rules of a Recovery Leave policy, which has its own readable table and
 * wording on the page). HR keeps the exact stored payload under "Technical details".
 */
export const POLICY_TYPE_TITLES: Record<string, string> = {
  leave_rules: "Leave rules",
  overtime_rules: "Overtime and Recovery Leave",
  notice_period: "Notice periods",
  probation_rules: "Probation",
  working_week: "Working week",
  end_of_service_benefit: "End of service benefit",
};

export const policyTitle = (type: string): string => POLICY_TYPE_TITLES[type] ?? type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const HIDDEN = new Set(["phase2b_seed_marker", "model", "rules", "wording", "statutory_safeguard"]);
const humanize = (key: string) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function text(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (Array.isArray(v)) return v.map(text).join(v.some((x) => x !== null && typeof x === "object") ? "; " : ", ");
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([k]) => !HIDDEN.has(k)).map(([k, x]) => `${humanize(k)} ${text(x)}`).join(", ");
  return String(v);
}

export function readablePayload(payload: unknown): { label: string; value: string }[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return Object.entries(payload as Record<string, unknown>).filter(([k]) => !HIDDEN.has(k)).map(([k, v]) => ({ label: humanize(k), value: text(v) }));
}

/** Own country first, the rest by country name. */
export function ownCountryFirst<T extends { country_code: string; countryName: string }>(items: readonly T[], ownCountry: string | null): { own: T[]; others: T[] } {
  const sort = (a: T, b: T) => a.countryName.localeCompare(b.countryName);
  return { own: items.filter((i) => ownCountry !== null && i.country_code === ownCountry).sort(sort), others: items.filter((i) => ownCountry === null || i.country_code !== ownCountry).sort(sort) };
}
