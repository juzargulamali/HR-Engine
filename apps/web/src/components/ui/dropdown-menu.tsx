"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal click-to-toggle menu — closes on outside click or Escape. Always
 * mounted (visibility toggled via opacity/scale) so the 150ms transition
 * can play in both directions without an animation library.
 */
export function DropdownMenu({
  trigger,
  children,
  align = "end",
  side = "bottom",
  keyboardNav = false,
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => React.ReactNode;
  /** Either the content, or a function that receives `close` (so an item can shut the menu after it is chosen). */
  children: React.ReactNode | ((api: { close: () => void }) => React.ReactNode);
  align?: "start" | "end";
  side?: "top" | "bottom";
  /** Arrow keys / Home / End move between `[role="menuitem"]` children and the first one is focused on opening. Off by default. */
  keyboardNav?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Where the list really goes. It starts where the page asked for it and is nudged on opening so that it never runs outside the
  // screen or outside the panel or table it sits in (which would cut it off).
  const [place, setPlace] = useState<{ x: number; flipUp: boolean }>({ x: 0, flipUp: false });

  // The list is always in the page (only hidden), so it can be measured just before it is shown.
  const toggle = () => setOpen((v) => !v);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !keyboardNav) return;
    const first = ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [open, keyboardNav]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (!keyboardNav) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    if (items.length === 0) return;
    const i = items.findIndex((el) => el === document.activeElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      items[next]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div
      ref={ref}
      className="relative"
      // Measured just before the list is shown (it is always in the page, only hidden), from the press that opens it.
      onClickCapture={() => { if (!open && ref.current && menuRef.current) setPlace(placeMenu(ref.current, menuRef.current, align, side)); }}
    >
      {trigger({ open, toggle })}
      <div
        role="menu"
        ref={menuRef}
        style={place.x !== 0 ? (align === "end" ? { right: -place.x } : { left: place.x }) : undefined}
        onKeyDown={onMenuKey}
        inert={!open}
        className={cn(
          "absolute z-50 min-w-[15rem] rounded-lg border border-border bg-raised p-1.5 shadow-[var(--shadow-pop)] transition-all duration-150",
          (side === "bottom") !== place.flipUp ? "top-full mt-2" : "bottom-full mb-2",
          align === "end" ? "right-0" : "left-0",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
      >
        {typeof children === "function" ? children({ close: () => setOpen(false) }) : children}
      </div>
    </div>
  );
}


/** The nearest ancestor that clips what sticks out of it (a side panel, a scrolling table), or null for the page itself. */
function clippingAncestor(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (/(auto|scroll|hidden|clip)/.test(o.overflowX + o.overflowY)) return p;
  }
  return null;
}

/**
 * Works out how far to move the open list sideways, and whether to open it upwards, so that all of it stays inside the screen and
 * inside the panel or table that holds the button. The list is `min-w-[15rem]` wide and absolutely placed against its button.
 */
export function placeMenu(wrap: HTMLElement, menu: HTMLElement, align: "start" | "end", side: "top" | "bottom"): { x: number; flipUp: boolean } {
  const gap = 8;
  const w = wrap.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const box = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const clip = clippingAncestor(wrap);
  if (clip) {
    const c = clip.getBoundingClientRect();
    box.left = Math.max(box.left, c.left);
    box.right = Math.min(box.right, c.right);
    box.top = Math.max(box.top, c.top);
    box.bottom = Math.min(box.bottom, c.bottom);
  }
  // sideways: where the list would start, and the shift that brings it back inside
  const left = align === "end" ? w.right - width : w.left;
  let x = 0;
  if (left < box.left + gap) x = box.left + gap - left;
  else if (left + width > box.right - gap) x = box.right - gap - (left + width);
  // a list wider than the space: keep its start visible
  if (left + x < box.left + gap) x = box.left + gap - left;
  // up or down: stay where asked unless it does not fit and the other way does
  const below = box.bottom - w.bottom - gap;
  const above = w.top - box.top - gap;
  const fitsBelow = height <= below;
  const fitsAbove = height <= above;
  const flipUp = side === "bottom" ? !fitsBelow && fitsAbove : fitsBelow && !fitsAbove;
  return { x: Math.round(x), flipUp };
}
