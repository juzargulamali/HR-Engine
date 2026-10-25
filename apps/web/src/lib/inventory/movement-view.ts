import type { InvMovementKind } from "@/types/inventory";
import { MOVEMENT_WORDS, formatQty } from "./words";
import { formatInZone } from "./stock-movements";

/**
 * Reading the ledger in words: where a line came from and went to, how much moved, when (in the place's own time zone). Pure functions
 * over rows the person was allowed to read; a missing name stays a plain word, never a guess.
 */

export interface LineLike {
  item_id: string;
  unit_id: string | null;
  qty: number | string;
  from_kind: string;
  to_kind: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_bin_id: string | null;
  to_bin_id: string | null;
  from_employee_id: string | null;
  to_employee_id: string | null;
  from_project_id: string | null;
  to_project_id: string | null;
  condition_from?: string | null;
  condition_to?: string | null;
}

export interface MovementLike {
  kind: InvMovementKind;
  occurred_at: string;
  from_location_id: string | null;
  to_location_id: string | null;
  project_id: string | null;
  employee_id: string | null;
  lines: readonly LineLike[];
}

export interface Resolver {
  location: (id: string | null) => string;
  bin: (id: string | null) => string | null;
  employee: (id: string | null) => string;
  project: (id: string | null) => string;
}

const KIND_FROM: Record<string, string> = { external: "Outside (new stock)", transit: "On the way", repair: "At the repairer", kit: "Inside a kit", adjustment: "Stock record" };
const KIND_TO: Record<string, string> = { consumed: "Used up", transit: "On the way", repair: "At the repairer", kit: "Inside a kit", adjustment: "Stock record" };

function place(kind: string, locationId: string | null, binId: string | null, employeeId: string | null, projectId: string | null, r: Resolver, words: Record<string, string>): string {
  switch (kind) {
    case "warehouse": {
      const bin = r.bin(binId);
      return `${r.location(locationId)}${bin ? `, bin ${bin}` : ""}`;
    }
    case "employee": return employeeId ? `Employee: ${r.employee(employeeId)}` : "An employee";
    case "project": return projectId ? `Project: ${r.project(projectId)}` : "A project";
    default: return words[kind] ?? kind;
  }
}

export function lineFrom(l: LineLike, r: Resolver): string {
  return place(l.from_kind, l.from_location_id, l.from_bin_id, l.from_employee_id, l.from_project_id, r, KIND_FROM);
}
export function lineTo(l: LineLike, r: Resolver): string {
  return place(l.to_kind, l.to_location_id, l.to_bin_id, l.to_employee_id, l.to_project_id, r, KIND_TO);
}

/** "A → B" for the whole movement: the single place if every line agrees, otherwise the common kind of place ("several places"). */
export function movementFromTo(m: MovementLike, r: Resolver): { from: string; to: string } {
  const pick = (texts: string[], dflt: string) => {
    const unique = [...new Set(texts)];
    return unique.length === 0 ? dflt : unique.length === 1 ? unique[0]! : "Several places";
  };
  return { from: pick(m.lines.map((l) => lineFrom(l, r)), "—"), to: pick(m.lines.map((l) => lineTo(l, r)), "—") };
}

/** How much moved: units count one each, counted stock adds up per item. */
export function movementQuantity(m: Pick<MovementLike, "lines">, itemName: (id: string) => string, uom?: (id: string) => string): string {
  const units = m.lines.filter((l) => l.unit_id).length;
  const perItem = new Map<string, number>();
  for (const l of m.lines) if (!l.unit_id) perItem.set(l.item_id, (perItem.get(l.item_id) ?? 0) + Number(l.qty));
  const parts: string[] = [];
  if (units > 0) parts.push(`${units} individual item${units === 1 ? "" : "s"}`);
  for (const [id, q] of perItem) parts.push(`${formatQty(q, uom?.(id))} ${itemName(id)}`);
  return parts.join(", ") || "—";
}

/** What was moved, by name: "Laptop X1 ×2, XLR cable". */
export function movementWhat(m: Pick<MovementLike, "lines">, itemName: (id: string) => string, max = 3): string {
  const counts = new Map<string, number>();
  for (const l of m.lines) counts.set(l.item_id, (counts.get(l.item_id) ?? 0) + (l.unit_id ? 1 : 0));
  const names = [...counts.entries()].map(([id, n]) => (n > 1 ? `${itemName(id)} ×${n}` : itemName(id)));
  return names.length <= max ? names.join(", ") || "—" : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

export const movementKindWord = (kind: InvMovementKind): string => MOVEMENT_WORDS[kind] ?? kind;

/** The time zone to show a movement in: the place it happened (where it came from, else where it went), else the fallback. */
export function movementZone(m: Pick<MovementLike, "kind" | "from_location_id" | "to_location_id">, zoneOf: (locationId: string) => string | null, fallback: string): string {
  const receiving = ["receipt", "rental_receipt", "return_employee", "return_project", "repair_in", "transfer_receive", "return_unused", "unpack_kit", "opening"].includes(m.kind);
  const first = receiving ? (m.to_location_id ?? m.from_location_id) : (m.from_location_id ?? m.to_location_id);
  return (first ? zoneOf(first) : null) ?? fallback;
}

export const movementWhen = (iso: string, zone: string): string => formatInZone(iso, zone);

/** Local date typed in a filter box (YYYY-MM-DD) as the start of that day in a zone, as an ISO instant. */
export function dayStartIso(day: string, zone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const guess = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(guess)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guess));
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
    return new Date(guess - (asUtc - guess)).toISOString();
  } catch {
    return null;
  }
}

/** The end of a filter range is the START of the next day (exclusive), so "to 5 Nov" includes all of 5 Nov. */
export function nextDay(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
