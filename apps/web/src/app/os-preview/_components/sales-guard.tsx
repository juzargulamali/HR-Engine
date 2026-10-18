"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MODULES } from "../_lib/modules";
import { PLink, usePreview } from "./context";
import { PermissionDenied, ScrollRow } from "./ui";

/** Sales is not visible to every employee; this draws the no-access state. */
export function SalesGuard({ children }: { children: React.ReactNode }) {
  const { roleDef } = usePreview();
  const pathname = usePathname();
  const sales = MODULES.find((m) => m.id === "sales")!;
  if (!roleDef.salesAccess) {
    return (
      <PermissionDenied
        what="Sales & CRM"
        who={`Sales access has not been given to your account. HR, Finance or administrator status does not grant it.`}
      />
    );
  }
  return (
    <>
      <nav aria-label="Sales sections" className="mb-5 border-b border-border pb-2 lg:hidden">
        <ScrollRow label="Sales sections">
          {sales.sub!.map((s) => {
            const active = s.href === sales.href ? pathname === s.href : pathname.startsWith(s.href);
            return (
              <PLink
                key={s.href} href={s.href} aria-current={active ? "page" : undefined}
                className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-accent/60 bg-accent/10 font-semibold text-foreground" : "border-border font-medium text-muted-foreground")}
              >
                {s.label}
              </PLink>
            );
          })}
        </ScrollRow>
      </nav>
      {children}
    </>
  );
}
