/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfoHint } from "@/components/ui/info-hint";

const ui = () => render(<div><h3>Planning dates <InfoHint label="planning dates">Longer rule about planning dates.</InfoHint></h3><button type="button">elsewhere</button></div>);
const icon = () => screen.getByTestId("info-hint-planning-dates");
const popover = () => screen.queryByRole("tooltip");

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("InfoHint", () => {
  it("is closed until asked, and has an accessible name", () => {
    ui();
    expect(icon().getAttribute("aria-expanded")).toBe("false");
    expect(popover()).toBeNull();
  });
  it("opens on mouse hover and closes shortly after the pointer leaves", () => {
    ui();
    fireEvent.pointerEnter(icon(), { pointerType: "mouse" });
    expect(popover()!.textContent).toContain("Longer rule about planning dates.");
    expect(icon().getAttribute("aria-describedby")).toBe(popover()!.id);
    fireEvent.pointerLeave(icon(), { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(300); });
    expect(popover()).toBeNull();
  });
  it("stays open while the pointer is over the popover", () => {
    ui();
    fireEvent.pointerEnter(icon(), { pointerType: "mouse" });
    fireEvent.pointerLeave(icon(), { pointerType: "mouse" });
    fireEvent.pointerEnter(popover()!, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(300); });
    expect(popover()).not.toBeNull();
  });
  it("opens on keyboard focus, closes on Escape and returns focus to the icon", () => {
    ui();
    fireEvent.keyDown(icon(), { key: "Tab" });
    act(() => { icon().focus(); });
    expect(popover()).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(icon());
  });
  it("closes when focus moves away", () => {
    ui();
    fireEvent.keyDown(icon(), { key: "Tab" });
    act(() => { icon().focus(); });
    act(() => { screen.getByRole("button", { name: "elsewhere" }).focus(); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(popover()).toBeNull();
  });
  it("opens on a tap and a second tap closes it; the focus a tap causes does not open it by itself", () => {
    ui();
    fireEvent.pointerDown(icon(), { pointerType: "touch" });
    act(() => { icon().focus(); });
    expect(popover()).toBeNull();
    fireEvent.click(icon());
    expect(popover()).not.toBeNull();
    fireEvent.pointerDown(icon(), { pointerType: "touch" });
    fireEvent.click(icon());
    expect(popover()).toBeNull();
  });
  it("a tap anywhere else closes it", () => {
    ui();
    fireEvent.pointerDown(icon(), { pointerType: "touch" });
    fireEvent.click(icon());
    expect(popover()).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }), { pointerType: "touch" });
    expect(popover()).toBeNull();
  });
  it("is drawn in the page body, not inside the card, so a card's edge cannot clip it", () => {
    const { container } = ui();
    fireEvent.pointerEnter(icon(), { pointerType: "mouse" });
    expect(container.contains(popover())).toBe(false);
    expect(document.body.contains(popover())).toBe(true);
  });
});
