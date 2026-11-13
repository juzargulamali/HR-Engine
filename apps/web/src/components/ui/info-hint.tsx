"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The shared ⓘ help control: optional descriptions, calculation rules and longer examples live behind it, beside the heading or label they explain. Keep what a person needs to ACT
 * (a missing prerequisite beside its button), every warning (⚠), validation error, who acts next and the consequence of approving or publishing visible in the page itself.
 *
 * Opens on mouse hover, on keyboard focus and on a tap (touch). Escape, an outside tap or moving focus away closes it. The popover is drawn in a portal at a fixed position taken from
 * the icon, so no card's overflow can clip it and it sits above sticky headers and tabs (z-60) while staying below a native dialog; it is kept inside the viewport (flipped above the
 * icon when there is no room below) and follows the icon while the page scrolls. The existing `Tooltip` is a one-line CSS label that a card's edge would clip, and the rail popover is
 * anchored to the sidebar, so neither can carry a paragraph here.
 */
const GAP = 8;
const MARGIN = 8;
const WIDTH = 320;

type Pointer = "mouse" | "touch" | "key";

/** The icon's accessible name is the same everywhere ("More information"): it sits right after the label it explains, and a name that repeated the label would match every label search for the field itself. Find one by its test id. */
export const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function place(pop: HTMLElement | null, anchor: HTMLElement | null) {
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(WIDTH, window.innerWidth - MARGIN * 2);
  pop.style.width = `${w}px`;
  const h = pop.getBoundingClientRect().height;
  const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, MARGIN), Math.max(MARGIN, window.innerWidth - w - MARGIN));
  const below = r.bottom + GAP;
  const top = below + h <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, r.top - GAP - h);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

export function InfoHint({ label, children, className, testId }: { label: string; children: React.ReactNode; className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<Pointer>("mouse");
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const show = useCallback(() => { clear(); setOpen(true); }, []);
  const hide = useCallback((delay = 140) => { clear(); timer.current = setTimeout(() => setOpen(false), delay); }, []);
  const close = useCallback(() => { clear(); setOpen(false); }, []);
  useEffect(() => clear, []);
  const setPop = useCallback((el: HTMLDivElement | null) => { pop.current = el; place(el, anchor.current); }, []);

  // Follow the icon while open; close on Escape or on a press outside the icon and the popover.
  useEffect(() => {
    if (!open) return undefined;
    const update = () => place(pop.current, anchor.current);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); anchor.current?.focus(); } };
    const onDown = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (anchor.current?.contains(t) || pop.current?.contains(t))) return;
      close();
    };
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    document.addEventListener("keydown", onKey); document.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open, close]);

  return (
    <span className={cn("inline-flex align-middle", className)}>
      <button
        ref={anchor} type="button" data-testid={testId ?? `info-hint-${slug(label)}`} data-help-for={label} aria-label="More information" aria-expanded={open} aria-describedby={open ? id : undefined}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(e) => { last.current = e.pointerType === "touch" || e.pointerType === "pen" ? "touch" : "mouse"; }}
        onKeyDown={() => { last.current = "key"; }}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") show(); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(); }}
        // Keyboard focus opens it; the focus that a tap causes does not (the tap's own click decides, so a tap never opens and closes in one go).
        onFocus={() => { if (last.current !== "touch") show(); }}
        onBlur={(e) => { if (!pop.current?.contains(e.relatedTarget as Node | null)) hide(60); }}
        onClick={() => { if (last.current === "touch") setOpen((o) => !o); else show(); }}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={setPop} id={id} role="tooltip" data-testid="info-hint-popover"
          className="fixed z-[60] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-3 text-left text-[13px] font-normal normal-case leading-snug tracking-normal text-foreground shadow-lg"
          onPointerEnter={show} onPointerLeave={() => hide()}
        >
          {children}
        </div>, document.body) : null}
    </span>
  );
}
