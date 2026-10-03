/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ClockStatus } from "./clock-status";

afterEach(cleanup);

describe("ClockStatus", () => {
  it.each([
    ["clocked_in", "Clocked in"],
    ["clocked_out", "Clocked out"],
    ["not_started", "Not started"],
  ] as const)("%s is always shown with its own text, never as a colour alone", (status, label) => {
    const { container } = render(<ClockStatus status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
    // the coloured dot is decoration only
    const dot = container.querySelector("span[aria-hidden]");
    expect(dot).toBeTruthy();
    expect(container.querySelector(`[data-clock-status="${status}"]`)).toBeTruthy();
  });

  it("never uses Online/Offline wording (this is a clock state, not connectivity)", () => {
    for (const status of ["clocked_in", "clocked_out", "not_started"] as const) {
      const { container, unmount } = render(<ClockStatus status={status} />);
      expect(container.textContent).not.toMatch(/online|offline/i);
      unmount();
    }
  });
});
