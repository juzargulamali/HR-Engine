/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QrScanner } from "./qr-scanner";
import type { ScanDeps } from "./scan-engine";

// A simulated camera: these tests prove the scanner's behaviour, NOT that a real phone camera reads a real label.
function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => cleanup());

describe("QrScanner", () => {
  it("does not touch the camera until the person presses the button", () => {
    const getUserMedia = vi.fn();
    render(<QrScanner onRead={() => undefined} deps={{ isSecureContext: true, mediaDevices: { getUserMedia } }} />);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /use the camera/i })).toBeTruthy();
  });

  it("says plainly when the camera is blocked, and typing a code still works", async () => {
    const onRead = vi.fn();
    const denied = Object.assign(new Error("no"), { name: "NotAllowedError" });
    render(<QrScanner onRead={onRead} deps={{ isSecureContext: true, mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(denied) } }} />);
    fireEvent.click(screen.getByRole("button", { name: /use the camera/i }));
    expect(await screen.findByText(/camera is blocked/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/type the code/i), { target: { value: "uae-e-00042" } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));
    expect(onRead).toHaveBeenCalledWith("uae-e-00042");
  });

  it("says plainly when there is no camera, when the browser cannot use one, and when it fails to start", async () => {
    const cases: [ScanDeps, RegExp][] = [
      [{ isSecureContext: true, mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error(), { name: "NotFoundError" })) } }, /no camera was found/i],
      [{ isSecureContext: false, mediaDevices: { getUserMedia: vi.fn() } }, /cannot use the camera/i],
      [{ isSecureContext: true }, /cannot use the camera/i],
      [{ isSecureContext: true, mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error("boom")) } }, /could not be started/i],
    ];
    for (const [deps, message] of cases) {
      const { unmount } = render(<QrScanner onRead={() => undefined} deps={deps} />);
      fireEvent.click(screen.getByRole("button", { name: /use the camera/i }));
      expect(await screen.findByText(message)).toBeTruthy();
      expect(screen.getByLabelText(/type the code/i)).toBeTruthy();
      unmount();
    }
  });

  it("reports what it read, once for a code held in front of the camera, and releases the camera when stopped", async () => {
    const { stream, stop } = fakeStream();
    const onRead = vi.fn();
    const frames = ["UAE-E-00042", "UAE-E-00042", null, "UAE-E-00042"];
    let i = 0;
    const decode = vi.fn(() => frames[Math.min(i++, frames.length - 1)] ?? null);
    render(<QrScanner onRead={onRead} deps={{ isSecureContext: true, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) }, decode }} />);
    fireEvent.click(screen.getByRole("button", { name: /use the camera/i }));
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1), { timeout: 2000 });
    await waitFor(() => expect(decode.mock.calls.length).toBeGreaterThan(3), { timeout: 2000 });
    expect(onRead).toHaveBeenCalledTimes(1); // repeated reads of the same label are one scan
    expect(onRead).toHaveBeenCalledWith("UAE-E-00042");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /stop camera/i })); });
    expect(stop).toHaveBeenCalled();
  });

  it("releases the camera when the scanner is removed from the page", async () => {
    const { stream, stop } = fakeStream();
    const { unmount } = render(<QrScanner onRead={() => undefined} deps={{ isSecureContext: true, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) }, decode: () => null }} />);
    fireEvent.click(screen.getByRole("button", { name: /use the camera/i }));
    await screen.findByRole("button", { name: /stop camera/i });
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("releases the camera when the tab is hidden or the page is left", async () => {
    const { stream, stop } = fakeStream();
    render(<QrScanner onRead={() => undefined} deps={{ isSecureContext: true, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) }, decode: () => null }} />);
    fireEvent.click(screen.getByRole("button", { name: /use the camera/i }));
    await screen.findByRole("button", { name: /stop camera/i });
    window.dispatchEvent(new Event("pagehide"));
    expect(stop).toHaveBeenCalled();
  });
});
