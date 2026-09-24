"use client";

import { useEffect, useState } from "react";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Cloudy, Sun, type LucideIcon } from "lucide-react";
import { formatBusinessDateLong, formatBusinessTime } from "@enginious-hr/domain";

const WEATHER_ICONS: Record<string, LucideIcon> = {
  Clear: Sun,
  "Partly cloudy": CloudSun,
  Cloudy: Cloudy,
  Fog: CloudFog,
  Rain: CloudRain,
  Showers: CloudRain,
  Snow: CloudSnow,
  Storm: CloudLightning,
};

export interface DashboardHeaderWeather {
  temperatureC: number;
  condition: string;
}

/**
 * Compact dashboard header: day of week / full local date, a live clock,
 * a location label, and (when available) current weather. `timeZone` picks
 * which business context this render is for — Asia/Dubai for the
 * cross-company CEO/HR view, or the viewer's own company's timezone for an
 * employee-only view (see page.tsx).
 *
 * `initialDateLabel`/`initialTimeLabel` are computed SERVER-SIDE and used
 * as this component's very first (pre-hydration) render — identical on the
 * server and the client's first paint, so React never sees a hydration
 * mismatch. Only AFTER mount does the effect below start reading the real
 * clock and re-rendering with a live value, once per minute — the same
 * "defer the real value to post-mount" pattern already used by
 * components/theme/theme-toggle.tsx for the same reason.
 *
 * Weather is fetched once, server-side, before this component ever renders
 * (see lib/weather.ts) — there is no client-side weather fetch or polling
 * here at all, only a value passed in as a prop.
 */
export function DashboardHeader({
  timeZone,
  locationLabel,
  initialDateLabel,
  initialTimeLabel,
  weather,
}: {
  timeZone: string;
  locationLabel: string;
  initialDateLabel: string;
  initialTimeLabel: string;
  weather: DashboardHeaderWeather | null;
}) {
  const [dateLabel, setDateLabel] = useState(initialDateLabel);
  const [timeLabel, setTimeLabel] = useState(initialTimeLabel);

  useEffect(() => {
    function tick() {
      const now = new Date();
      setDateLabel(formatBusinessDateLong(timeZone, now));
      setTimeLabel(formatBusinessTime(timeZone, now));
    }
    tick(); // resync immediately in case a minute already ticked over between the server render and this mount
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [timeZone]);

  const WeatherIcon = weather ? (WEATHER_ICONS[weather.condition] ?? Cloud) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{dateLabel}</span>
      <span aria-hidden>·</span>
      <span>{timeLabel}</span>
      <span aria-hidden>·</span>
      <span>{locationLabel}</span>
      {weather ? (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            {WeatherIcon ? <WeatherIcon className="h-3.5 w-3.5" aria-hidden /> : null}
            {weather.temperatureC}°C · {weather.condition}
          </span>
        </>
      ) : null}
    </div>
  );
}
