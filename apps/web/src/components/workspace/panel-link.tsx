"use client";

import Link from "next/link";
import { confirmDiscard } from "./unsaved";

/**
 * A link that opens a record in the side panel (or switches to another one). It keeps the scroll position of the list, and it
 * first asks before throwing away unsaved edits in the panel that is already open.
 */
export function PanelLink({ href, children, className, "aria-label": ariaLabel }: { href: string; children: React.ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <Link href={href} scroll={false} aria-label={ariaLabel} className={className} onClick={(e) => { if (!confirmDiscard()) e.preventDefault(); }}>
      {children}
    </Link>
  );
}
