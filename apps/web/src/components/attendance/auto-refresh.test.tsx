/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AutoRefresh } from "./auto-refresh";

const NOW = new Date("2027-01-12T10:00:30.000Z"); // 14:00:30 in Dubai

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  refresh.mockClear();
  setOnline(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AutoRefresh", () => {
  it("shows when the data was last updated, in the given (employee) time zone, and that it is live", () => {
    render(<AutoRefresh generatedAt="2027-01-12T10:00:00.000Z" timeZone="Asia/Dubai" intervalSeconds={30} />);
    expect(screen.getByText("Last updated 14:00:00")).toBeTruthy();
    expect(screen.getByText(/Live · refreshes every 30s/)).toBeTruthy();
  });

  it("polls (an authenticated router refresh) on the interval while the tab is visible", () => {
    render(<AutoRefresh generatedAt="2027-01-12T10:00:00.000Z" timeZone="Asia/Dubai" intervalSeconds={30} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("does not poll while the tab is hidden, and refreshes at once when it becomes visible", () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    render(<AutoRefresh generatedAt="2027-01-12T10:00:00.000Z" timeZone="Asia/Dubai" intervalSeconds={30} />);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(refresh).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("turns Stale when the server timestamp stops advancing, instead of presenting old numbers as live", () => {
    render(<AutoRefresh generatedAt="2027-01-12T10:00:00.000Z" timeZone="Asia/Dubai" intervalSeconds={30} />);
    expect(screen.queryByText(/Stale/)).toBeNull();
    // refreshes keep being requested but the data never gets newer (the server is failing / network is bad)
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.getByText(/Stale — refreshing/)).toBeTruthy();
    expect(screen.queryByText(/Live ·/)).toBeNull();
  });

  it("says Disconnected while the browser is offline, and refreshes again when it reconnects", () => {
    render(<AutoRefresh generatedAt="2027-01-12T10:00:00.000Z" timeZone="Asia/Dubai" intervalSeconds={30} />);
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText(/Disconnected/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(refresh).not.toHaveBeenCalled(); // no futile polling while offline
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
