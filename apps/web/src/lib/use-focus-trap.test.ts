import { describe, expect, it } from "vitest";
import { wrapFocusTarget } from "./use-focus-trap";

// Pure decision logic only — useFocusTrap() itself needs a real DOM
// (document.activeElement, .focus(), MutationObserver-free event
// listeners) to exercise end to end, and this repo's web unit tests run in
// plain Node with no jsdom/browser environment installed. wrapFocusTarget()
// is deliberately factored out so the one part of the hook that's easy to
// get backwards (which end wraps to which, and only on the boundary
// elements) can still be verified without one.
describe("wrapFocusTarget", () => {
  it("wraps from the first element to the last on Shift+Tab", () => {
    expect(wrapFocusTarget(true, true, false)).toBe("last");
  });

  it("wraps from the last element to the first on Tab", () => {
    expect(wrapFocusTarget(false, false, true)).toBe("first");
  });

  it("does nothing on Tab from the first element (not yet at the end)", () => {
    expect(wrapFocusTarget(false, true, false)).toBeNull();
  });

  it("does nothing on Shift+Tab from the last element (not yet at the start)", () => {
    expect(wrapFocusTarget(true, false, true)).toBeNull();
  });

  it("does nothing for an element that is neither the first nor the last", () => {
    expect(wrapFocusTarget(false, false, false)).toBeNull();
    expect(wrapFocusTarget(true, false, false)).toBeNull();
  });

  it("prefers wrapping to last when a single focusable element is both first and last, on Shift+Tab", () => {
    // A dialog with exactly one focusable control: isOnFirst and isOnLast
    // are both true for it. Shift+Tab should still wrap (to itself), not
    // fall through to the Tab branch.
    expect(wrapFocusTarget(true, true, true)).toBe("last");
  });

  it("wraps to first when a single focusable element is both first and last, on Tab", () => {
    expect(wrapFocusTarget(false, true, true)).toBe("first");
  });
});
