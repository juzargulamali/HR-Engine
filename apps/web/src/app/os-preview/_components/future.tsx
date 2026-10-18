"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Marks a screen as a sample layout for a module that ships later. */
export function FutureBanner() {
  return (
    <div role="note" className="mb-5 flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
      <Info className="h-4 w-4 flex-none text-[hsl(var(--os-link))]" aria-hidden />
      <p><strong>Coming soon</strong> <span className="text-muted-foreground">· sample layout, fictional data</span></p>
    </div>
  );
}

/** A button that looks like the real action but is clearly not wired up in the design. */
export function DesignOnlyButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Button type="button" size="sm" variant="outline" disabled title="Not available yet" className={cn("h-7 text-xs", className)}>{children}</Button>;
}
