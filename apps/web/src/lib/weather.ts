import "server-only";

export interface WeatherSnapshot {
  temperatureC: number;
  condition: string;
}

const FETCH_TIMEOUT_MS = 3000;
const REVALIDATE_SECONDS = 45 * 60; // 45 minutes — inside the requested 30-60 minute cache window

// A small subset of Open-Meteo's WMO weather-code table, collapsed to the
// short, simple labels the dashboard header actually needs — not the full
// forecast detail.
function conditionFromCode(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Storm";
  return "—";
}

/**
 * Current conditions from Open-Meteo (https://open-meteo.com) — free,
 * keyless, no account or API token required, so there is nothing secret to
 * ever leak into a client bundle and nothing stored in Supabase. Cached via
 * Next's own fetch cache (`next.revalidate`) for 45 minutes per coordinate
 * pair, and bounded by a short AbortController timeout, so a slow or
 * unreachable upstream can never delay or break the dashboard: ANY failure
 * (timeout, non-2xx, a malformed/unexpected body) resolves to `null` rather
 * than throwing — the caller is expected to simply omit the weather display
 * in that case, never block on it or show a broken figure.
 */
export async function getCurrentWeather(latitude: number, longitude: number): Promise<WeatherSnapshot | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`;
    const res = await fetch(url, { signal: controller.signal, next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    const json = (await res.json()) as { current?: { temperature_2m?: unknown; weather_code?: unknown } };
    const temperature = json.current?.temperature_2m;
    const code = json.current?.weather_code;
    if (typeof temperature !== "number" || typeof code !== "number") return null;
    return { temperatureC: Math.round(temperature), condition: conditionFromCode(code) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
