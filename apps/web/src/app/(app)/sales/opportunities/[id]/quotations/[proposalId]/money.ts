/** Thousands separators for an exact decimal STRING (never a float). */
export function money(amount: string | null | undefined, currency?: string | null): string {
  if (amount == null) return "";
  const [i = "0", f] = amount.split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency ? `${currency} ` : ""}${grouped}${f !== undefined ? `.${f}` : ""}`;
}
