/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ClockChip } from "./clock-chip";

afterEach(() => { cleanup(); refresh.mockClear(); });
const NOW = "2026-11-03T10:00:00Z";

describe("Header clock badge", () => {
  it("no open session reads 'Not clocked in'", () => {
    render(<ClockChip openSince={null} serverNowIso={NOW} />);
    expect(screen.getByText("Not clocked in")).toBeTruthy();
  });
  it("an open session reads 'Clocked in'", () => {
    render(<ClockChip openSince="2026-11-03T08:30:00Z" serverNowIso={NOW} />);
    expect(screen.getByText(/Clocked in · 1h 30m/)).toBeTruthy();
  });
  it("a failed read says the status is unknown, never 'Not clocked in', and offers a retry", () => {
    render(<ClockChip openSince={null} unknown serverNowIso={NOW} />);
    expect(screen.getByText("Clock status unknown")).toBeTruthy();
    expect(screen.queryByText("Not clocked in")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try loading the clock status again/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
