"use client";

import { useEffect, useRef } from "react";

/**
 * A block that a link can land on by its id (for example a notice that opens "the question on this enquiry"). The block may arrive after the page first
 * paints (it is read on the server and streamed in), when the browser has already given up looking for the address's #anchor: so it brings itself into view
 * once, when it appears and the address names it, and takes the keyboard focus so a screen reader starts there.
 */
export function AnchorTarget({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== `#${id}`) return;
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView?.({ block: "center" });
    el.focus?.({ preventScroll: true });
  }, [id]);
  return <div ref={ref} id={id} tabIndex={-1} className={className} data-anchor-target={id}>{children}</div>;
}
