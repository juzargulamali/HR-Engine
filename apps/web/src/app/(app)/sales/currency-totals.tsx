import { currencyLines } from "@/lib/crm/reports";
import { formatMoney } from "@/components/sales/format";
import { cn } from "@/lib/utils";

/**
 * A total shown as one line per currency, never added together. `unvalued` flags opportunities with no value so the
 * figure reads as "at least". Renders `emptyText` (not a zero) when nothing has a value.
 */
export function CurrencyTotals({ totals, unvalued = 0, emptyText = "No value recorded", className }: { totals: Record<string, number>; unvalued?: number; emptyText?: string; className?: string }) {
  const lines = currencyLines(totals);
  if (lines.length === 0) return <span className={cn("text-muted-foreground", className)}>{emptyText}</span>;
  return (
    <ul className={cn("tabular-nums", className)}>
      {lines.map((l) => <li key={l.currency}>{formatMoney(l.amount, l.currency)}</li>)}
      {unvalued > 0 ? <li className="text-sm text-muted-foreground">+ {unvalued} without a value</li> : null}
    </ul>
  );
}
