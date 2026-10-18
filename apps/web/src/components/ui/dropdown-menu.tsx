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
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      <div
        role="menu"
        onKeyDown={onMenuKey}
        inert={!open}
        className={cn(
          "absolute z-50 min-w-[15rem] rounded-lg border border-border bg-raised p-1.5 shadow-[var(--shadow-pop)] transition-all duration-150",
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
          align === "end" ? "right-0" : "left-0",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
      >
        {typeof children === "function" ? children({ close: () => setOpen(false) }) : children}
      </div>
    </div>
  );
}
