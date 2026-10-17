"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Marks a screen as a representative design for a module that ships later. */
export function FutureBanner({ release }: { release: string }) {
  return (
    <div role="note" className="mb-6 flex items-start gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm">
      <Info className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--os-link))]" aria-hidden />
      <p><strong>Coming soon in the real release ({release}).</strong> This is a representative design with fictional sample data. In the real app this module shows a plain “Coming soon” page with no actions.</p>
    </div>
  );
}

/** A button that looks like the real action but is clearly not wired up in the design. */
export function DesignOnlyButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Button type="button" size="sm" variant="outline" disabled title="Design only: not wired up" className={cn("h-7 text-xs", className)}>{children}</Button>;
}
