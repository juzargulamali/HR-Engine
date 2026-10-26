import { cn } from "@/lib/utils";
import { listTable } from "@/components/workspace/list-table";
import { Boxes, CalendarClock, TriangleAlert } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { OsStatCard } from "@/components/os/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/workspace/states";
import { formatDate } from "@/components/sales/format";
import { getInventoryContext } from "@/lib/inventory/context";
import { BALANCE_CONDITION_WORDS, CONDITION_WORDS, formatQty } from "@/lib/inventory/words";
import { createClient } from "@/lib/supabase/server";
import type { InvBalanceCondition, InvCondition, InvMyEquipmentRow } from "@/types/inventory";

export const metadata = { title: "My equipment" };

const conditionText = (c: string) => CONDITION_WORDS[c as InvCondition] ?? BALANCE_CONDITION_WORDS[c as InvBalanceCondition] ?? c;

/**
 * Equipment assigned to the signed-in employee, from inv_my_equipment: what it is, its readable ID and serial number, since when, when
 * it is expected back, its condition, and a flag when it is overdue. Nothing else: no prices, no other people, no history.
 */
export default async function MyEquipmentPage() {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const db = await createClient();
  const { data, error } = await db.rpc("inv_my_equipment");
  if (error) {
    console.error("[inventory] my equipment load failed", error.message);
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Equipment assigned to me</h1>
        <LoadError what="your equipment" retryHref="/inventory/mine" />
      </div>
    );
  }
  const rows: InvMyEquipmentRow[] = data ?? [];
  const overdue = rows.filter((r) => r.is_overdue).length;
  // The earliest return date among what is not yet overdue (an overdue item is counted on its own card).
  const nextDue = rows.filter((r) => !r.is_overdue && r.expected_return_at).map((r) => r.expected_return_at as string).sort()[0] ?? null;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Equipment assigned to me</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Company equipment recorded as assigned to you. If something here is wrong, or has been lost or damaged, tell the warehouse.</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing is assigned to you" description="When the warehouse issues you equipment it appears here with its ID and the date it is expected back." />
      ) : (
        <>
          <p className="sr-only" role="status">
            {rows.length} {rows.length === 1 ? "item" : "items"}{overdue > 0 ? `, ${overdue} overdue` : ""}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <OsStatCard label={rows.length === 1 ? "Item assigned to me" : "Items assigned to me"} value={rows.length} icon={Boxes} />
            <OsStatCard label="Overdue" value={overdue} icon={TriangleAlert} edge={overdue > 0 ? "amber" : "muted"} hint={overdue > 0 ? "Past the date it was due back" : "Nothing is late"} />
            <OsStatCard label="Next due back" value={nextDue ? formatDate(nextDue) : "No date"} icon={CalendarClock} edge="blue" hint={nextDue ? undefined : "No return date is set"} />
          </div>
          <Table className={cn("min-w-[40rem]", listTable)}>
            <caption className="sr-only">Equipment assigned to me</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Item</TableHead>
                <TableHead scope="col">ID</TableHead>
                <TableHead scope="col">Serial number</TableHead>
                <TableHead scope="col">Since</TableHead>
                <TableHead scope="col">Expected back</TableHead>
                <TableHead scope="col">Condition</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.unit_id ?? r.balance_id}`} className="align-top">
                  <TableCell className="min-w-[10rem] break-words font-medium">
                    {r.item_name}
                    {r.kind === "quantity" ? <span className="block text-sm font-normal text-muted-foreground">Quantity: {formatQty(r.qty, r.unit_of_measure)}</span> : null}
                  </TableCell>
                  <TableCell data-label="ID" className="whitespace-nowrap font-mono">{r.code ?? <span className="font-sans text-muted-foreground">Counted stock</span>}</TableCell>
                  <TableCell data-label="Serial number" className="break-all">{r.serial_number ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell data-label="Since" className="whitespace-nowrap">{formatDate(r.issued_at)}</TableCell>
                  <TableCell data-label="Expected back" className="whitespace-nowrap">
                    {r.expected_return_at ? formatDate(r.expected_return_at) : <span className="text-muted-foreground">No date set</span>}
                    {r.is_overdue ? <OsBadge tone="amber" dot className="ml-2">Overdue</OsBadge> : null}
                  </TableCell>
                  <TableCell data-label="Condition">{conditionText(r.condition)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
