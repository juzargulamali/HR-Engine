import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

const SEGMENTS = [
  { key: "present", label: "Present", colorVar: "--success" },
  { key: "leave", label: "On leave", colorVar: "--accent" },
  { key: "absent", label: "Absent", colorVar: "--destructive" },
  { key: "notRecorded", label: "Not recorded", colorVar: "--muted-foreground" },
] as const;

/**
 * Today's attendance completion, from real attendance_records counts —
 * no charting library, just a labelled stacked bar (a real SVG, not a CSS
 * gradient trick, so segment widths are exact). Never populated with
 * invented data: if there are zero active employees, it shows an empty
 * state instead of an empty bar.
 */
export function AttendanceCompletionBar({
  present,
  leave,
  absent,
  notRecorded,
}: {
  present: number;
  leave: number;
  absent: number;
  notRecorded: number;
}) {
  const total = present + leave + absent + notRecorded;
  const values = { present, leave, absent, notRecorded };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s attendance completion</CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyState dense title="No active employees yet." description="Attendance completion will appear once employees are on record." />
        ) : (
          <div className="space-y-3">
            <svg viewBox="0 0 100 10" width="100%" height="14" role="img" aria-label={`${present} of ${total} employees present today`} preserveAspectRatio="none">
              <title>Attendance completion for today</title>
              {(() => {
                let x = 0;
                return SEGMENTS.map((seg) => {
                  const value = values[seg.key];
                  const width = (value / total) * 100;
                  const rect =
                    width > 0 ? (
                      <rect key={seg.key} x={x} y={0} width={width} height={10} fill={`hsl(var(${seg.colorVar}))`} opacity={seg.key === "notRecorded" ? 0.35 : 0.9} />
                    ) : null;
                  x += width;
                  return rect;
                });
              })()}
            </svg>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
              {SEGMENTS.map((seg) => (
                <li key={seg.key} className="flex items-center gap-1.5 text-muted-foreground">
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: `hsl(var(${seg.colorVar}))`, opacity: seg.key === "notRecorded" ? 0.35 : 0.9 }}
                    aria-hidden
                  />
                  {seg.label}: <span className="font-medium text-foreground">{values[seg.key]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
