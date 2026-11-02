import { PAID_VIA_NEEDS_PERSON, type PaidVia } from "@enginious-hr/domain";

/**
 * "How paid" and "Who paid" are asked once for the whole list and only repeated on a line that differs. A line that leaves them empty uses the
 * default; a line that sets them keeps its own. What is sent to (and saved by) the database is always the effective value, line by line, so the
 * stored rows are exactly what a person would have entered line by line, and no amount or total is touched.
 */
export interface PaymentDefault { via: PaidVia | ""; by: string }
export interface PayLine { actual: string; paid_via: PaidVia | ""; paid_by: string }

const hasAmount = (l: PayLine) => { const n = Number(l.actual); return l.actual !== "" && Number.isFinite(n) && n > 0; };

/** The most common payment among lines that carry an amount (ties: the first), else the given fallback person with no source chosen yet. */
export function initialDefault(lines: readonly PayLine[], fallbackBy: string): PaymentDefault {
  const counts = new Map<string, { n: number; d: PaymentDefault }>();
  for (const l of lines.filter((x) => hasAmount(x) && x.paid_via !== "")) {
    const key = `${l.paid_via}|${l.paid_by}`;
    const cur = counts.get(key) ?? { n: 0, d: { via: l.paid_via, by: l.paid_by } };
    cur.n += 1;
    counts.set(key, cur);
  }
  let best: { n: number; d: PaymentDefault } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best ? best.d : { via: "", by: fallbackBy };
}

/** Lines that already match the default stop carrying their own copy, so they follow the default from here on. */
export function inheritWhereSame<T extends PayLine>(lines: readonly T[], def: PaymentDefault): T[] {
  if (def.via === "") return [...lines];
  return lines.map((l) => (hasAmount(l) && l.paid_via === def.via && l.paid_by === def.by ? { ...l, paid_via: "" as const, paid_by: "" } : l));
}

export function effectivePayment(l: PayLine, def: PaymentDefault): { via: PaidVia | ""; by: string } {
  const via = l.paid_via || def.via;
  // Only a source that needs a person carries one (the database drops it otherwise).
  return { via, by: via !== "" && PAID_VIA_NEEDS_PERSON[via] ? l.paid_by || def.by : "" };
}

/** True when the line takes the default for the source (it sets no source of its own). */
export const followsDefault = (l: PayLine, def: PaymentDefault) => def.via !== "" && l.paid_via === "";
