import Link from "next/link";
import { hasInvCapability } from "@enginious-hr/domain";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/components/sales/format";
import { getInventoryContext } from "@/lib/inventory/context";
import { groupOutstanding, type OutstandingLike } from "@/lib/inventory/planning";
import { BALANCE_CONDITION_WORDS, CONDITION_WORDS } from "@/lib/inventory/words";
import { createClient } from "@/lib/supabase/server";
import type { InvBalanceCondition, InvCondition } from "@/types/inventory";

/**
 * On an employee's Assets tab: the equipment Inventory records as held by that person, read-only, under the earlier HR asset
 * register. Shown only to people who may see it (employee-custody access, warehouse operators, Inventory founders in the employee's
 * company); nothing for everyone else, and nothing at all (never an error) if Inventory is not installed or cannot be read. It shows
 * the item, its ID and dates only: no costs, no pay, no personal data. Issuing and returning stay in Inventory.
 */
async function mayShow(companyId: string): Promise<boolean> {
  try {
    const ctx = await getInventoryContext();
    if (!ctx || !ctx.installed || ctx.loadFailed) return false;
    return hasInvCapability(ctx.grants, companyId, "view_employee_custody") || hasInvCapability(ctx.grants, companyId, "warehouse") || hasInvCapability(ctx.grants, companyId, "founder");
  } catch {
    return false;
  }
}

const conditionText = (c: string) => CONDITION_WORDS[c as InvCondition] ?? BALANCE_CONDITION_WORDS[c as InvBalanceCondition] ?? c;

export async function EmployeeEquipmentLink({ employeeId, companyId }: { employeeId: string; companyId: string }) {
  if (!(await mayShow(companyId))) return null;
  const href = `/inventory/employees?employee=${employeeId}`;
  let rows: OutstandingLike[] | null = null;
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("inv_employee_outstanding", { p_company_id: companyId, p_employee_id: employeeId, p_include_inactive: true });
    if (!error) rows = (data ?? []) as OutstandingLike[];
  } catch {
    rows = null;
  }
  const items = rows ? (groupOutstanding(rows)[0]?.items ?? []) : [];
  return (
    <section aria-labelledby="inv-held" className="space-y-2 border-t border-border pt-4">
      <h3 id="inv-held" className="text-sm font-semibold">Equipment held (recorded in Inventory)</h3>
      <p className="text-sm text-muted-foreground">The table above is the earlier HR asset register. Equipment the warehouse issues through Inventory is shown here instead.</p>
      {rows === null ? (
        <p className="text-sm text-muted-foreground" role="status">It could not be loaded just now. <Link href={href} className="font-medium text-foreground underline underline-offset-2">Open it in Inventory</Link>.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">This employee holds no company equipment recorded in Inventory.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Item</TableHead>
              <TableHead scope="col">ID</TableHead>
              <TableHead scope="col">Since</TableHead>
              <TableHead scope="col">Back by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i, n) => (
              <TableRow key={`${i.code ?? i.itemName}-${n}`} className="align-top">
                <TableCell className="min-w-[10rem] break-words">
                  <span className="font-medium">{i.itemName}</span>{i.kind === "quantity" && i.qty ? <span> × {i.qty}</span> : null}
                  <span className="block text-sm text-muted-foreground">{conditionText(i.condition)}{i.serial ? ` · serial ${i.serial}` : ""}</span>
                </TableCell>
                <TableCell className="font-mono text-sm">{i.code ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(i.issuedAt)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {i.expectedReturnAt ? formatDate(i.expectedReturnAt) : <span className="text-muted-foreground">No date set</span>}
                  {i.overdue ? <span className="font-medium text-amber-800 dark:text-amber-300"> · overdue</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-sm text-muted-foreground"><Link href={href} className="font-medium text-foreground underline underline-offset-2">Open in Inventory</Link> to issue or return equipment.</p>
    </section>
  );
}
