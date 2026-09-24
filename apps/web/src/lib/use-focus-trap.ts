"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Pure decision logic for wrapping Tab focus at the ends of a focusable
 * list — kept separate from the DOM-querying/`.focus()`-calling code below
 * so it can be unit tested without a DOM (this repo's web unit tests run in
 * plain Node, with no jsdom/browser environment installed).
 */
export function wrapFocusTarget(shiftKey: boolean, isOnFirst: boolean, isOnLast: boolean): "first" | "last" | null {
  if (shiftKey && isOnFirst) return "last";
  if (!shiftKey && isOnLast) return "first";
  return null;
}

/**
 * Traps Tab/Shift+Tab cycling within `containerRef` while `active` is true,
 * and restores focus to whatever was focused before it activated once it
 * deactivates — the two behaviors a `role="dialog" aria-modal="true"`
 * surface (the mobile nav drawer, the command palette) actually needs to
 * behave modally for keyboard users, not just claim to via ARIA. Without
 * this, Tab still cycles into the page underneath, which the rest of the
 * app is supposed to be inert to while the dialog is open.
 *
 * No third-party dependency — just enough to cover the two dialogs this
 * app actually has.
 *
 * This only covers the OPEN state. Both dialogs stay mounted while closed
 * (so their close transition can play), so the consuming component is also
 * responsible for marking the container `inert` while closed — otherwise
 * Tab can still reach the closed dialog's links/buttons/inputs, since
 * `aria-hidden`, `opacity-0`, and `pointer-events-none` none of them remove
 * an element from the keyboard tab sequence.
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const wrapTo = wrapFocusTarget(e.shiftKey, document.activeElement === first, document.activeElement === last);
      if (wrapTo === "first") {
        e.preventDefault();
        first.focus();
      } else if (wrapTo === "last") {
        e.preventDefault();
        last.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [active, containerRef]);
}
