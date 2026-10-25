import { cn } from "@/lib/utils";

export interface DonutSegment { key: string; label: string; value: number; /** A CSS colour, normally one of the theme tokens: hsl(var(--primary)). */ color: string }

/**
 * A ring chart drawn as plain SVG (no library). The meaning is never in colour alone: every segment is listed with its words and count in
 * the legend, and the ring has a text alternative. `center` is real text on top of the ring. With nothing to show it draws an empty ring.
 */
export function OsDonut({ segments, center, caption, size = 150, className }: { segments: readonly DonutSegment[]; center?: React.ReactNode; caption: string; size?: number; className?: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const r = 42, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-6 gap-y-3", className)}>
      <div className="relative flex-none" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${caption}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--foreground) / 0.1)" strokeWidth="11" />
          {total > 0 ? segments.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * c;
            const el = <circle key={s.key} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="11" strokeDasharray={`${Math.max(0, len - (segments.filter((x) => x.value > 0).length > 1 ? 1.2 : 0))} ${c}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />;
            offset += len;
            return el;
          }) : null}
        </svg>
        {center ? <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div> : null}
      </div>
      <ul className="min-w-0 flex-1 basis-40 space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: s.color }} aria-hidden /><span className="truncate">{s.label}</span></span>
            <span className="font-semibold tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
