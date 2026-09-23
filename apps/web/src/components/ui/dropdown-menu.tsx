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
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  side?: "top" | "bottom";
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

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      <div
        role="menu"
        className={cn(
          "absolute z-50 min-w-[15rem] rounded-lg border border-border bg-card p-1.5 shadow-xl transition-all duration-150",
          side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
          align === "end" ? "right-0" : "left-0",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}
