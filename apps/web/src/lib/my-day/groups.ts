/**
 * Where each "needs you" row of My Day is shown, so every figure appears once. The rows themselves are built in one place (the page, from
 * authorised counts); this only sorts them into the card that is about them. The sentence under the greeting counts all of them.
 */
export type ActionGroup = "decision" | "hr" | "sales" | "other";

const HR_KEYS = new Set(["contracts", "probation", "docs", "identity"]);
const DECISION_KEYS = new Set(["approvals", "proj-handovers", "proj-reviews"]);

export function actionGroupOf(key: string): ActionGroup {
  if (DECISION_KEYS.has(key)) return "decision";
  if (HR_KEYS.has(key)) return "hr";
  if (key.startsWith("sales-")) return "sales";
  return "other";
}

export function splitActions<T extends { key: string; count: number }>(items: readonly T[]): Record<ActionGroup, T[]> {
  const out: Record<ActionGroup, T[]> = { decision: [], hr: [], sales: [], other: [] };
  for (const i of items) out[actionGroupOf(i.key)].push(i);
  return out;
}

export const sumCounts = (items: readonly { count: number }[]) => items.reduce((n, i) => n + i.count, 0);
