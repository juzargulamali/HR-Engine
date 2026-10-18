import Link from "next/link";
import { cn } from "@/lib/utils";
import { barLayout, type DisplayEntry } from "./helpers";
import { formatDate } from "@/lib/projects/format";

/**
 * A simple horizontal bar timeline of project spans. It is a secondary view: every span is also in the agenda list and the table
 * under it, so nothing is available only as a drawing.
 */
export function SpanBars({ entries, label }: { entries: DisplayEntry[]; label: string }) {
  const items = entries.filter((e) => e.onDate).map((e) => ({ id: e.id, title: e.title, start: e.onDate!, end: e.endDate ?? e.onDate!, e }));
  const layout = barLayout(items);
  if (!layout) return null;
  return (
    <figure className="space-y-2" aria-label={label}>
      <div className="flex justify-between text-sm text-muted-foreground"><span>{formatDate(layout.range.start)}</span><span>{formatDate(layout.range.end)}</span></div>
      <ul className="space-y-1.5">
        {layout.bars.map((b) => (
          <li key={b.id} className="grid items-center gap-2 sm:grid-cols-[12rem_1fr]">
            <Link href={items.find((i) => i.id === b.id)!.e.href} className="truncate text-sm font-medium hover:underline">{b.title}</Link>
            <div className="relative h-5 rounded bg-secondary" aria-hidden>
              <div className={cn("absolute inset-y-0 rounded bg-accent")} style={{ left: `${b.left}%`, width: `${b.width}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <figcaption className="text-sm text-muted-foreground">The same dates are listed in words in the agenda and the table below.</figcaption>
    </figure>
  );
}
