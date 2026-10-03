"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Keeps a server-rendered page current with authenticated polling (a plain
 * router.refresh(), which re-runs the page's own row-level-security-protected
 * queries) — no public endpoint, no secrets in the browser.
 *
 * `generatedAt` is the SERVER's own timestamp for the data on screen. After each
 * refresh the page re-renders with a newer value; if it stops advancing (the
 * network dropped, the server is failing) the badge turns to "Stale", and
 * "Disconnected" while the browser itself reports being offline — so nobody
 * mistakes old numbers for live ones. Polling pauses while the tab is hidden
 * and refreshes immediately when it becomes visible again.
 */
export function AutoRefresh({ generatedAt, timeZone, intervalSeconds = 30 }: { generatedAt: string; timeZone: string; intervalSeconds?: number }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

  useEffect(() => {
    const goOnline = () => router.refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("online", goOnline);
    document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    }, intervalSeconds * 1000);
    const tick = window.setInterval(() => setNow(Date.now()), 5000);
    return () => {
      window.removeEventListener("online", goOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [router, intervalSeconds]);

  const generated = new Date(generatedAt);
  const ageSeconds = Math.max(0, (now - generated.getTime()) / 1000);
  const stale = ageSeconds > intervalSeconds * 2.5;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(generated);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
      <span>Last updated {time}</span>
      {!online ? (
        <Badge variant="destructive">Disconnected — showing the last data received</Badge>
      ) : stale ? (
        <Badge variant="warning">Stale — refreshing</Badge>
      ) : (
        <Badge variant="outline">Live · refreshes every {intervalSeconds}s</Badge>
      )}
    </div>
  );
}
