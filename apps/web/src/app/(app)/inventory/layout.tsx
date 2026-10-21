import { Alert } from "@/components/ui/alert";
import { LoadError } from "@/components/workspace/states";
import { getInventoryContext } from "@/lib/inventory/context";

/**
 * Inventory shell. Access is a company-scoped Inventory grant (inv_company_grants), NOT an HR role, a Sales grant or a Projects grant:
 * an HR admin, CEO or system admin without one sees no stock (RLS returns nothing to them either). Project Managers and every employee
 * still reach what they are meant to (their requests, the equipment assigned to them) because those pages ask the database themselves.
 * Until the Inventory migrations have been applied to this database it says so, instead of failing.
 */
export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  if (!ctx.installed) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <Alert role="status">Inventory is not installed in this environment yet. The database changes it needs have not been applied here, so nothing is shown.</Alert>
      </div>
    );
  }
  if (ctx.loadFailed) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <LoadError what="Inventory" />
      </div>
    );
  }
  return <div className="space-y-6">{children}</div>;
}
