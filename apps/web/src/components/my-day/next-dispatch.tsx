import Link from "next/link";
import { AlertTriangle, PackageCheck } from "lucide-react";
import type { Equipment } from "@/lib/my-day/loaders";
import type { DispatchRequest } from "@/lib/my-day/dispatch";
import { cardLink, MyDayCard } from "./card-shell";

function neededAt(r: DispatchRequest): string {
  if (!r.needed_from) return "No date set";
  const tz = r.timezone ?? "Asia/Dubai";
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(r.needed_from));
  return `${when} · ${tz.split("/").pop()?.replace(/_/g, " ")}`;
}

/**
 * The live equipment request whose gear is needed first and is not yet fully dispatched. "Lines dispatched" means equipment that has actually
 * gone out; a shortage is a line the stock cannot cover for its dates. Neither is an availability check. Shown only with Inventory access.
 */
export function NextDispatch({ equipment }: { equipment: Equipment | "error" | null }) {
  if (equipment === null) return null;
  const actions = <Link href="/inventory/requests" className={cardLink}>All requests</Link>;
  if (equipment === "error") return <MyDayCard title="Next dispatch" tone="cool" actions={actions}><p className="text-sm text-muted-foreground">Equipment requests could not be loaded right now. Reload in a moment.</p></MyDayCard>;
  const r = equipment.next;
  if (!r) {
    return <MyDayCard title="Next dispatch" tone="cool" actions={actions}><p className="flex items-start gap-2.5 text-sm text-muted-foreground"><PackageCheck className="mt-0.5 h-4 w-4 flex-none" aria-hidden />No equipment is waiting to be dispatched.</p></MyDayCard>;
  }
  const pct = r.total === 0 ? 0 : Math.round((r.done / r.total) * 100);
  return (
    <MyDayCard title="Next dispatch" tone="cool" actions={actions}>
      <p className="break-words font-semibold">{r.forLabel}</p>
      <p className="text-sm text-muted-foreground">{r.code} · needed {neededAt(r)}</p>
      <div className="mt-3" role="group" aria-label={`${r.done} of ${r.total} lines dispatched`}>
        <div className="mb-1 flex items-baseline justify-between text-sm"><span>Lines dispatched</span><span className="font-semibold tabular-nums">{r.done} of {r.total}</span></div>
        <div className="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--foreground)/0.1)]" aria-hidden><div className="h-full rounded-full bg-[hsl(var(--fill-teal))]" style={{ width: `${pct}%` }} /></div>
      </div>
      {r.shortageLines > 0 ? <p className="mt-2.5 flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-amber))]" aria-hidden /><span><span className="font-medium">{r.shortageLines} line{r.shortageLines === 1 ? "" : "s"} short.</span> <span className="text-muted-foreground">Stock does not cover {r.shortageLines === 1 ? "it" : "them"} for these dates.</span></span></p> : null}
      <Link href={`/inventory/requests?open=${r.id}`} className="mt-3 inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium os-btn-outline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open equipment request</Link>
    </MyDayCard>
  );
}
