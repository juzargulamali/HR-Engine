import Link from "next/link";
import { movementFromTo, movementKindWord, movementQuantity, movementWhen, movementZone, type Resolver } from "@/lib/inventory/movement-view";
import type { MovementBrief, Names } from "@/lib/inventory/stock";
import type { InvBinRow, InvLocationRow } from "@/types/inventory";

export function makeResolver(locations: readonly InvLocationRow[], bins: readonly InvBinRow[], names: Names): Resolver {
  const loc = new Map(locations.map((l) => [l.id, l.name]));
  const bin = new Map(bins.map((b) => [b.id, b.label?.trim() ? `${b.code} (${b.label})` : b.code]));
  return {
    location: (id) => (id ? (loc.get(id) ?? "Another location") : "—"),
    bin: (id) => (id ? (bin.get(id) ?? null) : null),
    employee: (id) => names.employee(id),
    project: (id) => names.project(id),
  };
}

/**
 * Movements of one item or unit, newest first: what happened, when (in the time zone of the place), by whom, from where to where.
 * Each entry links to the full ledger entry on the Movements page, which people who cannot view stock never see (they get no history).
 */
export function HistoryList({ rows, names, resolver, itemName, locations, fallbackZone, emptyText, linkToLedger }: {
  rows: readonly MovementBrief[]; names: Names; resolver: Resolver; itemName: (id: string) => string; locations: readonly InvLocationRow[]; fallbackZone: string; emptyText: string; linkToLedger: boolean;
}) {
  if (rows.length === 0) return <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{emptyText}</p>;
  const zone = new Map(locations.map((l) => [l.id, l.timezone]));
  return (
    <ol className="divide-y divide-border rounded-md border border-border" aria-label="Movements">
      {rows.map((m) => {
        const z = movementZone(m, (id) => zone.get(id) ?? null, fallbackZone);
        const { from, to } = movementFromTo(m, resolver);
        return (
          <li key={m.id} className="space-y-0.5 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-medium">{movementKindWord(m.kind)}</span>
              <span className="text-[13px] text-muted-foreground">{movementWhen(m.occurred_at, z)}</span>
            </div>
            <p className="break-words text-muted-foreground">{movementQuantity(m, itemName)}: {from} → {to}</p>
            <p className="text-[13px] text-muted-foreground">
              By {names.user(m.performed_by)}
              {m.project_id ? ` · project ${names.project(m.project_id)}` : ""}
              {m.employee_id ? ` · ${names.employee(m.employee_id)}` : ""}
              {m.request_id ? ` · request ${names.request(m.request_id)}` : ""}
              {m.note ? ` · “${m.note}”` : m.reason ? ` · “${m.reason}”` : ""}
              {linkToLedger ? <>{" · "}<Link href={`/inventory/movements?open=${m.id}`} className="underline underline-offset-2">{m.code}</Link></> : ` · ${m.code}`}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
