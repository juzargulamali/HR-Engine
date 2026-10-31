import { Badge } from "@/components/ui/badge";
import type { ItemTotals } from "@/lib/inventory/workspace";
import { cn } from "@/lib/utils";

/**
 * Sent / Returned / Still out for the equipment of one request, at the level the data supports (see lib/inventory/workspace.ts). Used by the
 * Receive back step, the request panel and the project's Equipment page, so all three say the same thing: units are exact; counted stock that
 * could have been returned for more than one request or line is shown for the PROJECT, with the reason, and a "Returned" figure is never guessed.
 */
export function SentReturned({ totals, heading }: { totals: ItemTotals[]; heading: string }) {
  if (totals.length === 0) return null;
  const projectLevel = totals.filter((t) => t.level === "project");
  return (
    <section aria-label="Sent, returned and still out" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="hidden grid-cols-[minmax(0,2fr)_repeat(3,6.5rem)] gap-3 border-b border-border bg-secondary/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid"><span>{heading}</span><span className="text-right">Sent</span><span className="text-right">Returned</span><span className="text-right">Still out</span></div>
      <ul className="divide-y divide-border/70">
        {totals.map((t) => (
          <li key={t.itemId} className="grid grid-cols-3 gap-x-3 gap-y-1 px-4 py-2.5 text-sm md:grid-cols-[minmax(0,2fr)_repeat(3,6.5rem)] md:items-center">
            <p className="col-span-3 font-medium md:col-span-1">{t.name}{t.level === "project" ? <Badge variant="outline" className="ml-2 align-middle">Project level</Badge> : null}</p>
            <p className="md:text-right"><span className="text-xs text-muted-foreground md:hidden">Sent </span>{t.sent}</p>
            <p className="md:text-right"><span className="text-xs text-muted-foreground md:hidden">Returned </span>{t.returned === null ? <span title="Counted stock comes back to the project, not to a request line" aria-label="Not shown for this request">—</span> : t.returned}</p>
            <p className={cn("md:text-right", (t.stillOut ?? 0) > 0 && "font-semibold")}><span className="text-xs font-normal text-muted-foreground md:hidden">Still out </span>{t.stillOut === null ? "—" : t.stillOut}{t.level === "project" && t.stillOut !== null ? <span className="block text-xs font-normal text-muted-foreground">held by the project</span> : null}</p>
          </li>
        ))}
      </ul>
      {projectLevel.length > 0 ? <ul className="space-y-1 border-t border-border/70 bg-secondary/30 px-4 py-2 text-xs text-muted-foreground">{[...new Set(projectLevel.map((t) => t.note))].map((n) => <li key={n}>{n}</li>)}</ul> : null}
    </section>
  );
}
