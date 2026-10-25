import Link from "next/link";
import { Radio } from "lucide-react";
import { workModeLabel } from "@/lib/recovery/labels";
import type { LiveSummary } from "@/lib/my-day/live";
import { cardLink, MyDayCard } from "./card-shell";

const modeWords = (mode: string) => (mode === "not_stated" ? "Mode not stated" : workModeLabel(mode));

/**
 * LIVE clock status: how many people have an open clock session right now, and in which work mode. It is deliberately a different thing from
 * the recorded daily attendance further down (present, on leave, rest day), and says so. It shows only people the viewer may see.
 */
export function PeopleToday({ live }: { live: LiveSummary | "error" }) {
  return (
    <MyDayCard title="People today" label="People today, live clock status" actions={<Link href="/attendance" className={cardLink}>Attendance</Link>}>
      {live === "error" ? (
        <p className="text-sm text-muted-foreground">Live clock status could not be loaded right now. Reload in a moment.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline gap-2.5">
            <Radio className="h-4 w-4 flex-none self-center text-accent" aria-hidden />
            <span className="font-heading text-3xl font-semibold tabular-nums leading-none">{live.clockedIn}</span>
            <span className="text-sm text-muted-foreground">{live.clockedIn === 1 ? "person clocked in now" : "people clocked in now"}</span>
          </div>
          {live.byMode.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Clocked in by work mode">
              {live.byMode.map((m) => <li key={m.mode} className="os-pill" data-tone="cyan"><span className="os-dot" data-tone="cyan" aria-hidden />{modeWords(m.mode)} <span className="font-bold tabular-nums">{m.count}</span></li>)}
            </ul>
          ) : null}
          <p className="text-[13px] text-muted-foreground">Live clock status for the people you can see. Recorded attendance is under People &amp; HR below.</p>
        </div>
      )}
    </MyDayCard>
  );
}
