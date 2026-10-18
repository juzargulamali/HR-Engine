"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

function describe(openSince: string | null, nowMs: number): { short: string; spoken: string } | null {
  if (!openSince) return null;
  const minutes = Math.max(0, Math.floor((nowMs - new Date(openSince).getTime()) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { short: h > 0 ? `${h}h ${m}m` : `${m}m`, spoken: `${h > 0 ? `${h} hour${h === 1 ? "" : "s"} ` : ""}${m} minute${m === 1 ? "" : "s"}` };
}

/**
 * Compact attendance status for the header: always one tap from the real clock page, where Clock In / Clock Out live. The
 * state is written as text ("Clocked in · 1h 28m" / "Not clocked in"), never colour alone. `openSince` is the start of the
 * employee's open attendance session (null = no open session), `serverNowIso` makes the first render match the server's.
 */
export function ClockChip({ openSince, serverNowIso, className }: { openSince: string | null; serverNowIso: string; className?: string }) {
  const [nowMs, setNowMs] = useState(() => new Date(serverNowIso).getTime());
  useEffect(() => {
    // Deferred a tick (same pattern as theme-toggle.tsx): resync with the real clock right after mount, then once a minute.
    Promise.resolve().then(() => setNowMs(Date.now()));
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const d = describe(openSince, nowMs);
  const clockedIn = d !== null;
  return (
    <Link
      href="/attendance-clock"
      aria-label={clockedIn ? `Attendance: clocked in for ${d.spoken}. Open the attendance clock.` : "Attendance: not clocked in. Open the attendance clock."}
      className={cn(
        "flex h-9 flex-none items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors hover:bg-secondary",
        clockedIn ? "border-success/60 bg-success/10 text-success" : "border-input bg-field text-foreground",
        className,
      )}
    >
      <Clock className="h-3.5 w-3.5 flex-none" aria-hidden />
      <span className="whitespace-nowrap">{clockedIn ? `Clocked in · ${d.short}` : "Not clocked in"}</span>
    </Link>
  );
}
