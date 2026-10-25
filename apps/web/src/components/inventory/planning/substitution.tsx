import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { substitutionInfo } from "@/lib/inventory/planning";

/**
 * A substitute is never presented as settled before an authorised person accepts it: while it is only proposed the line says so in
 * words, and says what the warehouse keeps preparing in the meantime. Nothing is shown for a line with no substitution.
 */
export function SubstitutionBadge({ status, originalItemName, itemName, note, showDetail = true }: { status: string; originalItemName?: string | null; itemName?: string | null; note?: string | null; showDetail?: boolean }) {
  const info = substitutionInfo({ substitution_status: status, original_item_name: originalItemName, item_name: itemName });
  if (info.state === "none") return null;
  const tone = info.tone === "warn" ? "border-[hsl(var(--os-amber)/0.5)] bg-[hsl(var(--os-amber)/0.1)] text-[hsl(var(--os-amber))]" : info.tone === "good" ? "border-[hsl(var(--os-green)/0.4)] bg-[hsl(var(--os-green)/0.1)] text-[hsl(var(--os-green))]" : "text-muted-foreground";
  return (
    <div className="space-y-1" data-substitution={info.state}>
      <Badge variant="outline" className={cn("whitespace-normal", tone)}>{info.label}</Badge>
      {showDetail && info.detail ? <p className="text-sm text-muted-foreground">{info.detail}</p> : null}
      {showDetail && note ? <p className="text-sm text-muted-foreground">Note: {note}</p> : null}
    </div>
  );
}
