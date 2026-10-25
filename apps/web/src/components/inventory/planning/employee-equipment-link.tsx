import Link from "next/link";
import { hasInvCapability } from "@enginious-hr/domain";
import { getInventoryContext } from "@/lib/inventory/context";

/**
 * One link on an employee's Assets tab to the equipment Inventory records for that person. Shown only to people who may see it
 * (employee-custody access, warehouse operators, Inventory founders in the employee's company); nothing for everyone else, and nothing
 * at all (never an error) if Inventory is not installed or cannot be read. It adds no data to the HR page.
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

export async function EmployeeEquipmentLink({ employeeId, companyId }: { employeeId: string; companyId: string }) {
  if (!(await mayShow(companyId))) return null;
  return (
    <p className="text-sm text-muted-foreground">
      The list above is the earlier HR asset register. Equipment issued through Inventory is kept separately:{" "}
      <Link href={`/inventory/employees?employee=${employeeId}`} className="font-medium text-foreground underline underline-offset-2">see what they hold</Link>.
    </p>
  );
}
