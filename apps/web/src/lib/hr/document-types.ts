/**
 * Document types for the one shared "Add document" flow on an employee profile.
 *
 * Two tables already exist and stay: `identity_documents` (number, optional scan; readable by the person and their HR Admin only, so it keeps the tighter access) and
 * `employee_documents` (a file is always required; its expiry is tracked by the daily document-expiry job, which moves a document valid -> expiring soon -> expired).
 * The type, not the table, is what a person chooses: this registry says which table a type is stored in and which fields it needs, so the form shows exactly the fields
 * the type requires and the server checks the same rule. Nothing here is a new record type.
 */
export type DocumentStore = "identity" | "employee";
export type ExpiryRule = "required" | "optional" | "none";

export interface DocumentTypeRule {
  /** The value stored in `document_type`. */
  code: string;
  label: string;
  store: DocumentStore;
  /** Identity documents carry a number; employee documents carry a file. */
  numberRequired: boolean;
  fileRequired: boolean;
  /** `required`: the date must be given; `optional`: it may be; `none`: the document does not expire (the date is not asked for). */
  expiry: ExpiryRule;
  /** `job`: the daily document-expiry job moves its status. `date`: the profile and directory flag it from the date alone. `none`: never expires. */
  tracking: "job" | "date" | "none";
  /** Countries where the type is usually held; used only to suggest the likely ones first. Empty = everywhere. */
  countries: readonly string[];
}

export const DOCUMENT_TYPES: readonly DocumentTypeRule[] = [
  { code: "passport", label: "Passport", store: "identity", numberRequired: true, fileRequired: false, expiry: "required", tracking: "date", countries: [] },
  { code: "emirates_id", label: "Emirates ID", store: "identity", numberRequired: true, fileRequired: false, expiry: "required", tracking: "date", countries: ["AE"] },
  { code: "iqama", label: "Iqama", store: "identity", numberRequired: true, fileRequired: false, expiry: "required", tracking: "date", countries: ["SA"] },
  { code: "pesel", label: "PESEL", store: "identity", numberRequired: true, fileRequired: false, expiry: "none", tracking: "none", countries: ["PL"] },
  { code: "other_identity", label: "Other identity document", store: "identity", numberRequired: true, fileRequired: false, expiry: "optional", tracking: "date", countries: [] },
  { code: "visa", label: "Visa", store: "employee", numberRequired: false, fileRequired: true, expiry: "required", tracking: "job", countries: ["AE", "SA"] },
  { code: "labor_card", label: "Labor card", store: "employee", numberRequired: false, fileRequired: true, expiry: "required", tracking: "job", countries: ["AE"] },
  { code: "certificate", label: "Certificate", store: "employee", numberRequired: false, fileRequired: true, expiry: "optional", tracking: "job", countries: [] },
  { code: "other", label: "Other document", store: "employee", numberRequired: false, fileRequired: true, expiry: "optional", tracking: "job", countries: [] },
];

/** The picker's value: store and code together, because `passport` and `emirates_id` also exist as older employee documents. */
export const typeKey = (store: DocumentStore, code: string) => `${store}:${code}`;

/** What the identity table calls "other": the code the picker uses is `other_identity`, the stored value stays `other`. */
export const storedCode = (rule: DocumentTypeRule) => (rule.store === "identity" && rule.code === "other_identity" ? "other" : rule.code);

export function ruleFor(store: DocumentStore, storedType: string): DocumentTypeRule | null {
  const code = store === "identity" && storedType === "other" ? "other_identity" : storedType;
  return DOCUMENT_TYPES.find((t) => t.store === store && t.code === code) ?? null;
}

export function ruleForKey(key: string | null | undefined): DocumentTypeRule | null {
  if (!key) return null;
  const i = key.indexOf(":");
  if (i < 0) return null;
  const store = key.slice(0, i);
  if (store !== "identity" && store !== "employee") return null;
  return DOCUMENT_TYPES.find((t) => t.store === store && t.code === key.slice(i + 1)) ?? null;
}

/** The types to offer, the ones usual for the employee's country first (the rest stay available). */
export function typesForCountry(countryCode: string | null | undefined): { suggested: DocumentTypeRule[]; other: DocumentTypeRule[] } {
  const cc = (countryCode ?? "").toUpperCase();
  const usual = (t: DocumentTypeRule) => t.countries.includes(cc);
  return { suggested: DOCUMENT_TYPES.filter(usual), other: DOCUMENT_TYPES.filter((t) => !usual(t)) };
}

export interface DocumentFields { number?: string | null; expiry?: string | null; hasFile: boolean }

/** The sentence for the first thing a type needs that is missing, or null when the fields satisfy the rule. Used by the form and, again, by the server action. */
export function missingForType(rule: DocumentTypeRule, f: DocumentFields): string | null {
  if (rule.numberRequired && !(f.number ?? "").trim()) return `Enter the ${rule.label} number.`;
  if (rule.fileRequired && !f.hasFile) return `Attach the ${rule.label} file.`;
  if (rule.expiry === "required" && !(f.expiry ?? "").trim()) return `Enter the ${rule.label} expiry date.`;
  return null;
}

export type ExpiryState = "none" | "valid" | "expiring" | "expired";
export const EXPIRING_SOON_DAYS = 60;

/** Date-only classification (both dates are calendar days in the employee's country). Uses the same 60-day look-ahead as the default expiry rule. */
export function expiryState(expiryDate: string | null | undefined, today: string, leadDays = EXPIRING_SOON_DAYS): ExpiryState {
  if (!expiryDate) return "none";
  if (expiryDate < today) return "expired";
  const days = Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days <= leadDays ? "expiring" : "valid";
}

/** What the current-version rule needs from a document row. Removed rows carry `deleted_at`; identity documents are never soft-removed (they have no such column). */
export interface VersionRow { id: string; document_type: string; created_at: string; employee_id?: string; deleted_at?: string | null }

/**
 * THE current-document rule, used by the profile (Documents tab order, Next actions) and the HR queue alike. A person's documents of one type form a history: a renewal adds a NEWER row and
 * leaves the earlier one in it. The current version of a type is the newest row that has not been removed (by when it was added; a tie goes to the later id), whatever its expiry date is,
 * including none. Expiry is judged on that row only, so a newer document with a shorter date decides (it can expire sooner), and a newer document with no expiry date clears the type.
 * Earlier versions are history and are never flagged. Rows of different employees are never mixed.
 */
export function currentVersions<T extends VersionRow>(rows: readonly T[]): T[] {
  const newest = new Map<string, T>();
  for (const r of rows) {
    if (r.deleted_at) continue;
    const k = `${r.employee_id ?? ""}:${r.document_type}`;
    const cur = newest.get(k);
    if (!cur || r.created_at > cur.created_at || (r.created_at === cur.created_at && r.id > cur.id)) newest.set(k, r);
  }
  return [...newest.values()];
}

/** Where the shared Add document form opens, with the type chosen; `renew` marks a renewal so the form says so and keeps the history of the earlier document, and `docId` names that earlier document (its number is prefilled, it is never changed). */
export function documentFormHref(employeeId: string, store: DocumentStore, storedType: string, renew = false, docId?: string): string {
  const rule = ruleFor(store, storedType);
  const key = rule ? typeKey(rule.store, rule.code) : typeKey(store, storedType);
  return `/employees/${employeeId}?tab=documents&add=${encodeURIComponent(key)}${renew ? "&renew=1" : ""}${renew && docId ? `&docId=${encodeURIComponent(docId)}` : ""}`;
}
