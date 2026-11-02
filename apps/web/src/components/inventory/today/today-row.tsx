import Link from "next/link";
import { ArrowLeftRight, ClipboardList, Hourglass, PackageCheck, SearchCheck, Send, Undo2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { RecordCheckButton } from "@/components/inventory/planning/record-check-button";
import type { QueueKind, QueueRow } from "@/lib/inventory/today";
import { cn } from "@/lib/utils";

const ICON: Record<QueueKind, React.ComponentType<{ className?: string }>> = { prepare: ClipboardList, send: Send, returns: Undo2, transfer: ArrowLeftRight, sales: PackageCheck, waiting: Hourglass, held: SearchCheck };

/**
 * One job. Its title is a real link stretched over the whole row (so the empty part of the row opens the record, and keyboard and "open in a
 * new tab" work); the button sits above it and does its own job. A Sales check has no page of its own: its button opens the existing check
 * dialog. The button is left out when it would change stock and the person may not operate stock (the database checks every movement anyway).
 */
export function TodayRow({ row, canOperate, checkLocations }: { row: QueueRow; canOperate: boolean; checkLocations: { id: string; name: string; companyId: string }[] }) {
  const Icon = ICON[row.kind];
  const titleCls = "font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:underline";
  const showButton = !row.operates || canOperate;
  return (
    <li className="group relative grid gap-3 px-4 py-3.5 transition-colors focus-within:bg-secondary/40 hover:bg-secondary/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-kind={row.kind}>
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md", row.late ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground")}><Icon className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0">
          {row.href ? <Link href={row.href} className={cn(titleCls, "break-words")}>{row.title}</Link> : <p className="break-words font-medium">{row.title}</p>}
          <p className="break-words text-sm text-muted-foreground">{row.forWhom}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className={cn(row.late && "font-medium text-destructive")}>{row.whenLabel}</span>
            {row.facts.map((f) => <span key={f.text} className={cn("break-words text-muted-foreground", f.tone === "warn" && "font-medium text-[hsl(var(--os-amber))]", f.tone === "bad" && "font-medium text-destructive")}>{f.text}</span>)}
          </p>
          {row.responsible ? <p className="mt-1 break-words text-sm"><span className="font-medium">Who acts:</span> <span className="text-muted-foreground">{row.responsible}</span></p> : null}
          {row.next ? <p className="break-words text-sm"><span className="font-medium">Next:</span> <span className="text-muted-foreground">{row.next}</span></p> : null}
        </div>
      </div>
      <div className={cn("relative z-10 sm:justify-self-end", row.check && "[&>button]:h-11 [&>button]:w-full sm:[&>button]:h-8 sm:[&>button]:w-auto")}>
        {row.check ? (
          <RecordCheckButton
            opportunityId={row.check.opportunityId}
            reference={row.check.reference}
            locations={checkLocations.filter((l) => l.companyId === row.check!.companyId).map((l) => ({ id: l.id, name: l.name }))}
            defaultLocationId={row.check.locationId}
            label="Check availability"
          />
        ) : showButton && row.href ? (
          <Link href={row.href} className={cn(buttonVariants({ size: "sm" }), "h-11 w-full sm:h-9 sm:w-auto")}>{row.actionLabel}<span className="sr-only">{`: ${row.title}`}</span></Link>
        ) : null}
      </div>
    </li>
  );
}
