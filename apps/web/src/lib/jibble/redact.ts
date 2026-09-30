import "server-only";

/** Shared by the sync route and the preview route: truncates long string
 * values (notes, free text) and caps array length, so a redacted payload is
 * safe to put in cron logs or a preview response without leaking an
 * employee's full note text or dumping an unbounded batch. */
export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return value.length > 40 ? `${value.slice(0, 40)}…(${value.length} chars)` : value;
  if (Array.isArray(value)) return value.slice(0, 3).map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactValue(v)]));
  }
  return value;
}
