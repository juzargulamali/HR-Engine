import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/components/sales/format";
import { cn } from "@/lib/utils";
import { describeClosures } from "./closure-helpers";
import { Panel } from "./parts";
import type { OppView } from "./view";

/**
 * Every time this opportunity was closed, newest first. A closure that was later reopened is kept, marked "Reopened"
 * and styled as past, so it can never be mistaken for the current outcome.
 */
export function ClosureHistory({ view }: { view: OppView }) {
  const { detail, ctx } = view;
  const closures = describeClosures(detail.closures, ctx.personName, formatDate);
  if (closures.length === 0) return null;
  return (
    <Panel title="Closure history" description="Each time this opportunity was marked Won or Lost. Reopening never erases a closure.">
      <ol className="space-y-3">
        {closures.map((c) => (
          <li key={c.id} className={cn("min-w-0 rounded-lg border p-3.5", c.status === "reopened" ? "border-dashed border-border bg-secondary/30 text-muted-foreground" : "border-border")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={c.status === "reopened" ? "outline" : c.outcome === "won" ? "success" : "secondary"}>{c.heading}</Badge>
              {c.status === "reopened" ? <Badge variant="warning">Reopened</Badge> : <Badge variant="outline">Current outcome</Badge>}
            </div>
            <p className="mt-2 break-words text-sm">{c.closedLine} · {formatDateTime(c.closedAt)}</p>
            <dl className="mt-2 space-y-1 text-sm">
              {c.valueText ? <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Value at close</dt><dd className="font-medium">{c.valueText}</dd></div> : null}
              {c.details.map((d) => <div key={d.label} className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">{d.label}</dt><dd className="min-w-0 break-words">{d.text}</dd></div>)}
            </dl>
            {c.reopened ? (
              <div className="mt-3 border-t border-border/70 pt-2 text-sm">
                <p className="break-words">{c.reopened.line} · {formatDateTime(c.reopened.at)}</p>
                <p className="break-words"><span className="text-muted-foreground">Why: </span>{c.reopened.reason ?? "No reason recorded"}</p>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

