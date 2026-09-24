/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// weather.ts is marked "server-only" so an accidental Client Component
// import fails at build time — vitest's Node environment isn't a Next.js
// build, so it throws on the bare import unless stubbed out here (same
// pattern as the leave-accrual cron route test).
vi.mock("server-only", () => ({}));

const { getCurrentWeather } = await import("./weather");

const DUBAI = { latitude: 25.2048, longitude: 55.2708 };

describe("getCurrentWeather", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the rounded temperature and a short condition label on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 31.4, weather_code: 0 } }),
    }) as unknown as typeof fetch;

    const result = await getCurrentWeather(DUBAI.latitude, DUBAI.longitude);

    expect(result).toEqual({ temperatureC: 31, condition: "Clear" });
  });

  it("maps a range of WMO codes to their short condition labels", async () => {
    const cases: [number, string][] = [
      [1, "Partly cloudy"],
      [3, "Cloudy"],
      [45, "Fog"],
      [61, "Rain"],
      [73, "Snow"],
      [80, "Showers"],
      [95, "Storm"],
    ];
    for (const [code, expected] of cases) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ current: { temperature_2m: 20, weather_code: code } }),
      }) as unknown as typeof fetch;
      const result = await getCurrentWeather(DUBAI.latitude, DUBAI.longitude);
      expect(result?.condition).toBe(expected);
    }
  });

  it("requests Next's fetch cache with a 30-60 minute revalidate window", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 20, weather_code: 0 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await getCurrentWeather(DUBAI.latitude, DUBAI.longitude);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("api.open-meteo.com");
    expect(String(url)).toContain(`latitude=${DUBAI.latitude}`);
    expect(String(url)).toContain(`longitude=${DUBAI.longitude}`);
    const revalidate = (init as { next?: { revalidate?: number } }).next?.revalidate;
    expect(revalidate).toBeGreaterThanOrEqual(30 * 60);
    expect(revalidate).toBeLessThanOrEqual(60 * 60);
  });

  it("never sends any API key, token, or Authorization header — Open-Meteo is keyless", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 20, weather_code: 0 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await getCurrentWeather(DUBAI.latitude, DUBAI.longitude);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toMatch(/key|token|secret/i);
    const headers = (init as { headers?: Record<string, string> } | undefined)?.headers ?? {};
    expect(Object.keys(headers).some((h) => /auth|key|token/i.test(h))).toBe(false);
  });

  it("resolves to null (never throws) when the upstream response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;

    const result = await getCurrentWeather(DUBAI.latitude, DUBAI.longitude);

    expect(result).toBeNull();
  });

  it("resolves to null (never throws) on a malformed/unexpected response body", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ current: {} }) }) as unknown as typeof fetch;

    const result = await getCurrentWeather(DUBAI.latitude, DUBAI.longitude);

    expect(result).toBeNull();
  });

  it("resolves to null (never throws) when fetch itself rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const result = await getCurrentWeather(DUBAI.latitude, DUBAI.longitude);

    expect(result).toBeNull();
  });

  it("resolves to null (never throws or hangs) when the upstream never responds within the timeout", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const promise = getCurrentWeather(DUBAI.latitude, DUBAI.longitude);
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(result).toBeNull();
    vi.useRealTimers();
  });
});
