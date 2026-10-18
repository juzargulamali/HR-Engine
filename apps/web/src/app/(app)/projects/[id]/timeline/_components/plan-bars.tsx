import { barLayout, type BarItem } from "@/components/projects/calendar/helpers";
import { formatDate } from "@/lib/projects/format";

/** A horizontal bar picture of dated timeline items. Secondary: the table beside it has every date in words. */
export function PlanBars({ items, label }: { items: BarItem[]; label: string }) {
  const layout = barLayout(items);
  if (!layout) return null;
  return (
    <figure className="space-y-1.5" aria-label={label}>
      <div className="flex justify-between text-sm text-muted-foreground"><span>{formatDate(layout.range.start)}</span><span>{formatDate(layout.range.end)}</span></div>
      <ul className="space-y-1.5">
        {layout.bars.map((b) => (
          <li key={b.id} className="grid items-center gap-2 sm:grid-cols-[10rem_1fr]">
            <span className="truncate text-sm">{b.title}</span>
            <div className="relative h-4 rounded bg-secondary" aria-hidden>
              <div className="absolute inset-y-0 rounded bg-accent" style={{ left: `${b.left}%`, width: `${b.width}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
