"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MODULES } from "../_lib/modules";
import { PLink, usePreview } from "./context";
import { PermissionDenied } from "./ui";

/** Sales is not visible to every employee. In the real release the database enforces this; here the guard draws the denied state. */
export function SalesGuard({ children }: { children: React.ReactNode }) {
  const { roleDef } = usePreview();
  const pathname = usePathname();
  const sales = MODULES.find((m) => m.id === "sales")!;
  if (!roleDef.salesAccess) {
    return (
      <PermissionDenied
        what="Sales & CRM"
        who={`As ${roleDef.short}, you have not been granted Sales access. Being a manager, HR, Finance or an administrator does not grant it either.`}
      />
    );
  }
  return (
    <>
      <nav aria-label="Sales sections" className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-border px-4 pb-2 sm:-mx-6 sm:px-6 lg:hidden">
        {sales.sub!.map((s) => {
          const active = s.href === sales.href ? pathname === s.href : pathname.startsWith(s.href);
          return (
            <PLink
              key={s.href} href={s.href} aria-current={active ? "page" : undefined}
              className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-accent/60 bg-accent/10 text-foreground" : "border-border text-muted-foreground")}
            >
              {s.label}
            </PLink>
          );
        })}
      </nav>
      {children}
    </>
  );
}
