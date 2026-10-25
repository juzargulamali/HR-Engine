"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** A supporting card: folded under its title on a phone and a narrow window, open on a wide screen where there is room. */
export function OsCollapsible({ title, icon, label, className, children }: { title: string; icon?: React.ReactNode; label: string; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={label} className={cn("os-card", className)}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-[14px] p-4 text-left font-heading text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:hidden">
        {icon}<span className="flex-1">{title}</span><ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div className={cn(open ? "block" : "hidden", "px-4 pb-4 xl:block xl:p-4")}>{children}</div>
    </section>
  );
}
