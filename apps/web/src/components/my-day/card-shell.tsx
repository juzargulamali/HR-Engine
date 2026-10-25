import { cn } from "@/lib/utils";

/** The common frame of a My Day card: a title row (with room for a small action) on the layered OS surface. `tone` tints it warm (needs a decision) or cool (supporting information). */
export function MyDayCard({ title, id, actions, tone, className, children, label }: { title: string; id?: string; actions?: React.ReactNode; tone?: "warm" | "cool"; className?: string; children: React.ReactNode; label?: string }) {
  return (
    <section id={id} aria-label={label ?? title} className={cn("os-card min-w-0 p-4 sm:p-5", tone === "warm" && "os-warm", tone === "cool" && "os-cool", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-2 text-sm">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export const cardLink = "font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
