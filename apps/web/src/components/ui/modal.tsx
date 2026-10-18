"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

/**
 * Accessible modal built on the native <dialog> element (focus trapping, Escape to close and inertness of the page
 * behind are handled by the browser). Rendered only while `open`, so its form state resets each time it is opened.
 */
export function Modal({ open, onClose, title, description, children, size = "default" }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; size?: "default" | "wide" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className={`m-auto rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50 ${size === "wide" ? "w-[min(44rem,calc(100vw-2rem))]" : "w-[min(32rem,calc(100vw-2rem))]"}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 id={titleId} className="font-heading text-base font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}
